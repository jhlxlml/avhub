"""Isolated DB fault/ordering harness; probe/decoder stubs are not performance evidence."""
import sqlite3
import threading
import time
import unittest
from unittest.mock import patch

import test_scan_jobs as fixture
from app import main as m
from app.db_timing import DatabaseTiming
from app.scan_readiness import ScanReadiness
from app.scan_jobs import ThumbnailService


class AtomicScanEnqueueTests(unittest.TestCase):
    setUp=fixture.ScanJobsTests.setUp
    seed=fixture.ScanJobsTests.seed

    def service(self):
        service=ThumbnailService(m.thumbnail_connection,m.process_thumbnail,m.read_connection)
        self.addCleanup(service.close)
        return service

    def metadata(self):
        return {'duration':120,'width':320,'height':180,'video_codec':'h264','audio_tracks':[],'subtitles':[]}

    def source_file(self):
        path=self.source/'new.mp4';path.write_bytes(b'owned test placeholder');return path

    def scan(self,path,service,cancelled=None):
        with patch.object(m,'probe',side_effect=lambda *_:self.metadata()):
            return m.scan_file(1,path,cancelled=cancelled,thumbnails=service)

    def states(self):
        with m.read_connection() as db:
            return ([dict(r) for r in db.execute('SELECT * FROM media')],
                    [dict(r) for r in db.execute('SELECT * FROM thumbnail_jobs')])

    def test_new_metadata_and_enqueue_share_one_committed_writer(self):
        source=self.source_file();service=self.service();timing=DatabaseTiming()
        with patch.object(m,'database_timing',timing),patch.object(service,'submit',side_effect=AssertionError('second submit')):
            self.assertTrue(self.scan(source,service))
        rows,jobs=self.states();self.assertEqual(len(rows),1);self.assertEqual(len(jobs),1)
        self.assertEqual(jobs[0]['media_id'],rows[0]['id']);self.assertEqual(jobs[0]['state'],'pending')
        self.assertTrue(jobs[0]['revision']);self.assertEqual(jobs[0]['path'],str(source))
        writers=[g for g in timing.report()['operation_lifetime']['groups'].values() if g['kind']=='serialized']
        self.assertEqual(len(writers),1);self.assertEqual(writers[0]['operation'],'scan-media')
        self.assertEqual(writers[0]['count'],1);self.assertEqual(writers[0]['changed_rows'],4)
        self.assertEqual(writers[0]['worst_commit']['transaction_outcome'],'committed')
        self.assertTrue(service.wake.is_set());self.assertEqual(source.read_bytes(),b'owned test placeholder')

    def test_scan_gate_and_database_share_scope_without_double_counting(self):
        source=self.source_file();timing=DatabaseTiming()
        service=ThumbnailService(m.thumbnail_connection,m.process_thumbnail,m.read_connection,
            scope=lambda:m.database_timing.current_scope());self.addCleanup(service.close)
        with patch.object(m,'database_timing',timing):self.assertTrue(self.scan(source,service))
        gate=service.snapshot()['publication_gate'];sample=gate['recent'][-1]
        db=timing.report()['operation_lifetime']['groups']['serialized:scan-media']['worst_commit']
        self.assertEqual(sample['scope_id'],db['scope_id']);self.assertEqual(sample['operation'],'scan-media')
        self.assertGreaterEqual(sample['total_ms']+.01,db['total'])
        self.assertNotIn('publication-gate',timing.report()['lifetime']['groups'])

    def test_real_scan_readiness_ack_requires_actual_commit_and_matches_scope(self):
        source=self.source_file();service=self.service();observer=ScanReadiness();timing=DatabaseTiming()
        with patch.object(m,'scan_readiness',observer),patch.object(m,'database_timing',timing):
            self.assertTrue(self.scan(source,service))
        report=observer.report();self.assertEqual(report['outcomes']['committed'],1)
        scope=timing.report()['operation_lifetime']['groups']['serialized:scan-media']['worst_commit']['scope_id']
        self.assertEqual(report['recent'][0]['scope_id'],scope)
        self.assertEqual(report['other_ready_at_writer_entry_counts'][0],1)
        # Unchanged scans do not fabricate another probe/readiness measurement.
        with patch.object(m,'scan_readiness',observer):self.assertFalse(self.scan(source,service))
        self.assertEqual(observer.report()['started'],1)

    def test_readiness_commit_fault_reports_failure_and_retains_no_active_ticket(self):
        source=self.source_file();service=self.service();observer=ScanReadiness();original=sqlite3.connect
        class Failure(sqlite3.Connection):
            def commit(self):raise sqlite3.OperationalError('owned readiness commit fault')
        def connect(*a,**kw):return original(*a,**{**kw,'factory':Failure})
        with patch.object(m,'scan_readiness',observer),patch.object(m.sqlite3,'connect',side_effect=connect):
            with self.assertRaises(sqlite3.Error):self.scan(source,service)
        report=observer.report();self.assertEqual(report['outcomes']['committed'],0)
        self.assertEqual(report['outcomes']['failed'],1);self.assertEqual(sum(report['active'].values()),0)
        self.assertEqual(self.states(),([],[]))

    def test_enqueue_and_commit_failures_roll_back_new_media_without_waking(self):
        source=self.source_file();service=self.service();original=sqlite3.connect
        for fault in ['enqueue','commit']:
            class Failure(sqlite3.Connection):
                def execute(self,sql,args=()):
                    if fault=='enqueue' and sql.lstrip().startswith('INSERT INTO thumbnail_jobs'):
                        raise sqlite3.OperationalError('owned enqueue fault')
                    return super().execute(sql,args)
                def commit(self):
                    if fault=='commit':raise sqlite3.OperationalError('owned commit fault')
                    return super().commit()
            def connect(*a,**kw):return original(*a,**{**kw,'factory':Failure})
            with self.subTest(fault=fault),patch.object(m.sqlite3,'connect',side_effect=connect):
                with self.assertRaises(sqlite3.Error):self.scan(source,service)
            self.assertEqual(self.states(),([],[]));self.assertFalse(service.wake.is_set())
        self.assertTrue(self.scan(source,service));self.assertEqual(len(self.states()[1]),1)

    def test_cancel_after_enqueue_rolls_back_both_then_resume_succeeds(self):
        source=self.source_file();service=self.service();cancelled=threading.Event();schedule=service.jobs.schedule_in
        def cancel(db,media_id):
            result=schedule(db,media_id);cancelled.set();return result
        with patch.object(service.jobs,'schedule_in',side_effect=cancel):
            with self.assertRaises(m.ScanCancelled):self.scan(source,service,cancelled)
        self.assertEqual(self.states(),([],[]));self.assertFalse(service.wake.is_set())
        cancelled.clear();self.assertTrue(self.scan(source,service,cancelled));self.assertEqual(len(self.states()[1]),1)

    def test_worker_wake_observes_only_durably_committed_pair(self):
        source=self.source_file();service=self.service();seen=[];wake=service.wake.set
        def observe():
            rows,jobs=self.states();seen.append((len(rows),len(jobs)));wake()
        with patch.object(service.wake,'set',side_effect=observe):self.assertTrue(self.scan(source,service))
        self.assertEqual(seen,[(1,1)])

    def test_metadata_refresh_keeps_pending_revision_and_user_edits(self):
        self.seed();source=self.source/'1.mp4';service=self.service();key,_=self.jobs.next()
        with m.connection() as db:
            db.execute("UPDATE media SET title='personal title',favorite=1,progress=37,custom_cover='covers/manual.jpg' WHERE id=1")
            db.execute('UPDATE media SET source_identity=? WHERE id=1',(m.media_identity.encoded(source.stat()),))
        old=dict(m.media_record(1));old['modified']-=1
        # A deliberately stale snapshot forces a refresh of unchanged physical
        # media without fabricating a replacement-file identity decision.
        with patch.object(m,'probe',side_effect=lambda *_:self.metadata()):
            self.assertTrue(m.scan_file(1,source,existing={str(source):old},thumbnails=service))
        rows,jobs=self.states();row=rows[0]
        self.assertEqual((row['title'],row['favorite'],row['progress'],row['custom_cover']),
                         ('personal title',1,37,'covers/manual.jpg'))
        self.assertEqual(jobs[0]['revision'],key['revision']);self.assertEqual(len(jobs),1)
        self.assertEqual(source.read_bytes(),b'never modified')

    def test_failed_refresh_restores_previous_metadata_and_job_revision(self):
        self.seed();source=self.source/'1.mp4';service=self.service()
        with m.connection() as db:db.execute('UPDATE media SET source_identity=? WHERE id=1',(m.media_identity.encoded(source.stat()),))
        before=self.states()
        old=dict(m.media_record(1));old['modified']-=1;schedule=service.jobs.schedule_in
        def fail(db,media_id):
            schedule(db,media_id);raise sqlite3.OperationalError('owned post-enqueue fault')
        with patch.object(service.jobs,'schedule_in',side_effect=fail),patch.object(m,'probe',side_effect=lambda *_:self.metadata()):
            with self.assertRaises(sqlite3.Error):m.scan_file(1,source,existing={str(source):old},thumbnails=service)
        self.assertEqual(self.states(),before);self.assertFalse(service.wake.is_set())

    def test_missing_source_reappearance_and_enqueue_share_transaction(self):
        self.seed();source=self.source/'1.mp4';service=self.service()
        with m.connection() as db:
            db.execute('DELETE FROM thumbnail_jobs');db.execute('UPDATE media SET missing=1 WHERE id=1')
        timing=DatabaseTiming()
        with patch.object(m,'database_timing',timing),patch.object(service,'submit',side_effect=AssertionError('second submit')):
            self.assertFalse(self.scan(source,service))
        rows,jobs=self.states();self.assertEqual(rows[0]['missing'],0);self.assertEqual(len(jobs),1)
        group=timing.report()['operation_lifetime']['groups']['serialized:scan-media']
        self.assertEqual(group['count'],1);self.assertEqual(group['changed_rows'],2)

    def test_scan_does_not_reset_explicit_frame_retry_or_failure_cooldown(self):
        self.seed();source=self.source/'1.mp4';service=self.service()
        with m.connection() as db:
            db.execute("UPDATE thumbnail_jobs SET frame_time=42,priority=123,last_error='keep' WHERE media_id=1")
        before=self.states()[1]
        self.assertFalse(self.scan(source,service));self.assertEqual(self.states()[1],before)
        key,_=self.jobs.next();self.jobs.finish(key,False,'owned decoder failure');before=self.states()[1]
        self.assertFalse(self.scan(source,service));self.assertEqual(self.states()[1],before)

    def test_changed_job_fingerprint_gets_new_revision_with_metadata_commit(self):
        self.seed();source=self.source/'1.mp4';service=self.service()
        with m.connection() as db:
            db.execute('UPDATE media SET source_identity=? WHERE id=1',(m.media_identity.encoded(source.stat()),))
            db.execute("UPDATE thumbnail_jobs SET size=size+1,state='failed',attempted_at=123,frame_time=42,priority=99,last_error='stale' WHERE media_id=1")
        before=self.states()[1][0];old=dict(m.media_record(1));old['modified']-=1
        with patch.object(m,'probe',side_effect=lambda *_:self.metadata()):
            self.assertTrue(m.scan_file(1,source,existing={str(source):old},thumbnails=service))
        job=self.states()[1][0]
        self.assertNotEqual(job['revision'],before['revision']);self.assertEqual(job['size'],source.stat().st_size)
        self.assertEqual((job['state'],job['attempted_at'],job['frame_time'],job['priority'],job['last_error']),
                         ('pending',0,None,0,''))
        self.assertFalse(self.jobs.finish(before,True));self.assertEqual(self.jobs.count(),1)

    def test_cancel_or_source_change_while_waiting_for_writer_never_publishes(self):
        for action in ['cancel','source-change']:
            with self.subTest(action=action):
                source=self.source_file();service=self.service();cancelled=threading.Event();probed=threading.Event();errors=[]
                def probe(*_):probed.set();return self.metadata()
                def run():
                    try:m.scan_file(1,source,cancelled=cancelled,thumbnails=service)
                    except Exception as error:errors.append(error)
                with patch.object(m,'probe',side_effect=probe):
                    with m.DB_LOCK:
                        thread=threading.Thread(target=run);thread.start()
                        ready=probed.wait(3)
                        until=time.monotonic()+3
                        while not m.DB_LOCK.status()['waiting_normal'] and time.monotonic()<until:threading.Event().wait(.005)
                        queued=m.DB_LOCK.status()['waiting_normal']>0
                        if action=='cancel':cancelled.set()
                        else:source.write_bytes(b'isolated changed source while waiting')
                    thread.join(5)
                self.assertTrue(ready);self.assertTrue(queued);self.assertFalse(thread.is_alive());self.assertEqual(len(errors),1)
                self.assertIsInstance(errors[0],m.ScanCancelled if action=='cancel' else ValueError)
                self.assertEqual(self.states(),([],[]));self.assertFalse(service.wake.is_set())

    def test_persisted_pair_can_be_resumed_by_fresh_service(self):
        source=self.source_file();first=self.service();self.assertTrue(self.scan(source,first));first.close()
        second=self.service();second.pause()
        self.assertEqual(second.snapshot()['pending'],1)
        with patch.object(m,'thumbnail',return_value='thumbnails/1.jpg'):
            second.start();second.pause(False)
            deadline=threading.Event()
            until=time.monotonic()+3
            while second.published<1 and time.monotonic()<until:deadline.wait(.005)
            self.assertEqual(second.published,1);self.assertTrue(second.close())
        rows,jobs=self.states();self.assertEqual(jobs,[]);self.assertEqual(rows[0]['thumbnail'],'thumbnails/1.jpg')


if __name__=='__main__':unittest.main()
