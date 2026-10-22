"""Owned fixtures: one durable cover+job commit, never a decoder-only ack."""
import sqlite3
import threading
import time
import unittest
from unittest.mock import patch
import test_scan_jobs as fixture
from app import main as m
from app.db_timing import DatabaseTiming
from app.scan_jobs import CommittedThumbnail,ThumbnailService


class AtomicThumbnailTests(unittest.TestCase):
    setUp=fixture.ScanJobsTests.setUp
    seed=fixture.ScanJobsTests.seed

    def wait_for(self,condition):
        deadline=time.monotonic()+3
        while not condition() and time.monotonic()<deadline:time.sleep(.005)
        self.assertTrue(condition())

    def service(self,process):
        service=ThumbnailService(m.thumbnail_connection,process,m.read_connection)
        context=patch.object(m,'thumbnail_service',service);context.start();self.addCleanup(context.stop)
        self.addCleanup(service.close);return service

    def test_cancelled_publish_gate_attempt_is_not_an_extra_database_commit(self):
        self.seed();key,_=self.jobs.next();service=self.service(m.process_thumbnail)
        service.gate.scope=lambda:m.database_timing.current_scope()
        cancelled=threading.Event();cancelled.set();timing=DatabaseTiming()
        with patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'),patch.object(m,'database_timing',timing):
            with self.assertRaises(m.ScanCancelled):m.process_thumbnail(key,cancelled,service.gate)
            self.assertNotIn('serialized:cover-publish',timing.report()['operation_lifetime']['groups'])
            cancelled.clear();self.assertIsInstance(m.process_thumbnail(key,cancelled,service.gate),CommittedThumbnail)
        gate=service.gate.report()['groups']['cover-publish']
        self.assertEqual((gate['count'],gate['failed']),(2,1))
        self.assertEqual(timing.report()['operation_lifetime']['groups']['serialized:cover-publish']['count'],1)
        self.assertEqual(self.jobs.count(),0)

    def test_cover_and_job_commit_once_without_changing_user_metadata_or_source(self):
        self.seed();key,_=self.jobs.next();timing=DatabaseTiming()
        with m.connection() as db:
            db.execute("UPDATE media SET progress=37,favorite=1,custom_cover='covers/manual.jpg',title='edited' WHERE id=1")
        with patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'),patch.object(m,'database_timing',timing):
            result=m.process_thumbnail(key,threading.Event(),threading.RLock())
        self.assertIsInstance(result,CommittedThumbnail);self.assertEqual(result,(True,''))
        self.assertEqual(self.jobs.count(),0)
        row=m.media_record(1)
        self.assertEqual((row['thumbnail'],row['progress'],row['favorite'],row['custom_cover'],row['title']),
            ('thumbnails/1.jpg',37,1,'covers/manual.jpg','edited'))
        groups=timing.report()['operation_lifetime']['groups']
        writers=[g for g in groups.values() if g['kind']=='serialized']
        self.assertEqual(len(writers),1);self.assertEqual(writers[0]['count'],1)
        self.assertEqual(writers[0]['changed_rows'],2)
        self.assertEqual(writers[0]['worst_commit']['transaction_outcome'],'committed')
        self.assertEqual((self.source/'1.mp4').read_bytes(),b'never modified')

    def test_delete_failure_missing_delete_or_commit_failure_rolls_back_both_updates(self):
        self.seed();key,_=self.jobs.next();original=sqlite3.connect
        for fault in ['delete','missing-delete','commit']:
            class Failure(sqlite3.Connection):
                def execute(self,sql,args=()):
                    if sql.lstrip().startswith('DELETE FROM thumbnail_jobs'):
                        if fault=='delete':raise sqlite3.OperationalError('owned delete fault')
                        if fault=='missing-delete':return super().execute('DELETE FROM thumbnail_jobs WHERE 0')
                    return super().execute(sql,args)
                def commit(self):
                    if fault=='commit':raise sqlite3.OperationalError('owned commit fault')
                    return super().commit()
            def connect(*args,**kwargs):return original(*args,**{**kwargs,'factory':Failure})
            with self.subTest(fault=fault),patch.object(m.sqlite3,'connect',side_effect=connect),patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'):
                with self.assertRaises(sqlite3.Error):m.process_thumbnail(key,threading.Event(),threading.RLock())
            row=m.media_record(1);self.assertIsNone(row['thumbnail']);self.assertEqual(row['updated_at'],0)
            with m.read_connection() as db:
                self.assertEqual(tuple(db.execute('SELECT revision,state FROM thumbnail_jobs WHERE media_id=1').fetchone()),(key['revision'],'pending'))

    def test_worker_does_not_finish_a_committed_job_in_a_second_transaction(self):
        self.seed();service=self.service(m.process_thumbnail)
        with patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'),patch.object(service.jobs,'finish',side_effect=AssertionError('duplicate finish')) as finish:
            service.start();self.wait_for(lambda:service.published==1 and service.current is None);service.close()
            finish.assert_not_called()
        self.assertEqual(service.snapshot()['pending'],0);self.assertEqual(service.snapshot()['failed'],0)

    def test_stop_after_commit_keeps_completion_and_counts_publication(self):
        self.seed()
        def process(key,cancelled,gate):
            result=m.process_thumbnail(key,cancelled,gate)
            service.request_stop();return result
        service=self.service(process)
        with patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'),patch.object(service.jobs,'finish') as finish:
            service.start();self.wait_for(lambda:not service.thread.is_alive());finish.assert_not_called()
        self.assertEqual(service.published,1);self.assertEqual(self.jobs.count(),0)
        self.assertEqual(m.media_record(1)['thumbnail'],'thumbnails/1.jpg')

    def test_retry_after_commit_is_not_deleted_by_the_previous_receipt(self):
        self.seed();old,_=self.jobs.next()
        def process(key,cancelled,gate):
            result=m.process_thumbnail(key,cancelled,gate)
            m.retry_thumbnail(1,m.ThumbnailRetry(frame_time=10))
            service.request_stop();return result
        service=self.service(process)
        with patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'),patch.object(service.jobs,'finish') as finish:
            service.start();self.wait_for(lambda:not service.thread.is_alive());finish.assert_not_called()
        current,_=self.jobs.next()
        self.assertNotEqual(current['revision'],old['revision']);self.assertEqual(current['frame_time'],10)
        self.assertEqual(self.jobs.count(),1);self.assertEqual(service.published,1)

    def test_cancel_while_waiting_for_writer_keeps_the_pending_job(self):
        self.seed();key,_=self.jobs.next();cancelled=threading.Event();errors=[]
        def process():
            try:m.process_thumbnail(key,cancelled,threading.RLock())
            except BaseException as error:errors.append(error)
        worker=threading.Thread(target=process)
        try:
            with patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'):
                with m.DB_LOCK:
                    worker.start();self.wait_for(lambda:m.DB_LOCK.status()['waiting_normal']>0);cancelled.set()
                worker.join(3)
        finally:
            cancelled.set()
            if worker.ident is not None:worker.join(3)
        self.assertFalse(worker.is_alive());self.assertEqual(len(errors),1);self.assertIsInstance(errors[0],m.ScanCancelled)
        self.assertEqual(self.jobs.count(),1);self.assertIsNone(m.media_record(1)['thumbnail'])

    def test_non_normal_media_cannot_generate_or_publish_a_cover(self):
        self.seed();key,_=self.jobs.next()
        with m.connection() as db:db.execute("UPDATE media SET file_state='recycled' WHERE id=1")
        self.assertIsNone(self.jobs.next()[1])
        with patch.object(m,'thumbnail') as decode:
            self.assertFalse(m.process_thumbnail(key,threading.Event(),threading.RLock())[0]);decode.assert_not_called()
        self.assertIsNone(m.media_record(1)['thumbnail'])

    def test_cancel_after_delete_rolls_back_and_a_new_worker_resumes_the_same_revision(self):
        self.seed();key,_=self.jobs.next();cancelled=threading.Event();original=sqlite3.connect
        class CancelAfterDelete(sqlite3.Connection):
            def execute(self,sql,args=()):
                result=super().execute(sql,args)
                if sql.lstrip().startswith('DELETE FROM thumbnail_jobs'):cancelled.set()
                return result
        def connect(*args,**kwargs):return original(*args,**{**kwargs,'factory':CancelAfterDelete})
        with patch.object(m.sqlite3,'connect',side_effect=connect),patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'):
            with self.assertRaises(m.ScanCancelled):m.process_thumbnail(key,cancelled,threading.RLock())
        self.assertIsNone(m.media_record(1)['thumbnail']);self.assertEqual(self.jobs.next()[0]['revision'],key['revision'])
        service=self.service(m.process_thumbnail)
        with patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'):
            service.start();self.wait_for(lambda:service.published==1);service.close()
        self.assertEqual(self.jobs.count(),0);self.assertEqual(m.media_record(1)['thumbnail'],'thumbnails/1.jpg')

    def test_completed_revision_cannot_publish_twice(self):
        self.seed();key,_=self.jobs.next()
        with patch.object(m,'thumbnail',return_value='thumbnails/1.jpg') as decode:
            first=m.process_thumbnail(key,threading.Event(),threading.RLock())
            second=m.process_thumbnail(key,threading.Event(),threading.RLock())
        self.assertIsInstance(first,CommittedThumbnail);self.assertFalse(second[0]);self.assertEqual(decode.call_count,1)

    def test_worker_commit_fault_reports_failure_without_published_receipt(self):
        self.seed();original=sqlite3.connect
        class Failure(sqlite3.Connection):
            writes_cover=False
            def execute(self,sql,args=()):
                if sql.lstrip().startswith('UPDATE media SET thumbnail='):self.writes_cover=True
                return super().execute(sql,args)
            def commit(self):
                if self.writes_cover:raise sqlite3.OperationalError('owned cover commit fault')
                return super().commit()
        def connect(*args,**kwargs):return original(*args,**{**kwargs,'factory':Failure})
        service=self.service(m.process_thumbnail)
        with patch.object(m.sqlite3,'connect',side_effect=connect),patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'):
            service.start();self.wait_for(lambda:service.snapshot()['failed']==1);service.close()
        self.assertEqual(service.published,0);self.assertIsNone(m.media_record(1)['thumbnail'])
        with m.read_connection() as db:
            row=db.execute('SELECT state,last_error FROM thumbnail_jobs WHERE media_id=1').fetchone()
            self.assertEqual(row['state'],'failed');self.assertIn('commit fault',row['last_error'])


if __name__=='__main__':unittest.main()
