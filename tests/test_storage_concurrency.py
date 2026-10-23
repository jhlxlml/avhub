"""Storage preflight/control isolation; mutations use owned TEMP fixtures only."""
import sqlite3
import threading
import unittest
from contextlib import closing
from unittest.mock import patch
from fastapi import HTTPException
import test_correctness as fixture
from app import main as m, storage_management as storage, artwork_readers
from app.file_operations import FileOperations


class StorageConcurrencyTests(unittest.TestCase):
    def setUp(self):
        fixture.CorrectnessTests.setUp(self)
        self.orphan=self.thumbs/'99.jpg';self.orphan.write_bytes(b'owned cache')

    def test_slow_statistics_and_cleanup_preflight_leave_playback_and_writer_available(self):
        token=m.storage_status()['cleanup']['token']
        for cleanup in (False,True):
            entered=threading.Event();release=threading.Event();errors=[]
            original=storage.inventory
            def slow(data):
                entered.set()
                if not release.wait(3):raise RuntimeError('test barrier expired')
                return original(data)
            def work():
                try:
                    if cleanup:m.storage_cleanup(m.StorageCleanupInput(token=token))
                    else:m.storage_status()
                except BaseException as error:errors.append(error)
            with patch.object(storage,'inventory',side_effect=slow):
                worker=threading.Thread(target=work);worker.start()
                try:
                    self.assertTrue(entered.wait(2))
                    for lock in (m.playback.lock,m.DB_LOCK):
                        acquired=lock.acquire(timeout=.2)
                        self.assertTrue(acquired)
                        if acquired:lock.release()
                finally:release.set();worker.join(5)
            self.assertFalse(worker.is_alive());self.assertEqual(errors,[])
        self.assertFalse(self.orphan.exists())
        self.assertEqual(self.source.read_bytes(),b'original video B')

    def confirm_after(self,change):
        token=m.storage_status()['cleanup']['token'];original=m.storage_snapshot
        def snapshot(days):
            result=original(days);change();return result
        with patch.object(m,'storage_snapshot',side_effect=snapshot):
            with self.assertRaises(HTTPException) as error:
                m.storage_cleanup(m.StorageCleanupInput(token=token))
        self.assertEqual(error.exception.status_code,409)
        self.assertTrue(self.orphan.exists())

    def test_new_thumbnail_reference_after_preflight_is_protected(self):
        def change():
            with m.connection() as db:db.execute("UPDATE media SET id=99,thumbnail='thumbnails/99.jpg'")
        self.confirm_after(change)

    def test_final_deletion_does_not_exclude_unrelated_original_readers(self):
        token=m.storage_status()['cleanup']['token']
        entered=threading.Event();release=threading.Event();read_done=threading.Event();errors=[]
        original=storage.clean;service=FileOperations(m.connection,m.read_connection)
        def slow(*args):
            entered.set()
            if not release.wait(3):raise RuntimeError('test barrier expired')
            return original(*args)
        def clean():
            try:m.storage_cleanup(m.StorageCleanupInput(token=token))
            except BaseException as error:errors.append(error)
        def read():
            try:
                with service.reader(1),m.read_connection() as db:
                    self.assertEqual(db.execute('SELECT path FROM media WHERE id=1').fetchone()[0],str(self.source.resolve()))
                    self.assertEqual(self.source.read_bytes(),b'original video B')
                read_done.set()
            except BaseException as error:errors.append(error)
        with patch.object(m,'file_service',service),patch.object(storage,'clean',side_effect=slow):
            worker=threading.Thread(target=clean);worker.start();reader=None
            try:
                self.assertTrue(entered.wait(2));reader=threading.Thread(target=read);reader.start()
                self.assertTrue(read_done.wait(1),'Original readers must finish while deletion is waiting')
            finally:
                release.set();worker.join(5)
                if reader:reader.join(3)
        self.assertEqual(errors,[]);self.assertFalse(worker.is_alive())

    def test_new_source_reference_after_preflight_is_protected(self):
        def change():
            with m.connection() as db:db.execute('UPDATE media SET path=?',(str(self.orphan),))
        self.confirm_after(change)

    def test_new_rollback_after_preflight_is_protected(self):
        def change():
            parent=self.folder/'backups';parent.mkdir()
            with closing(sqlite3.connect(m.DB)) as source,closing(sqlite3.connect(parent/'before-restore-20200101-000000-00000001.db')) as target:
                source.backup(target)
        self.confirm_after(change)

    def test_new_pending_thumbnail_after_preflight_is_protected(self):
        def change():
            with m.connection() as db:
                db.execute("INSERT INTO thumbnail_jobs(media_id,path) VALUES(99,?)",(str(self.folder/'missing.mp4'),))
        self.confirm_after(change)

    def test_ordinary_progress_update_does_not_invalidate_cleanup(self):
        token=m.storage_status()['cleanup']['token']
        with m.connection() as db:db.execute('UPDATE media SET progress=25,updated_at=777')
        result=m.storage_cleanup(m.StorageCleanupInput(token=token))
        self.assertEqual(result['removed'],1)
        self.assertEqual(m.media_record(1)['progress'],25)

    def test_reader_started_after_preflight_keeps_cache(self):
        token=m.storage_status()['cleanup']['token'];original=m.storage_snapshot;response=None
        def snapshot(days):
            nonlocal response
            result=original(days);response=artwork_readers.PinnedArtworkResponse(self.orphan);return result
        try:
            with patch.object(m,'storage_snapshot',side_effect=snapshot):
                result=m.storage_cleanup(m.StorageCleanupInput(token=token))
            self.assertEqual(result['removed'],0);self.assertEqual(result['skipped'],1)
            self.assertTrue(self.orphan.exists())
        finally:
            if response:response._release()

    def test_final_cleanup_keeps_replaced_file_even_with_equal_size_and_time(self):
        import os
        report=storage.plan(self.folder,m.DB);info=self.orphan.stat()
        replacement=self.thumbs/'replacement.tmp';replacement.write_bytes(b'other cache')
        os.utime(replacement,ns=(info.st_atime_ns,info.st_mtime_ns));replacement.replace(self.orphan)
        self.assertNotEqual(report['cleanup']['token'],storage.plan(self.folder,m.DB)['cleanup']['token'])
        result=storage.clean(self.folder,report)
        self.assertEqual(result['removed'],0);self.assertTrue(self.orphan.exists())
