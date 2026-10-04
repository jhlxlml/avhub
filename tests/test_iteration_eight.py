import asyncio
import json
import os
import sqlite3
import threading
import time
import unittest
from pathlib import Path
from contextlib import closing
from unittest.mock import patch
from starlette.requests import Request
from fastapi import HTTPException
import test_correctness as fixture
from app import main as m
from app import storage_management as storage
from app.data_jobs import DataJobs
from app.scan_jobs import ThumbnailService


class IterationEightTests(unittest.TestCase):
    def setUp(self):
        fixture.CorrectnessTests.setUp(self)
        self.jobs=DataJobs(lambda:self.folder)
        context=patch.object(m,'data_jobs',self.jobs);context.start();self.addCleanup(context.stop);self.addCleanup(self.jobs.close)

    def wait(self,job):
        deadline=time.monotonic()+5
        while job.state=='running' and time.monotonic()<deadline:time.sleep(.01)
        self.assertNotEqual(job.state,'running');return job.public()

    def upload(self,payload):
        async def receive():return {'type':'http.request','body':payload,'more_body':False}
        return asyncio.run(m.start_inspect_job(Request({'type':'http','method':'POST','path':'/api/data-jobs/inspect','headers':[]},receive)))

    def test_cleanup_only_orphan_cache_not_source_current_cover_or_unknown_file(self):
        for name in ['1.jpg','99.jpg','unknown.jpg']:(self.thumbs/name).write_bytes(b'cache')
        (self.folder/'covers').mkdir();(self.folder/'covers'/('a'*32+'.jpg')).write_bytes(b'personal cover')
        before=m.storage_status();self.assertEqual(before['cleanup']['files'],1)
        result=m.storage_cleanup(m.StorageCleanupInput(token=before['cleanup']['token']))
        self.assertEqual(result['removed'],1);self.assertFalse((self.thumbs/'99.jpg').exists())
        self.assertTrue((self.thumbs/'1.jpg').exists());self.assertTrue((self.thumbs/'unknown.jpg').exists());self.assertEqual(self.source.read_bytes(),b'original video B')
        self.assertTrue((self.folder/'covers'/('a'*32+'.jpg')).exists())

    def test_stale_preview_cannot_delete_changed_cache(self):
        orphan=self.thumbs/'99.jpg';orphan.write_bytes(b'old');before=m.storage_status();orphan.write_bytes(b'new larger content')
        with self.assertRaises(HTTPException) as error:m.storage_cleanup(m.StorageCleanupInput(token=before['cleanup']['token']))
        self.assertEqual(error.exception.status_code,409);self.assertEqual(orphan.read_bytes(),b'new larger content')

    def rollback(self,number):
        parent=self.folder/'backups';parent.mkdir(exist_ok=True)
        path=parent/f'before-restore-20200101-000000-{number:08x}.db'
        with closing(sqlite3.connect(m.DB)) as source,closing(sqlite3.connect(path)) as target:source.backup(target)
        stamp=time.time()-40*86400+number;os.utime(path,(stamp,stamp));return path

    def test_keep_recent_three_rollbacks_and_protect_their_old_thumbnail_references(self):
        with m.connection() as db:db.execute("UPDATE media SET id=99,thumbnail='old-format.jpg'")
        (self.thumbs/'99.jpg').write_bytes(b'rollback thumbnail');paths=[self.rollback(i) for i in range(5)]
        with m.connection() as db:db.execute("UPDATE media SET id=1,thumbnail=NULL")
        self.assertEqual(m.storage_status()['cleanup']['files'],0)
        before=m.storage_status(30);self.assertEqual(before['cleanup']['rollback_files'],2)
        result=m.storage_cleanup(m.StorageCleanupInput(token=before['cleanup']['token'],rollback_days=30))
        self.assertEqual(result['removed'],2);self.assertEqual(sum(path.exists() for path in paths),3)
        self.assertTrue((self.thumbs/'99.jpg').exists())

    def test_unknown_or_corrupt_rollback_prevents_unsafe_orphan_cleanup(self):
        parent=self.folder/'backups';parent.mkdir();(parent/'before-restore-20200101-000000-ffffffff.db').write_bytes(b'broken')
        (self.thumbs/'99.jpg').write_bytes(b'keep');self.assertEqual(m.storage_status()['cleanup']['files'],0)

    def test_active_or_unknown_hls_and_recent_subtitle_files_are_kept(self):
        hls=self.folder/'hls'/('a'*32);hls.mkdir(parents=True);(hls/'owner.json').write_text('{"pid":1}');(hls/'segment_000001.ts').write_bytes(b'owned fragment')
        subtitles=self.folder/'subtitle-cache'/'ass-fixture';subtitles.mkdir(parents=True);(subtitles/'subtitle.vtt').write_text('WEBVTT')
        with patch.object(storage,'orphaned',return_value=True):
            active=storage.plan(self.folder,m.DB,active_tokens={'a'*32});self.assertEqual(active['cleanup']['files'],0)
            old=time.time()-2*86400;os.utime(subtitles/'subtitle.vtt',(old,old))
            preview=storage.plan(self.folder,m.DB);self.assertEqual(preview['cleanup']['files'],3)
            storage.clean(self.folder,preview);self.assertFalse(hls.exists());self.assertFalse(subtitles.exists())
        self.assertTrue(self.source.exists())

    def test_symlink_cache_is_never_followed(self):
        outside=self.folder/'outside';outside.mkdir();(outside/'99.jpg').write_bytes(b'not owned')
        link=self.thumbs/'99.jpg'
        try:link.symlink_to(outside/'99.jpg')
        except OSError:self.skipTest('Windows symlink creation not permitted')
        self.assertEqual(m.storage_status()['cleanup']['files'],0);self.assertEqual((outside/'99.jpg').read_bytes(),b'not owned')

    def test_indexed_source_inside_recognized_cache_is_still_protected(self):
        folder=self.folder/'hls'/('a'*32);folder.mkdir(parents=True)
        video=folder/'segment_000001.ts';video.write_bytes(b'indexed original')
        (folder/'owner.json').write_text('{"pid":1}')
        with m.connection() as db:db.execute('UPDATE media SET path=? WHERE id=1',(str(video),))
        with patch.object(storage,'orphaned',return_value=True):
            self.assertEqual(m.storage_status()['cleanup']['files'],0)
        self.assertEqual(video.read_bytes(),b'indexed original')

    def test_linked_job_parent_rejected_without_creating_staging(self):
        original=Path.resolve;parent=self.folder/'backups'/'jobs'
        def redirected(path,*args,**kwargs):
            return self.folder/'external' if path==parent else original(path,*args,**kwargs)
        with patch.object(Path,'resolve',redirected):
            with self.assertRaises(HTTPException) as error:self.jobs.allocate('backup')
        self.assertEqual(error.exception.status_code,503);self.assertFalse(parent.exists())

    def test_job_backup_inspect_confirm_and_range_download_preserve_records(self):
        with m.connection() as db:db.execute('UPDATE media SET favorite=1,progress=42')
        job=m.start_backup_job(m.BackupJobInput(full=False));ready=self.wait(self.jobs.get(job['id']));self.assertEqual(ready['state'],'ready')
        payload=(self.jobs.get(job['id']).folder/'avhub-backup.db').read_bytes()
        inspect=self.upload(payload);preview=self.wait(self.jobs.get(inspect['id']));self.assertEqual(preview['state'],'ready');self.assertEqual(preview['result']['media'],1)
        with m.connection() as db:db.execute('UPDATE media SET favorite=0,progress=0')
        started=m.commit_data_job(inspect['id']);self.assertEqual(started['kind'],'restore');done=self.wait(self.jobs.get(inspect['id']))
        self.assertEqual(done['state'],'ready');self.assertTrue(done['result']['ok']);self.assertEqual(m.media_record(1)['progress'],42)
        with self.assertRaises(HTTPException):m.commit_data_job(inspect['id'])
        self.assertEqual(self.source.read_bytes(),b'original video B')

    def test_corrupt_preview_cannot_modify_library_and_releases_staging(self):
        value=self.upload(b'PK broken archive');job=self.jobs.get(value['id']);result=self.wait(job)
        self.assertEqual(result['state'],'failed');self.assertIn('损坏',result['error']);self.assertFalse(job.folder.exists());self.assertEqual(m.media_record(1)['title'],'B')

    def test_cancellation_cleans_files_and_commit_refuses_cancellation(self):
        release=threading.Event();entered=threading.Event();job=self.jobs.allocate('backup')
        def work(current):
            (current.folder/'partial').write_bytes(b'partial');entered.set();release.wait(2);current.check()
        self.jobs.run(job,work);self.assertTrue(entered.wait(1));self.jobs.cancel(job.id);release.set();self.assertEqual(self.wait(job)['state'],'cancelled');self.assertFalse(job.folder.exists())
        committed=self.jobs.allocate('inspect');committed.state='ready';self.jobs.active=None
        entered.clear();release.clear()
        def commit(current):entered.set();release.wait(2);return {'ok':True}
        self.jobs.commit(committed.id,commit);self.assertTrue(entered.wait(1))
        with self.assertRaises(HTTPException) as error:self.jobs.cancel(committed.id)
        self.assertEqual(error.exception.status_code,409);release.set();self.assertEqual(self.wait(committed)['state'],'ready')

    def test_job_count_and_idle_expiration_are_bounded(self):
        for _ in range(8):
            job=self.jobs.allocate('backup');job.state='ready';self.jobs.active=None
        with self.assertRaises(HTTPException):self.jobs.allocate('backup')
        for job in self.jobs.jobs.values():job.touched=time.monotonic()-1201
        self.jobs.sweep();self.assertEqual(self.jobs.jobs,{})

    def test_repeated_cancelled_or_failed_jobs_do_not_exhaust_capacity(self):
        for number in range(20):
            job=self.jobs.allocate('backup');self.jobs.active=None
            if number%2:job.state='failed';self.jobs.remove_files(job)
            else:job.state='ready';self.jobs.cancel(job.id)
            self.assertLessEqual(len(self.jobs.jobs),8)
        self.assertIsNotNone(self.jobs.allocate('backup'))

    def test_playback_lease_temporarily_yields_without_persisting_pause(self):
        service=ThumbnailService(m.connection,lambda *args:(True,''),m.read_connection)
        service.playback_activity('a'*32,True);self.assertTrue(service.snapshot()['yielding']);self.assertFalse(service.snapshot()['paused'])
        service.playback_activity('b'*32,True);service.playback_activity('a'*32,False);self.assertTrue(service.yielding())
        service.playback_leases['b'*32]=time.monotonic()-1;self.assertFalse(service.yielding())
        with m.connection() as db:self.assertIsNone(db.execute('SELECT paused FROM thumbnail_control WHERE id=1').fetchone())

    def test_upload_disconnect_releases_job_slot_and_private_folder(self):
        calls=0
        async def receive():
            nonlocal calls;calls+=1
            return {'type':'http.request','body':b'PK partial','more_body':True} if calls==1 else {'type':'http.disconnect'}
        with self.assertRaises(Exception):asyncio.run(m.start_inspect_job(Request({'type':'http','method':'POST','path':'/api/data-jobs/inspect','headers':[]},receive)))
        self.assertIsNone(self.jobs.active);self.assertTrue(all(not job.folder.exists() for job in self.jobs.jobs.values()))

    def test_range_download_and_disconnected_sender_release_pin(self):
        value=m.start_backup_job(m.BackupJobInput(full=False));job=self.jobs.get(value['id']);self.wait(job)
        async def serve(response,fail=False):
            messages=[]
            async def send(message):
                if fail:raise RuntimeError('simulated disconnected sender')
                messages.append(message)
            async def receive():return {'type':'http.disconnect'}
            await response({'type':'http','method':'GET','headers':[(b'range',b'bytes=0-15')]},receive,send)
            return messages
        response=m.download_data_job(job.id);self.assertEqual(job.pins,1);messages=asyncio.run(serve(response))
        self.assertEqual(messages[0]['status'],206);self.assertEqual(messages[-1]['body'],b'SQLite format 3\0');self.assertEqual(job.pins,0)
        with self.assertRaises(RuntimeError):asyncio.run(serve(m.download_data_job(job.id),True))
        self.assertEqual(job.pins,0);self.jobs.cancel(job.id);self.assertFalse(job.folder.exists())
