"""Experimental batching semantics only; not a product-scanner or performance test."""
import importlib.util
from pathlib import Path
import sqlite3
import threading
import time
import unittest
from unittest.mock import patch

import test_scan_jobs as fixture
from app import main as m
from app.scan_jobs import ThumbnailService

spec=importlib.util.spec_from_file_location('scan_batch_experiment',Path(__file__).resolve().parents[1]/'scripts/benchmark-scan-batches.py')
experiment=importlib.util.module_from_spec(spec);spec.loader.exec_module(experiment)


class ScanBatchExperimentTests(unittest.TestCase):
    setUp=fixture.ScanJobsTests.setUp
    seed=fixture.ScanJobsTests.seed

    def writer(self):
        service=ThumbnailService(m.thumbnail_connection,m.process_thumbnail,m.read_connection)
        self.addCleanup(service.close);return experiment.BatchWriter(m,service)

    def items(self,writer,count=8):
        records=[]
        for number in range(count):
            path=self.source/f'owned-{number}.mp4';path.write_bytes(b'owned batch placeholder')
            records.append(writer.prepare(path,experiment.metadata()))
        return records

    def counts(self):
        with m.read_connection() as db:
            return tuple(db.execute('SELECT (SELECT COUNT(*) FROM media),(SELECT COUNT(*) FROM thumbnail_jobs)').fetchone())

    def test_eight_records_commit_together_and_wake_after_durable_pair(self):
        writer=self.writer();items=self.items(writer);seen=[];wake=writer.service.wake.set
        def observe():seen.append(self.counts());wake()
        with patch.object(writer.service.wake,'set',side_effect=observe):ids=writer.commit(items)
        self.assertEqual(len(set(ids)),8);self.assertEqual(self.counts(),(8,8));self.assertEqual(seen,[(8,8)])
        self.assertTrue(all(item['path'].read_bytes()==b'owned batch placeholder' for item in items))

    def test_cancel_after_partial_body_rolls_back_entire_batch_then_resumes(self):
        writer=self.writer();items=self.items(writer);cancelled=threading.Event();write=writer.write
        def cancel(db,item):
            media_id=write(db,item)
            if media_id==4:cancelled.set()
            return media_id
        with patch.object(writer,'write',side_effect=cancel):
            with self.assertRaises(m.ScanCancelled):writer.commit(items,cancelled)
        self.assertEqual(self.counts(),(0,0));self.assertFalse(writer.service.wake.is_set())
        cancelled.clear();self.assertEqual(writer.commit(items,cancelled),list(range(1,9)))
        self.assertEqual(self.counts(),(8,8))

    def test_source_change_in_later_item_rolls_back_earlier_records(self):
        writer=self.writer();items=self.items(writer);items[-1]['path'].write_bytes(b'changed isolated sample with a different size')
        with self.assertRaises(ValueError):writer.commit(items)
        self.assertEqual(self.counts(),(0,0));self.assertFalse(writer.service.wake.is_set())
        self.assertEqual(len(writer.commit(items[:-1])),7)

    def test_commit_fault_rolls_back_batch_and_preserves_retry(self):
        writer=self.writer();items=self.items(writer);original=sqlite3.connect
        class Failure(sqlite3.Connection):
            def commit(self):raise sqlite3.OperationalError('owned batch commit fault')
        def connect(*args,**kwargs):return original(*args,**{**kwargs,'factory':Failure})
        with patch.object(m.sqlite3,'connect',side_effect=connect):
            with self.assertRaises(sqlite3.Error):writer.commit(items)
        self.assertEqual(self.counts(),(0,0));self.assertFalse(writer.service.wake.is_set())
        self.assertEqual(len(writer.commit(items)),8)

    def test_restart_replay_has_no_duplicate_rows_or_pending_revisions(self):
        writer=self.writer();items=self.items(writer);first=writer.commit(items[:4]);writer.service.close()
        with m.read_connection() as db:before={r['media_id']:r['revision'] for r in db.execute('SELECT * FROM thumbnail_jobs')}
        restarted=self.writer();ids=restarted.commit(items)
        self.assertEqual(ids[:4],first);self.assertEqual(self.counts(),(8,8))
        with m.read_connection() as db:
            after={r['media_id']:r['revision'] for r in db.execute('SELECT * FROM thumbnail_jobs')}
        self.assertTrue(all(after[key]==value for key,value in before.items()))

    def test_refresh_preserves_user_metadata_and_replaced_job_rejects_old_completion(self):
        self.seed();writer=self.writer();path=self.source/'1.mp4';old,_=self.jobs.next()
        with m.connection() as db:
            db.execute("UPDATE media SET title='personal',favorite=1,progress=37,custom_cover='covers/manual.jpg' WHERE id=1")
            db.execute('UPDATE thumbnail_jobs SET size=size+1 WHERE media_id=1')
        self.assertEqual(writer.commit([writer.prepare(path,experiment.metadata())]),[1])
        row=m.media_record(1)
        self.assertEqual((row['title'],row['favorite'],row['progress'],row['custom_cover']),('personal',1,37,'covers/manual.jpg'))
        self.assertFalse(self.jobs.finish(old,True));self.assertEqual(self.jobs.count(),1)

    def test_cancel_after_commit_does_not_report_rollback(self):
        writer=self.writer();items=self.items(writer);cancelled=threading.Event();wake=writer.service.wake.set
        def stop():cancelled.set();wake()
        with patch.object(writer.service.wake,'set',side_effect=stop):ids=writer.commit(items,cancelled)
        self.assertEqual(len(ids),8);self.assertEqual(self.counts(),(8,8))

    def test_batch_bounds_reject_invalid_input_before_writing(self):
        writer=self.writer();items=self.items(writer,9)
        for invalid in [[],items,iter(items)]:
            with self.subTest(kind=type(invalid).__name__),self.assertRaises(ValueError):writer.commit(invalid)
        self.assertEqual(self.counts(),(0,0))

    def test_cancel_before_transaction_does_not_enter_publication_gate(self):
        writer=self.writer();items=self.items(writer);cancelled=threading.Event();cancelled.set()
        with self.assertRaises(m.ScanCancelled):writer.commit(items,cancelled)
        self.assertEqual(self.counts(),(0,0));self.assertEqual(writer.service.gate.report()['groups'],{})

    def test_enqueue_fault_mid_batch_preserves_no_partial_rows(self):
        writer=self.writer();items=self.items(writer);schedule=writer.service.jobs.schedule_in;count=[0]
        def fail(db,media_id):
            count[0]+=1
            if count[0]==3:raise sqlite3.OperationalError('owned enqueue fault')
            return schedule(db,media_id)
        with patch.object(writer.service.jobs,'schedule_in',side_effect=fail):
            with self.assertRaises(sqlite3.Error):writer.commit(items)
        self.assertEqual(self.counts(),(0,0));self.assertFalse(writer.service.wake.is_set())
        self.assertEqual(len(writer.commit(items)),8)

    def test_review_state_is_not_revived_by_experimental_refresh(self):
        self.seed();writer=self.writer();items=self.items(writer,1)
        with m.connection() as db:db.execute("UPDATE media SET file_state='review',missing=1 WHERE id=1")
        items.append(writer.prepare(self.source/'1.mp4',experiment.metadata()))
        with self.assertRaises(ValueError):writer.commit(items)
        self.assertEqual(self.counts(),(1,1));self.assertEqual(m.media_record(1)['file_state'],'review')

    def test_queued_save_commits_before_next_batch_without_preempting_current_holder(self):
        self.seed();writer=self.writer();items=self.items(writer);entered=threading.Event();release=threading.Event()
        save_done=threading.Event();errors=[];observed=[];write=writer.write
        def blocked(db,item):
            if item is items[4]:observed.append(db.execute('SELECT progress FROM media WHERE id=1').fetchone()[0])
            media_id=write(db,item)
            if item is items[3]:
                entered.set()
                if not release.wait(5):raise RuntimeError('Owned release timeout')
            return media_id
        def scan():
            try:writer.commit(items[:4]);writer.commit(items[4:])
            except BaseException as error:errors.append(error)
        def save():
            try:m.save_progress(1,m.ProgressInput(progress=37,updated_at=1000));save_done.set()
            except BaseException as error:errors.append(error)
        scanner=threading.Thread(target=scan);saver=threading.Thread(target=save)
        with patch.object(writer,'write',side_effect=blocked):
            try:
                scanner.start();self.assertTrue(entered.wait(3));saver.start();until=time.monotonic()+3
                while not m.DB_LOCK.status()['waiting_saves'] and time.monotonic()<until:threading.Event().wait(.005)
                self.assertEqual(m.DB_LOCK.status()['waiting_saves'],1)
                self.assertFalse(save_done.is_set(),'A queued save cannot preempt a transaction already holding the writer')
            finally:
                release.set();scanner.join(5)
                if saver.ident is not None:saver.join(5)
        self.assertFalse(scanner.is_alive());self.assertFalse(saver.is_alive());self.assertEqual(errors,[])
        self.assertTrue(save_done.is_set());self.assertEqual(observed,[37]);self.assertEqual(self.counts(),(9,9))


if __name__=='__main__':unittest.main()
