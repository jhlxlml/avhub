"""Owned isolated fixtures: explicit cache-only cleanup, no source mutation."""
import asyncio
from contextlib import closing
import sqlite3
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException
import test_correctness as fixture
from app import main as m
from app import missing_artwork,artwork_readers
from app.file_operations import FileOperations
from app.scan_jobs import ThumbnailService


class MissingArtworkTests(unittest.TestCase):
    def setUp(self):
        fixture.CorrectnessTests.setUp(self)
        self.root=self.folder/'media';self.root.mkdir();self.root=self.root.resolve()
        self.source.rename(self.root/'B.mp4');self.source=self.root/'B.mp4'
        self.parked=self.folder/'parked.mp4';self.source.rename(self.parked)
        self.cover=self.thumbs/'1.jpg';self.cover.write_bytes(b'\xff\xd8owned automatic cover\xff\xd9')
        self.manual=self.folder/'covers'/('a'*32+'.jpg');self.manual.parent.mkdir();self.manual.write_bytes(b'personal artwork')
        with m.connection() as db:
            db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)',(str(self.root),))
            db.execute("UPDATE media SET root_id=1,path=?,missing=1,favorite=1,progress=37,title='personal',custom_cover=? WHERE id=1",(str(self.source),f'covers/{self.manual.name}'))
            db.execute("INSERT INTO playlists(id,name,created_at) VALUES(1,'personal list',0)")
            db.execute('INSERT INTO playlist_items VALUES(1,1,0)')
        service=ThumbnailService(m.connection,m.process_thumbnail,m.read_connection);self.addCleanup(service.close)
        for key,value in [('file_service',FileOperations(m.connection,m.read_connection)),('thumbnail_service',service),
                          ('native_prepare',SimpleNamespace(lock=threading.RLock(),jobs={})),('data_jobs',SimpleNamespace(active=None))]:
            context=patch.object(m,key,value);context.start();self.addCleanup(context.stop)

    def preview(self):return m.missing_artwork_status(1,24)

    def test_slow_preflight_does_not_hold_playback_control_lock(self):
        report=self.preview();entered=threading.Event();release=threading.Event();errors=[]
        original=missing_artwork.preview
        def slow(*args,**kwargs):
            value=original(*args,**kwargs);entered.set();release.wait(5);return value
        def execute():
            try:self.clean(report)
            except Exception as error:errors.append(error)
        with patch.object(missing_artwork,'preview',side_effect=slow):
            thread=threading.Thread(target=execute);thread.start()
            try:
                self.assertTrue(entered.wait(5));acquired=m.playback.lock.acquire(timeout=.2)
                self.assertTrue(acquired,'Slow preflight blocked playback control')
                if acquired:m.playback.lock.release()
            finally:release.set();thread.join(5)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,[])

    def test_backup_published_between_preflight_and_commit_is_rejected(self):
        report=self.preview();original=m.missing_artwork_snapshot
        def interleave(*args):
            value=original(*args);parent=self.folder/'backups';parent.mkdir()
            (parent/'before-restore-20200101-000000-ffffffff.db').write_bytes(b'uncertain new snapshot')
            return value
        with patch.object(m,'missing_artwork_snapshot',side_effect=interleave):
            with self.assertRaises(HTTPException) as error:self.clean(report)
        self.assertEqual(error.exception.status_code,409);self.assertTrue(self.cover.exists())

    def test_activity_started_between_preflight_and_commit_is_rejected(self):
        report=self.preview();original=m.missing_artwork_snapshot
        def interleave(*args):
            value=original(*args);m.file_service.activities['owned']=(1,time.monotonic()+120);return value
        with patch.object(m,'missing_artwork_snapshot',side_effect=interleave):
            with self.assertRaises(HTTPException) as error:self.clean(report)
        self.assertEqual(error.exception.status_code,409);self.assertTrue(self.cover.exists())

    def clean(self,report):
        return m.missing_artwork_cleanup(m.MissingArtworkCleanupInput(token=report['token'],media_ids=[1],page=report['page'],page_size=24))

    def test_preview_is_readonly_and_cleanup_preserves_all_personal_data_and_manual_art(self):
        before=m.media_record(1);original=self.parked.read_bytes();art=self.manual.read_bytes()
        report=self.preview();self.assertEqual(report['eligible_count'],1);self.assertEqual(report['eligible_bytes'],self.cover.stat().st_size)
        self.assertTrue(self.cover.exists());self.assertEqual(m.media_record(1),before)
        self.assertEqual(self.clean(report)['removed'],1);self.assertFalse(self.cover.exists())
        after=m.media_record(1);self.assertIsNone(after['thumbnail']);self.assertEqual(after['missing'],1)
        for key in before:
            if key not in ('thumbnail','updated_at','thumbnail_url'):self.assertEqual(after[key],before[key],key)
        self.assertEqual(self.manual.read_bytes(),art);self.assertEqual(self.parked.read_bytes(),original)
        self.assertEqual(m.playlist_detail(1,1,40)['items'][0]['id'],1)
        self.assertEqual(self.preview()['eligible_count'],0)

    def test_same_file_returning_before_confirmation_invalidates_preview(self):
        report=self.preview();self.parked.rename(self.source)
        with self.assertRaises(HTTPException) as error:self.clean(report)
        self.assertEqual(error.exception.status_code,409);self.assertTrue(self.cover.exists())
        self.assertIn('文件已出现',self.preview()['items'][0]['reason'])

    def test_offline_root_cannot_be_cleaned_and_cannot_reuse_online_token(self):
        report=self.preview();self.root.rename(self.folder/'offline')
        self.assertEqual(self.preview()['eligible_count'],0)
        with self.assertRaises(HTTPException):self.clean(report)
        self.assertTrue(self.cover.exists())

    def test_cache_replacement_or_newer_index_state_invalidates_preview(self):
        report=self.preview();self.cover.write_bytes(b'changed generated cover')
        with self.assertRaises(HTTPException):self.clean(report)
        report=self.preview()
        with m.connection() as db:db.execute('UPDATE media SET missing=0 WHERE id=1')
        with self.assertRaises(HTTPException):self.clean(report)
        self.assertTrue(self.cover.exists())

    def test_rollback_reference_and_corruption_fail_closed(self):
        parent=self.folder/'backups';parent.mkdir();backup=parent/'before-restore-20200101-000000-ffffffff.db'
        with closing(sqlite3.connect(m.DB)) as source,closing(sqlite3.connect(backup)) as target:source.backup(target)
        report=self.preview();self.assertEqual(report['eligible_count'],0);self.assertIn('回滚副本仍引用',report['items'][0]['reason'])
        backup.write_bytes(b'owned corrupt rollback')
        report=self.preview();self.assertEqual(report['eligible_count'],0);self.assertIn('无法核对',report['items'][0]['reason'])

    def test_late_backup_creation_invalidates_confirmation(self):
        report=self.preview();parent=self.folder/'backups';parent.mkdir();(parent/'before-restore-20200101-000000-ffffffff.db').write_bytes(b'uncertain')
        with self.assertRaises(HTTPException):self.clean(report)
        self.assertTrue(self.cover.exists())

    def test_indexed_source_at_the_cache_path_is_protected_even_without_thumbnail(self):
        with m.connection() as db:
            db.execute("INSERT INTO media(id,path,name,title,created_at,updated_at) VALUES(2,?,'source','source',0,0)",(str(self.cover).upper(),))
        report=self.preview();self.assertEqual(report['eligible_count'],0);self.assertIn('源文件',report['items'][0]['reason'])
        self.assertTrue(self.cover.exists())

    def test_unowned_or_linked_artwork_never_becomes_eligible(self):
        with patch.object(missing_artwork,'owned',return_value=False):
            self.assertEqual(self.preview()['eligible_count'],0)
        with patch.object(missing_artwork,'plain',return_value=False):
            self.assertEqual(self.preview()['eligible_count'],0)
        self.assertTrue(self.cover.exists())

    def test_active_playback_and_cover_response_pin_prevent_cleanup(self):
        report=self.preview();m.file_service.activities['owned']=(1,time.monotonic()+120)
        self.assertEqual(self.preview()['eligible_count'],0)
        with self.assertRaises(HTTPException):self.clean(report)
        m.file_service.activities.clear()
        # Pin the automatic artwork, not the independent manual cover stream.
        with m.connection() as db:db.execute('UPDATE media SET custom_cover=NULL WHERE id=1')
        response=m.get_thumb(1);self.assertTrue(artwork_readers.active(self.cover))
        self.assertEqual(self.preview()['eligible_count'],0)
        response._release();self.assertFalse(artwork_readers.active(self.cover))
        self.assertEqual(self.preview()['eligible_count'],1)

    def test_generic_orphan_cleanup_also_keeps_an_inflight_artwork_response(self):
        with m.connection() as db:db.execute('UPDATE media SET custom_cover=NULL WHERE id=1')
        response=m.get_thumb(1)
        with m.connection() as db:db.execute('UPDATE media SET thumbnail=NULL WHERE id=1')
        self.assertEqual(m.storage_status()['cleanup']['files'],0)
        response._release();self.assertEqual(m.storage_status()['cleanup']['files'],1)

    def test_scanning_and_data_tasks_refuse_cleanup(self):
        report=self.preview()
        with patch.object(m.scanner,'busy',return_value=True):
            with self.assertRaises(HTTPException):self.clean(report)
        m.data_jobs.active='owned-backup'
        with self.assertRaises(HTTPException):self.clean(report)
        self.assertTrue(self.cover.exists())

    def test_selection_cannot_smuggle_an_unpreviewed_id(self):
        report=self.preview()
        with self.assertRaises(HTTPException):
            m.missing_artwork_cleanup(m.MissingArtworkCleanupInput(token=report['token'],media_ids=[1,2]))
        self.assertTrue(self.cover.exists())

    def test_external_return_after_cleanup_can_regenerate_art_without_resetting_progress(self):
        self.clean(self.preview());self.parked.rename(self.source)
        def generate(*args,**kwargs):self.cover.write_bytes(b'\xff\xd8regenerated\xff\xd9');return '1.jpg'
        with patch.object(m,'thumbnail',side_effect=generate):m.scan_file(1,self.source)
        row=m.media_record(1);self.assertEqual(row['missing'],0);self.assertIsNotNone(row['thumbnail'])
        self.assertEqual((row['title'],row['favorite'],row['progress']),('personal',1,37));self.assertTrue(self.manual.exists())

    def test_artwork_pin_is_released_even_when_asgi_send_is_cancelled(self):
        response=artwork_readers.PinnedArtworkResponse(self.cover)
        async def send(_):raise asyncio.CancelledError()
        async def receive():return {'type':'http.disconnect'}
        async def run():await response({'type':'http','method':'GET','headers':[]},receive,send)
        with self.assertRaises(asyncio.CancelledError):asyncio.run(run())
        self.assertFalse(artwork_readers.active(self.cover))

    def test_permission_failure_is_not_treated_as_source_absence(self):
        original=missing_artwork.plain
        def denied(node):
            if node==self.source:raise PermissionError('owned denial')
            return original(node)
        with patch.object(missing_artwork,'plain',side_effect=denied):
            self.assertEqual(self.preview()['eligible_count'],0)
        self.assertTrue(self.cover.exists())

    def test_last_moment_source_return_is_skipped_without_changing_the_index(self):
        report=self.preview()
        with patch.object(missing_artwork,'absent',side_effect=[True,False]):
            result=self.clean(report)
        self.assertEqual((result['removed'],result['skipped']),(0,1))
        self.assertTrue(self.cover.exists());self.assertIsNotNone(m.media_record(1)['thumbnail'])

    def test_filesystem_validation_is_bounded_to_the_requested_page(self):
        with m.connection() as db:
            db.executemany('''INSERT INTO media(id,root_id,path,name,title,missing,file_state,created_at,updated_at)
                VALUES(?,1,?,'missing','missing',1,'normal',0,0)''',[(i,str(self.root/f'{i}.mp4')) for i in range(2,2002)])
        with patch.object(missing_artwork,'absent',wraps=missing_artwork.absent) as check:
            report=self.preview()
        self.assertEqual((report['total'],len(report['items'])),(2001,24));self.assertEqual(check.call_count,24)

    def test_cleanup_does_not_take_the_exclusive_original_file_read_gate(self):
        report=self.preview();entered=threading.Event();release=threading.Event();done=threading.Event();errors=[]
        def delayed(*args):entered.set();release.wait(3);return {'removed':0}
        def clean():
            try:self.clean(report)
            except BaseException as error:errors.append(error)
        def read():
            try:
                with m.read_connection() as db:self.assertEqual(db.execute('SELECT progress FROM media WHERE id=1').fetchone()[0],37)
            except BaseException as error:errors.append(error)
            finally:done.set()
        worker=threading.Thread(target=clean);reader=threading.Thread(target=read)
        with patch.object(missing_artwork,'clean',side_effect=delayed):
            try:
                worker.start();self.assertTrue(entered.wait(2));reader.start()
                self.assertTrue(done.wait(.5),'Cache cleanup must not block original-file WAL reads')
            finally:release.set();worker.join(4);reader.join(4)
        self.assertFalse(worker.is_alive());self.assertFalse(reader.is_alive());self.assertEqual(errors,[])
