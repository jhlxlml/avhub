"""Isolated backup concurrency, identity and crash-staging recovery."""
import json
import threading
import unittest
import zipfile
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

import test_full_backup as fixture
from app import main as m, library_backup as archive, data_jobs


class BackupJobLifecycleTests(unittest.TestCase):
    seed_images=fixture.FullBackupTests.seed_images

    def setUp(self):
        fixture.FullBackupTests.setUp(self)
        self.jobs=data_jobs.DataJobs(lambda:self.folder)
        self.addCleanup(self.jobs.close)

    def backup(self,thumbnails=True):
        job=self.jobs.allocate('backup')
        self.jobs.run(job,lambda current:m.build_backup_job(current,m.BackupJobInput(full=True,thumbnails=thumbnails)))
        return job

    def finish(self,job):
        job.thread.join(10)
        self.assertFalse(job.thread.is_alive());self.assertEqual(job.state,'ready',job.error)
        return job.folder/job.result['filename']

    def test_hashing_and_packing_leave_writer_free_and_keep_snapshot_cover(self):
        self.seed_images();entered=threading.Event();release=threading.Event();original=archive.digest
        def paused(*args):
            entered.set()
            if not release.wait(5):raise RuntimeError('test barrier')
            return original(*args)
        with patch.object(archive,'digest',side_effect=paused):
            job=self.backup()
            try:
                self.assertTrue(entered.wait(3))
                acquired=m.DB_LOCK.acquire(timeout=.5)
                if acquired:m.DB_LOCK.release()
                self.assertTrue(acquired,'hash/ZIP must not retain the writer queue')
                with m.connection() as db:
                    db.execute('UPDATE media SET progress=77,custom_cover=NULL WHERE id=1')
                    m.covers.discard(db,self.folder,self.cover)
                self.assertTrue((self.folder/self.cover).exists(),'snapshot pin protects retired manual cover')
            finally:release.set()
            output=self.finish(job)
        with zipfile.ZipFile(output) as result:
            self.assertEqual(result.read(self.cover),self.image)
            manifest=json.loads(result.read('manifest.json'))
            import hashlib
            for name,record in manifest['files'].items():self.assertEqual(hashlib.sha256(result.read(name)).hexdigest(),record['sha256'])
        self.assertFalse((self.folder/self.cover).exists(),'retired cover is reclaimed after snapshot pin release')
        self.assertEqual(m.media_record(1)['progress'],77)
        self.assertEqual(self.source.read_bytes(),b'original video B')

    def test_changed_source_does_not_reuse_same_id_thumbnail(self):
        self.seed_images();original=m.open_backup_image;changed=False
        @contextmanager
        def change(path,row):
            nonlocal changed
            if path.parent==m.THUMBS and not changed:
                changed=True
                with m.connection() as db:db.execute('UPDATE media SET size=size+1 WHERE id=1')
            with original(path,row) as source:yield source
        with patch.object(m,'open_backup_image',change):output=self.finish(self.backup())
        with zipfile.ZipFile(output) as result:self.assertNotIn('thumbnails/1.jpg',result.namelist())

    def test_pack_uses_private_copy_not_reopened_mutable_cache(self):
        self.seed_images();original=archive.digest;changed=False
        def change(path,*args):
            nonlocal changed
            if not changed:
                changed=True;(self.thumbs/'1.jpg').write_bytes(b'changed cache')
            return original(path,*args)
        with patch.object(archive,'digest',side_effect=change):output=self.finish(self.backup())
        with zipfile.ZipFile(output) as result:self.assertEqual(result.read('thumbnails/1.jpg'),self.image)

    def test_waiting_restore_gate_does_not_deadlock_snapshot_capture_or_release(self):
        self.seed_images();entered=threading.Event();release=threading.Event();finished=threading.Event()
        original=archive.capture
        def paused(*args,**kwargs):
            entered.set()
            if not release.wait(5):raise RuntimeError('test barrier')
            return original(*args,**kwargs)
        def restore_gate():
            with m.DB_READ_GATE.write():finished.set()
        with patch.object(archive,'capture',side_effect=paused):
            job=self.backup();self.assertTrue(entered.wait(3))
            writer=threading.Thread(target=restore_gate,daemon=True);writer.start()
            try:
                import time
                deadline=time.monotonic()+2
                while not m.DB_READ_GATE.waiting and time.monotonic()<deadline:time.sleep(.005)
                self.assertGreater(m.DB_READ_GATE.waiting,0)
            finally:release.set()
            self.finish(job);writer.join(3)
        self.assertTrue(finished.is_set())

    def test_dead_normal_job_recovered_but_live_commit_unknown_and_legacy_kept(self):
        jobs=[]
        for _ in range(4):
            job=self.jobs.allocate('backup');job.state='ready';job.stage='ready';job.persist();self.jobs.active=None;jobs.append(job)
        jobs[1].stage='committing';jobs[1].persist()
        (jobs[2].folder/'not-application-data.txt').write_text('keep',encoding='utf-8')
        (jobs[3].folder/'owner.json').unlink()  # Legacy/unowned staging is never guessed.
        fresh=data_jobs.DataJobs(lambda:self.folder)
        with patch.object(data_jobs,'running',return_value=False):fresh.sweep()
        self.assertFalse(jobs[0].folder.exists())
        self.assertTrue(all(job.folder.exists() for job in jobs[1:]))
        self.assertEqual(fresh.recovery,{'removed':1,'retained':1,'unknown':2})
        fresh=data_jobs.DataJobs(lambda:self.folder)
        jobs[1].stage='ready';jobs[1].persist()
        with patch.object(data_jobs,'running',return_value=True):fresh.sweep()
        self.assertTrue(jobs[1].folder.exists())

    def test_space_and_capacity_failure_do_not_leave_active_job(self):
        with patch.object(data_jobs.shutil,'disk_usage',return_value=SimpleNamespace(free=0)):
            with self.assertRaisesRegex(ValueError,'剩余空间不足'):self.jobs.allocate('backup')
        self.assertIsNone(self.jobs.active);self.assertEqual(self.jobs.jobs,{})
        job=self.jobs.allocate('backup')
        with patch.object(data_jobs,'MAX_TOTAL_BYTES',2):
            with self.assertRaisesRegex(ValueError,'达到上限'):job.reserve(3)
        self.assertEqual(job.used,0)

    def test_failed_restore_staging_is_not_swept_cancelled_or_removed_on_exit(self):
        job=self.jobs.allocate('inspect');job.state='ready';self.jobs.active=None
        def fail(current):
            (current.folder/'library.db').write_bytes(b'isolated recovery evidence')
            raise OSError('injected restore failure')
        self.jobs.commit(job.id,fail);job.thread.join(3)
        self.assertTrue(job.needs_review);self.assertEqual(job.stage,'review')
        from fastapi import HTTPException
        with self.assertRaises(HTTPException):self.jobs.cancel(job.id)
        job.touched=0;self.jobs.sweep();self.jobs.close();self.assertTrue(job.folder.exists())
        fresh=data_jobs.DataJobs(lambda:self.folder)
        with patch.object(data_jobs,'running',return_value=False):fresh.sweep()
        self.assertTrue(job.folder.exists());self.assertEqual(fresh.recovery['retained'],1)

    def test_restore_space_failure_precedes_rollback_and_live_mutation(self):
        self.seed_images()
        snapshot=self.folder/'isolated-restore.db'
        import sqlite3
        from contextlib import closing
        with closing(sqlite3.connect(m.DB)) as source,closing(sqlite3.connect(snapshot)) as target:source.backup(target)
        original=m.media_record(1);images=(self.thumbs/'1.jpg').read_bytes()
        def full(_):raise ValueError('injected staging capacity failure')
        with self.assertRaisesRegex(ValueError,'capacity'):
            m.install_library_backup(snapshot,reserve=full)
        self.assertEqual(m.media_record(1),original);self.assertEqual((self.thumbs/'1.jpg').read_bytes(),images)
        self.assertFalse(any((self.folder/'backups').glob('before-restore-*.db')))

    def test_cancelled_capture_releases_pins_and_private_images(self):
        self.seed_images();original=archive.capture
        def cancel(*args,**kwargs):
            job=next(iter(self.jobs.jobs.values()));job.cancelled.set()
            return original(*args,**kwargs)
        with patch.object(archive,'capture',side_effect=cancel):
            job=self.backup();job.thread.join(5)
        self.assertEqual(job.state,'cancelled');self.assertFalse(job.folder.exists())
        self.assertFalse(m.artwork_readers.active(self.folder/self.cover))
        self.assertTrue((self.folder/self.cover).exists())
