"""Owned WAL fixtures: background reads must not queue behind an unrelated writer."""
from contextlib import contextmanager
import os
import threading
import unittest
from unittest.mock import patch

import test_scan_jobs as fixture  # Select isolated data before importing main.
import test_media_identity as identity_fixture
from app import main as m
from app.scan_jobs import ThumbnailService


class BulkReadIsolationTests(unittest.TestCase):
    setUp=fixture.ScanJobsTests.setUp
    seed=fixture.ScanJobsTests.seed

    @contextmanager
    def held_writer(self):
        entered=threading.Event();release=threading.Event();errors=[]
        def hold():
            try:
                with m.connection() as db:
                    db.execute("UPDATE media SET title='durable user title' WHERE id=1")
                    entered.set();release.wait(3)
            except BaseException as error:errors.append(error);entered.set()
        thread=threading.Thread(target=hold);thread.start();self.assertTrue(entered.wait(2));self.assertEqual(errors,[])
        try:yield
        finally:release.set();thread.join(4);self.assertFalse(thread.is_alive());self.assertEqual(errors,[])

    def worker(self,operation):
        done=threading.Event();result=[];errors=[]
        def run():
            try:result.append(operation())
            except BaseException as error:errors.append(error)
            finally:done.set()
        thread=threading.Thread(target=run);thread.start()
        self.addCleanup(thread.join,4)
        return thread,done,result,errors

    def test_single_file_lookup_uses_committed_snapshot_without_writer_queue(self):
        self.seed();source=self.source/'1.mp4';seen=[]
        def observe(_root,_path,_stat,old):seen.append(old['title']);return old
        with patch.object(m.identity_service,'observe',side_effect=observe),patch.object(m.file_service,'allow_scan',return_value=False):
            thread=None
            try:
                with self.held_writer():
                    thread,done,result,errors=self.worker(lambda:m.scan_file(1,source))
                    self.assertTrue(done.wait(.4),'Read-only lookup queued behind unrelated write lock')
            finally:
                if thread:thread.join(3)
        self.assertEqual(errors,[]);self.assertEqual(result,[False]);self.assertEqual(seen,['1'])

    def test_root_and_media_snapshot_complete_before_actual_write_work(self):
        self.seed();snapshot=threading.Event();original=m.RootPathIndex
        service=ThumbnailService(m.connection,m.process_thumbnail,m.read_connection);self.addCleanup(service.close)
        def index(rows):value=original(rows);snapshot.set();return value
        with patch.object(m,'RootPathIndex',side_effect=index),patch.object(m,'thumbnail_service',service):
            try:
                with self.held_writer():
                    self.manager.start(1,lambda manager:m.run_scan([{'id':1,'path':str(self.source)}],manager))
                    self.assertTrue(snapshot.wait(.4),'Whole-library snapshot queued behind unrelated write lock')
            finally:
                if self.manager.thread:self.manager.thread.join(4)
        self.assertFalse(self.manager.busy());self.assertEqual(self.manager.snapshot()['state'],'completed')

    def test_cover_checks_read_without_writer_queue_but_publication_still_waits(self):
        self.seed();key,_=self.jobs.next();checked=threading.Event();gate=threading.RLock()
        def decode(*args,**kwargs):
            self.assertTrue(kwargs['publish_if']());checked.set();return '1.jpg'
        with patch.object(m,'thumbnail',side_effect=decode):
            thread=None
            try:
                with self.held_writer():
                    thread,done,result,errors=self.worker(lambda:m.process_thumbnail(key,threading.Event(),gate))
                    self.assertTrue(checked.wait(.4),'Cover preflight queued behind unrelated write lock')
                    self.assertFalse(done.wait(.05),'Actual publication must still serialize with writes')
                    with m.read_connection() as db:self.assertIsNone(db.execute('SELECT thumbnail FROM media WHERE id=1').fetchone()[0])
            finally:
                if thread:thread.join(4)
        self.assertEqual(errors,[]);self.assertEqual(result,[(True,'')])
        with m.read_connection() as db:self.assertEqual(tuple(db.execute('SELECT title,thumbnail FROM media WHERE id=1').fetchone()),('durable user title','1.jpg'))
        self.assertEqual((self.source/'1.mp4').read_bytes(),b'never modified')

    def test_revision_changed_during_decode_is_not_published(self):
        self.seed();key,_=self.jobs.next()
        def decode(*args,**kwargs):
            with m.connection() as db:db.execute("UPDATE thumbnail_jobs SET revision='new-retry' WHERE media_id=1")
            return '1.jpg'
        with patch.object(m,'thumbnail',side_effect=decode):
            self.assertFalse(m.process_thumbnail(key,threading.Event(),threading.RLock())[0])
        with m.read_connection() as db:self.assertIsNone(db.execute('SELECT thumbnail FROM media WHERE id=1').fetchone()[0])

    def test_revision_revalidated_atomically_when_publication_gets_writer(self):
        self.seed();key,_=self.jobs.next();original=m.connection
        @contextmanager
        def changed_before_publication():
            # A retry becomes visible AFTER the read snapshot, just as this
            # publisher finally obtains the writer. Never mark its old job fresh.
            with original() as db:
                db.execute("UPDATE thumbnail_jobs SET revision='late-retry' WHERE media_id=1")
                yield db
        with patch.object(m,'thumbnail',return_value='1.jpg'),patch.object(m,'connection',changed_before_publication):
            self.assertFalse(m.process_thumbnail(key,threading.Event(),threading.RLock())[0])
        with m.read_connection() as db:
            self.assertIsNone(db.execute('SELECT thumbnail FROM media WHERE id=1').fetchone()[0])
            self.assertEqual(db.execute('SELECT revision FROM thumbnail_jobs WHERE media_id=1').fetchone()[0],'late-retry')

    def test_cover_reads_still_respect_exclusive_library_restore_gate(self):
        self.seed();key,_=self.jobs.next();checked=threading.Event()
        def decode(*args,**kwargs):checked.set();return '1.jpg'
        with patch.object(m,'thumbnail',side_effect=decode):
            with m.DB_READ_GATE.write():
                thread,done,result,errors=self.worker(lambda:m.process_thumbnail(key,threading.Event(),threading.RLock()))
                self.assertFalse(checked.wait(.05))
            self.assertTrue(done.wait(3));thread.join(3)
        self.assertEqual(errors,[]);self.assertEqual(result,[(True,'')])

    def test_negative_identity_snapshot_does_not_wait_for_unrelated_writer(self):
        self.seed();fresh=self.source/'owned-fresh.mp4';fresh.write_bytes(b'owned new video')
        with self.held_writer():
            thread,done,result,errors=self.worker(lambda:m.identity_service.observe(1,fresh,fresh.stat()))
            self.assertTrue(done.wait(.4),'Unmatched source observation queued behind unrelated writer')
        thread.join(3);self.assertEqual(errors,[]);self.assertEqual(result,[None])
        with m.read_connection() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM media').fetchone()[0],1)


class NegativeIdentityTests(unittest.TestCase):
    setUp=identity_fixture.IdentityTests.setUp
    row=identity_fixture.IdentityTests.row

    def test_unknown_unmatched_identity_needs_no_writer_connection(self):
        fresh=self.source.with_name('owned-new-unmatched.mp4');fresh.write_bytes(b'owned new source')
        before=self.row()
        with patch.object(self.files,'connection',side_effect=AssertionError('Negative identity check opened writer')):
            self.assertIsNone(self.service.observe(1,fresh,fresh.stat()))
        self.assertEqual(self.row(),before);self.assertEqual(fresh.read_bytes(),b'owned new source')

    def test_possible_external_rename_still_revalidates_under_writer_lock(self):
        moved=self.source.with_name('owned-external-rename.mp4');os.rename(self.source,moved)
        original=self.files.connection
        with patch.object(self.files,'connection',wraps=original) as writes:
            found=self.service.observe(1,moved,moved.stat())
        self.assertTrue(writes.called);self.assertEqual(found['id'],1)
        self.assertEqual((self.row()['progress'],self.row()['path']),(37,str(moved)))
