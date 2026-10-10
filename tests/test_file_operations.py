"""Mutation tests only touch newly-created temporary samples, never user media."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from fastapi import HTTPException
from app.file_operations import FileOperations,install,new_filename,identity,operation_error
from unittest.mock import patch


class FileOperationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='avhub-file-tests-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.media=self.root/'media';self.media.mkdir();self.source=self.media/'源视频🩷.mp4';self.source.write_bytes(b'owned synthetic bytes')
        self.db=self.root/'test.db'
        with self.connection() as db:
            db.executescript('CREATE TABLE roots(id INTEGER PRIMARY KEY,path TEXT,added_at REAL);CREATE TABLE media(id INTEGER PRIMARY KEY,path TEXT UNIQUE,root_id INTEGER,name TEXT,title TEXT,favorite INTEGER,progress REAL,missing INTEGER,updated_at REAL);CREATE TABLE playlist_items(playlist_id INTEGER,media_id INTEGER,position INTEGER);')
            db.execute('INSERT INTO roots VALUES(1,?,0)',(str(self.media),));db.execute('INSERT INTO media VALUES(1,?,1,?,?,1,37,0,0)',(str(self.source),self.source.name,'自定义标题'));db.execute('INSERT INTO playlist_items VALUES(5,1,8)');install(db)
        self.service=FileOperations(self.connection,self.connection,(self.root/'protected',),volume=lambda path:True)

    @contextmanager
    def connection(self):
        db=sqlite3.connect(self.db);db.row_factory=sqlite3.Row
        try:yield db;db.commit()
        finally:db.close()

    def grant(self):self.service.authorize(1,True,True)
    def row(self):
        with self.connection() as db:return dict(db.execute('SELECT * FROM media WHERE id=1').fetchone())

    def test_default_readonly_and_nested_directory_deny(self):
        with self.assertRaises(HTTPException):self.service.prepare(1,'rename','new')
        self.grant()
        with self.connection() as db:db.execute('INSERT INTO roots VALUES(2,?,0)',(str(self.media),))
        # A deeper ungranted directory wins over an authorized parent.
        nested=self.media/'nested';nested.mkdir();target=nested/self.source.name;os.rename(self.source,target)
        with self.connection() as db:db.execute('UPDATE roots SET path=? WHERE id=2',(str(nested),));db.execute('UPDATE media SET path=? WHERE id=1',(str(target),))
        with self.assertRaises(HTTPException):self.service.prepare(1,'recycle')

    @unittest.skipUnless(os.name=='nt','Windows no-replace rename semantics')
    def test_rename_keeps_identity_records_bytes_and_title_after_restart(self):
        self.grant();before=identity(self.source);digest=hashlib.sha256(self.source.read_bytes()).digest()
        result=self.service.rename(1,'新名⭐');row=self.row();target=Path(row['path'])
        self.assertEqual(identity(target),before);self.assertEqual(hashlib.sha256(target.read_bytes()).digest(),digest);self.assertEqual((row['id'],row['title'],row['favorite'],row['progress']),(1,'新名⭐',1,37))
        with self.connection() as db:self.assertEqual(tuple(db.execute('SELECT * FROM playlist_items').fetchone()),(5,1,8))
        fresh=FileOperations(self.connection,self.connection,volume=lambda path:True);fresh.recover()
        self.assertFalse(self.source.exists());self.assertEqual(self.row()['name'],target.name);self.assertEqual(self.row()['title'],'新名⭐');self.assertEqual(fresh.history()['items'][0]['state'],'completed')

    def test_invalid_names_and_conflicts_do_not_change_files(self):
        for stem in ('','../other','bad/name','CON','nul.txt','COM¹','trailing.','trailing ','bad\x00name'):
            with self.assertRaises(HTTPException):new_filename(stem,'.mp4')
        self.grant();target=self.media/'already.mp4';target.write_bytes(b'another owned sample')
        with self.assertRaises(HTTPException):self.service.prepare(1,'rename','already')
        self.assertEqual(target.read_bytes(),b'another owned sample');self.assertTrue(self.source.exists())
        self.assertEqual(new_filename('new.mkv','.mp4'),'new.mkv.mp4')

    @unittest.skipUnless(os.name=='nt','Windows case-only rename')
    def test_case_only_rename(self):
        target=self.media/'CaseProbe.mp4';os.rename(self.source,target);self.source=target
        with self.connection() as db:db.execute('UPDATE media SET path=?,name=? WHERE id=1',(str(target),target.name))
        self.grant();result=self.service.rename(1,'caseprobe');self.assertEqual(self.row()['name'],'caseprobe.mp4')
        self.assertEqual(self.row()['title'],'caseprobe');self.assertEqual(target.read_bytes(),b'owned synthetic bytes')

    def test_active_readers_activity_and_duplicate_requests_are_rejected(self):
        self.grant()
        with self.service.reader(1):
            with self.assertRaises(HTTPException):self.service.prepare(1,'recycle')
        self.service.activity('owner',1,True)
        with self.assertRaises(HTTPException):self.service.prepare(1,'recycle')
        self.service.activity('owner',1,False);op=self.service.prepare(1,'recycle')
        with self.assertRaises(HTTPException):self.service.require_idle()
        with self.assertRaises(HTTPException):self.service.prepare(1,'recycle')
        with self.assertRaises(HTTPException):
            with self.service.reader(1):pass
        self.service.finish(op['id'],False,'mock OS refuses recycle');self.assertTrue(self.source.exists());self.assertEqual(self.row()['file_state'],'normal')

    def test_interrupted_rename_reconciles_without_filesystem_writes(self):
        self.grant();op=self.service.prepare(1,'rename','recovered');os.rename(self.source,op['target'])
        fresh=FileOperations(self.connection,self.connection,volume=lambda path:True);fresh.recover();self.assertEqual(self.row()['path'],op['target']);self.assertEqual(self.row()['file_state'],'normal')

    def test_interrupted_before_rename_releases_reservation(self):
        self.grant();self.service.prepare(1,'rename','not_executed');fresh=FileOperations(self.connection,self.connection,volume=lambda path:True);fresh.recover()
        self.assertEqual(self.row()['file_state'],'normal');self.assertTrue(self.source.exists());fresh.require_idle()

    def test_recycle_unit_simulation_preserves_records_and_matches_restoration(self):
        self.grant();op=self.service.prepare(1,'recycle');owned=self.root/'mock-recycler.mp4';os.rename(self.source,owned)
        self.service.finish(op['id'],True);self.assertEqual(self.row()['file_state'],'recycled');self.assertEqual(self.row()['progress'],37)
        with self.assertRaises(HTTPException):
            with self.service.reader(1):pass
        os.rename(owned,self.source);self.assertTrue(self.service.allow_scan(self.source));self.assertEqual(self.row()['file_state'],'normal')

    def test_unconfirmed_recycle_and_replaced_source_stay_quarantined(self):
        self.grant();op=self.service.prepare(1,'recycle');owned=self.root/'mock-recycler.mp4';os.rename(self.source,owned)
        fresh=FileOperations(self.connection,self.connection,volume=lambda path:True);fresh.recover();self.assertEqual(self.row()['file_state'],'review')
        self.source.write_bytes(b'different source');self.assertFalse(fresh.allow_scan(self.source));self.assertEqual(self.row()['missing'],1)

    def test_protected_and_changed_roots_cannot_grant_or_mutate(self):
        self.service.protected.append(self.media)
        with self.assertRaises(HTTPException):self.grant()
        self.service.protected.pop();self.grant();new=self.root/'replacement';new.mkdir()
        with self.connection() as db:db.execute('UPDATE roots SET path=? WHERE id=1',(str(new),))
        with self.assertRaises(HTTPException):self.service.prepare(1,'recycle')

    def test_confirmation_detects_external_changes(self):
        self.grant();op=self.service.prepare(1,'recycle');self.source.write_bytes(b'changed externally')
        with self.assertRaises(HTTPException):self.service.verify(op['id'])
        with self.assertRaises(HTTPException):self.service.finish(op['id'],False,'changed')
        self.assertEqual(self.row()['file_state'],'review');self.assertEqual(self.service.history()['items'][0]['state'],'review')

    def test_os_errors_are_not_all_reported_as_occupancy(self):
        for code,text in ((32,'占用'),(33,'占用'),(5,'拒绝访问'),(19,'拒绝访问'),(2,'已不存在'),(112,'空间不足'),(206,'路径过长')):
            error=OSError('synthetic refusal');error.winerror=code
            self.assertIn(text,operation_error(error))
        self.assertIn('系统未能完成',operation_error(OSError('unknown')))
        self.grant()
        with patch('app.file_operations.os.rename',side_effect=PermissionError('synthetic refusal')):
            with self.assertRaises(HTTPException) as caught:self.service.rename(1,'failed')
        self.assertIn('拒绝访问',caught.exception.detail)
        self.assertIn('拒绝访问',self.service.history()['items'][0]['error'])
        self.assertTrue(self.source.exists());self.assertEqual(self.row()['file_state'],'normal')

    @unittest.skipUnless(os.name=='nt','Windows rename semantics')
    def test_history_is_readonly_without_undo_capability(self):
        self.grant();self.service.rename(1,'first');self.service.rename(1,'second')
        items=self.service.history()['items'];self.assertEqual(len(items),2)
        self.assertFalse(hasattr(self.service,'undo'));self.assertTrue(all('can_undo' not in row and 'undo_reason' not in row for row in items))
        self.assertEqual(self.row()['title'],'second')

    def test_state_filters_and_recheck_do_not_accept_replacement(self):
        self.grant();op=self.service.prepare(1,'recycle');owned=self.root/'mock-recycler.mp4';os.rename(self.source,owned);self.service.finish(op['id'],True)
        self.assertEqual(self.service.states(state='recycled')['items'][0]['status'],'recycled');self.assertEqual(self.service.states(state='missing')['total'],0)
        self.assertFalse(self.service.recheck(1)['restored'])
        self.source.write_bytes(b'owned replacement');self.assertFalse(self.service.recheck(1)['restored']);self.assertEqual(self.row()['file_state'],'recycled')
        self.source.unlink();os.rename(owned,self.source);self.assertTrue(self.service.recheck(1)['restored']);self.assertEqual(self.service.states()['total'],0)
        with self.connection() as db:db.execute('UPDATE media SET missing=1 WHERE id=1')
        self.assertEqual(self.service.states(state='missing')['total'],1);self.assertFalse(self.service.recheck(1)['restored']);self.assertEqual(self.row()['missing'],1)

    def test_title_columns_migrate_existing_journal(self):
        with self.connection() as db:
            db.execute('ALTER TABLE file_operations DROP COLUMN old_title');db.execute('ALTER TABLE file_operations DROP COLUMN new_title');install(db)
            self.assertIn('old_title',{row[1] for row in db.execute('PRAGMA table_info(file_operations)')})

    @unittest.skipUnless(os.name=='nt','Windows rename semantics')
    def test_renaming_retains_sidecar_links_without_modifying_subtitle(self):
        self.grant();subtitle=self.source.with_suffix('.zh.srt');subtitle.write_bytes(b'owned subtitle')
        original=identity(subtitle);self.service.rename(1,'first');self.service.rename(1,'second')
        self.assertEqual(identity(subtitle),original);self.assertEqual(subtitle.read_bytes(),b'owned subtitle')
        links=self.service.linked_subtitles(1,Path(self.row()['path']));self.assertEqual(links,[{'name':subtitle.name,'path':str(subtitle)}])
        subtitle.write_bytes(b'owned modified subtitle');self.assertEqual(self.service.linked_subtitles(1,Path(self.row()['path'])),[])

    def test_forget_requires_proven_absence_and_preserves_recyclable_records(self):
        with self.connection() as db:db.execute('UPDATE media SET missing=1 WHERE id=1')
        with self.assertRaises(HTTPException):self.service.forget_missing(1)
        with patch('app.file_operations.Path.lstat',side_effect=PermissionError('owned denied')):
            with self.assertRaises(HTTPException):self.service.forget_missing(1)
        self.source.unlink()
        with self.connection() as db:db.execute("UPDATE media SET file_state='recycled' WHERE id=1")
        with self.assertRaises(HTTPException):self.service.forget_missing(1)
        with self.connection() as db:db.execute("UPDATE media SET file_state='normal' WHERE id=1")
        result=self.service.forget_missing(1);self.assertTrue(result['ok'])
        with self.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM media').fetchone()[0],0);self.assertEqual(db.execute('SELECT COUNT(*) FROM playlist_items').fetchone()[0],0)
        self.assertEqual(self.service.history()['items'][0]['action'],'forget')

    def test_closed_playback_owner_cannot_be_revived_by_late_heartbeat(self):
        self.assertTrue(self.service.activity('owner',1,True));self.assertTrue(self.service.activity('owner',1,False))
        self.assertFalse(self.service.activity('owner',1,True));self.assertNotIn('owner',self.service.activities)
        self.assertTrue(self.service.activity('new-owner',1,True));self.assertIn('new-owner',self.service.activities)

    def test_batch_preview_skips_ungranted_missing_and_busy_sources(self):
        preview=self.service.preview_recycle([1,1,999]);self.assertEqual(len(preview['items']),2);self.assertFalse(preview['items'][0]['eligible'])
        self.grant();self.service.activity('owner',1,True);preview=self.service.preview_recycle([1]);self.assertFalse(preview['items'][0]['eligible']);self.assertIn('读取',preview['items'][0]['reason'])
        self.service.activity('owner',1,False);preview=self.service.preview_recycle([1]);self.assertTrue(preview['items'][0]['eligible']);self.assertEqual(preview['items'][0]['size'],self.source.stat().st_size)
        def busy(media_id):raise HTTPException(409,'synthetic encoder running')
        preview=self.service.preview_recycle([1],busy);self.assertFalse(preview['items'][0]['eligible']);self.assertIn('encoder',preview['items'][0]['reason'])

    def test_batch_snapshot_refuses_changes_expiration_and_permission_revocation(self):
        self.grant();preview=self.service.preview_recycle([1]);token=preview['preview_token'];self.source.write_bytes(b'owned changed bytes')
        with self.assertRaises(HTTPException):self.service.prepare(1,'recycle',preview_token=token)
        self.assertTrue(self.source.exists());self.assertEqual(self.row()['file_state'],'normal')
        preview=self.service.preview_recycle([1]);token=preview['preview_token'];self.service.previews[token]['expires']=0
        with self.assertRaises(HTTPException):self.service.prepare(1,'recycle',preview_token=token)
        preview=self.service.preview_recycle([1]);self.service.authorize(1,True,False)
        with self.assertRaises(HTTPException):self.service.prepare(1,'recycle',preview_token=preview['preview_token'])

    def test_batch_token_is_bound_to_ids_and_consumed_once(self):
        self.grant();preview=self.service.preview_recycle([1]);token=preview['preview_token']
        with self.assertRaises(HTTPException):self.service.prepare(999,'recycle',preview_token=token)
        op=self.service.prepare(1,'recycle',preview_token=token);self.service.finish(op['id'],False,'owned simulated OS refusal')
        with self.assertRaises(HTTPException):self.service.prepare(1,'recycle',preview_token=token)
        self.assertTrue(self.source.exists());self.assertEqual(self.row()['file_state'],'normal');self.assertNotIn(token,self.service.previews)

    def test_single_actions_reject_stale_index_and_report_each_permission(self):
        self.service.authorize(1,False,True);info=self.service.info(1)
        self.assertFalse(info['rename']);self.assertTrue(info['recycle']);self.assertIn('重命名：',info['reason']);self.assertEqual(info['recycle_reason'],'')
        with self.connection() as db:
            db.execute('ALTER TABLE media ADD COLUMN size INTEGER');db.execute('ALTER TABLE media ADD COLUMN modified REAL')
            db.execute('UPDATE media SET size=?,modified=?',(self.source.stat().st_size,self.source.stat().st_mtime))
        self.source.write_bytes(b'owned newer content changed externally')
        with self.assertRaises(HTTPException) as caught:self.service.prepare(1,'recycle')
        self.assertIn('刷新媒体库',caught.exception.detail);self.assertTrue(self.source.exists());self.assertEqual(self.row()['file_state'],'normal')

if __name__=='__main__':unittest.main()
