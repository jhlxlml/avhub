"""Read-only observer tests; external mutations are simulated ONLY in fresh TEMP."""
import json
import os
from pathlib import Path
import unittest
from contextlib import nullcontext
from fastapi import HTTPException
from app.media_identity import MediaIdentity,install,encoded
from tests import test_file_operations as fixtures


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.FileOperationTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.files=self.fixture.service;self.source=self.fixture.source
        with self.fixture.connection() as db:
            db.execute('ALTER TABLE media ADD COLUMN size INTEGER');db.execute('ALTER TABLE media ADD COLUMN modified REAL');install(db)
            db.execute('UPDATE media SET size=?,modified=?',(self.source.stat().st_size,self.source.stat().st_mtime))
        self.service=MediaIdentity(self.files,lambda p:p.stem,volume=lambda _:True)
        self.service.observe(1,self.source,self.source.stat())
    def row(self):return self.fixture.row()
    def change(self):return self.service.list()['items'][0]
    def test_baseline_and_external_rename_preserve_personal_metadata_and_bytes(self):
        expected=self.source.read_bytes();target=self.source.with_name('外部改名🩷.mp4');os.rename(self.source,target)
        row=self.service.observe(1,target,target.stat());self.assertEqual(row['id'],1);self.assertEqual(self.row()['title'],'自定义标题')
        self.assertEqual((self.row()['favorite'],self.row()['progress']),(1,37));self.assertEqual(target.read_bytes(),expected)
        with self.fixture.connection() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM playlist_items').fetchone()[0],1)
    def test_automatic_title_follows_filename_but_manual_title_survives(self):
        with self.fixture.connection() as db:db.execute('UPDATE media SET title=?',(self.source.stem,))
        target=self.source.with_name('new title.mp4');os.rename(self.source,target);self.service.observe(1,target,target.stat())
        self.assertEqual(self.row()['title'],'new title')
    def test_replacement_even_same_size_and_timestamp_is_review_only(self):
        old=self.source.stat();replacement=self.source.with_name('owned-other.mp4');replacement.write_bytes(b'x'*old.st_size);os.utime(replacement,ns=(old.st_atime_ns,old.st_mtime_ns));os.replace(replacement,self.source)
        result=self.service.observe(1,self.source,self.source.stat());self.assertTrue(result['identity_review']);self.assertEqual(self.change()['kind'],'replacement')
        self.assertEqual(self.row()['file_state'],'review');self.assertFalse(self.files.allow_scan(self.source));self.assertEqual(self.row()['progress'],37)
    def test_content_metadata_changes_are_not_silently_assumed_same_video(self):
        self.source.write_bytes(b'owned changed source bytes');self.service.observe(1,self.source,self.source.stat())
        self.assertEqual(self.change()['kind'],'changed');self.assertEqual(self.row()['favorite'],1)
    def test_hardlinks_and_ambiguous_rows_are_never_merged(self):
        target=self.source.with_name('owned-hardlink.mp4');os.link(self.source,target)
        self.assertIsNone(self.service.observe(1,target,target.stat()))
        target.unlink();moved=self.source.with_name('owned-moved.mp4');os.rename(self.source,moved)
        with self.fixture.connection() as db:db.execute('INSERT INTO media(id,path,root_id,name,title,favorite,progress,missing,updated_at,source_identity) VALUES(2,?,1,?, ?,0,0,1,0,?)',(str(self.source.with_name('another-old.mp4')),'another-old.mp4','ambiguous',encoded(moved.stat())))
        self.assertIsNone(self.service.observe(1,moved,moved.stat()));self.assertEqual(self.row()['progress'],37)
    def test_stale_confirmation_refuses_new_source_and_never_changes_file(self):
        self.source.write_bytes(b'owned change 1');self.service.observe(1,self.source,self.source.stat());item=self.change();self.source.write_bytes(b'owned change 2 larger')
        with self.assertRaises(HTTPException):self.service.resolve(item['id'],'keep',item['signature'],lambda p:{},lambda *a:1,lambda _:nullcontext())
        self.assertEqual(self.source.read_bytes(),b'owned change 2 larger');self.assertEqual(self.row()['file_state'],'review')
    def test_keep_is_explicit_and_restores_access_without_file_mutation(self):
        self.source.write_bytes(b'owned revised video');self.service.observe(1,self.source,self.source.stat());item=self.change();expected=self.source.read_bytes()
        def commit(db,row,root,path,stat,metadata,decision):
            db.execute("UPDATE media SET file_state='normal',missing=0,source_identity=?,size=?,modified=? WHERE id=?",(encoded(stat),stat.st_size,stat.st_mtime,row['media_id']));return row['media_id']
        result=self.service.resolve(item['id'],'keep',item['signature'],lambda p:{},commit,lambda _:nullcontext())
        self.assertEqual(result['media_id'],1);self.assertEqual(self.row()['progress'],37);self.assertEqual(self.source.read_bytes(),expected);self.assertEqual(self.service.list()['total'],0)
    def test_original_file_returning_resolves_pending_change_without_metadata_loss(self):
        original=self.source.with_name('owned-original-saved.mp4');os.rename(self.source,original);self.source.write_bytes(b'owned replacement')
        self.service.observe(1,self.source,self.source.stat());self.assertEqual(self.service.list()['total'],1)
        self.source.unlink();os.rename(original,self.source);self.service.observe(1,self.source,self.source.stat(),self.row())
        self.assertEqual(self.service.list()['total'],0);self.assertEqual((self.row()['file_state'],self.row()['progress']),('normal',37));self.assertTrue(self.files.allow_scan(self.source))
