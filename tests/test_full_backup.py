import asyncio
import io
import json
import sqlite3
import subprocess
import hashlib
import zipfile
from pathlib import Path
from unittest.mock import patch
import unittest
from fastapi import HTTPException
from starlette.requests import Request
import test_correctness as fixture
from app import main as m
from app import library_backup as archive


class FullBackupTests(unittest.TestCase):
    setUp=fixture.CorrectnessTests.setUp
    restore=fixture.CorrectnessTests.restore

    def seed_images(self):
        self.cover='covers/'+'a'*32+'.jpg';file=self.folder/self.cover;file.parent.mkdir()
        subprocess.run([m.executable('ffmpeg'),'-v','error','-f','lavfi','-i','color=c=blue:s=160x90','-frames:v','1',str(file)],check=True,timeout=10,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.image=file.read_bytes();(self.thumbs/'1.jpg').write_bytes(self.image)
        with m.connection() as db:db.execute('UPDATE media SET custom_cover=?,favorite=1,progress=42 WHERE id=1',(self.cover,))

    def payload(self,thumbnails=False):return Path(m.create_backup(full=True,thumbnails=thumbnails).path).read_bytes()

    def rewrite(self,payload,edit):
        with zipfile.ZipFile(io.BytesIO(payload)) as source:files={name:source.read(name) for name in source.namelist()}
        edit(files);result=io.BytesIO()
        with zipfile.ZipFile(result,'w') as target:
            for name,value in files.items():target.writestr(name,value)
        return result.getvalue()

    def test_full_backup_transports_manual_cover_and_optional_thumbnail_without_sources(self):
        self.seed_images();payload=self.payload(True)
        with zipfile.ZipFile(io.BytesIO(payload)) as zip:
            self.assertEqual(set(zip.namelist()),{'manifest.json','library.db',self.cover,'thumbnails/1.jpg'})
        (self.folder/self.cover).unlink();(self.thumbs/'1.jpg').write_bytes(b'\xff\xd8wrong old\xff\xd9')
        with m.connection() as db:db.execute("UPDATE media SET path='old-other-source',custom_cover=NULL,favorite=0,progress=0")
        self.assertTrue(self.restore(payload)['full'])
        row=m.media_record(1);self.assertEqual(row['progress'],42);self.assertEqual(row['favorite'],1)
        self.assertNotEqual(row['custom_cover'],self.cover);self.assertEqual((self.folder/row['custom_cover']).read_bytes(),self.image)
        self.assertEqual((self.thumbs/'1.jpg').read_bytes(),self.image);self.assertEqual(self.source.read_bytes(),b'original video B')

    def test_without_thumbnails_clears_derived_references_but_keeps_old_files(self):
        self.seed_images();payload=self.payload()
        with zipfile.ZipFile(io.BytesIO(payload)) as zip:self.assertNotIn('thumbnails/1.jpg',zip.namelist())
        self.restore(payload);self.assertIsNone(m.media_record(1)['thumbnail']);self.assertTrue((self.thumbs/'1.jpg').exists())

    def test_corrupted_checksum_cannot_modify_live_library(self):
        self.seed_images();payload=self.rewrite(self.payload(),lambda files:files.update({self.cover:b'\xff\xd8corrupted\xff\xd9'}))
        with self.assertRaises(HTTPException) as error:self.restore(payload)
        self.assertEqual(error.exception.status_code,400);self.assertEqual(m.media_record(1)['custom_cover'],self.cover)
        self.assertFalse(any((self.folder/'backups').glob('restore-*')))

    def test_traversal_extra_file_and_unsupported_version_rejected(self):
        self.seed_images();original=self.payload()
        for edit in [lambda files:files.update({'../escape.jpg':b'bad'}),
                     lambda files:files.update({'video.mp4':b'bad'}),
                     lambda files:files.update({'manifest.json':json.dumps({'format':'avhub-library','version':99,'files':{}}).encode()})]:
            with self.assertRaises(HTTPException) as error:self.restore(self.rewrite(original,edit))
            self.assertEqual(error.exception.status_code,400)
        self.assertFalse((self.folder.parent/'escape.jpg').exists())

    def test_duplicate_entry_and_expanded_size_limit_rejected(self):
        self.seed_images();payload=self.payload();buffer=io.BytesIO(payload)
        with zipfile.ZipFile(buffer,'a') as zip:zip.writestr('library.db',b'duplicate')
        with self.assertRaises(HTTPException):self.restore(buffer.getvalue())
        with patch.object(archive,'MAX_ARCHIVE',1024),self.assertRaises(HTTPException) as error:self.restore(payload)
        self.assertEqual(error.exception.status_code,413)

    def test_database_or_publish_failure_rolls_back_images_records_and_queue(self):
        self.seed_images();payload=self.payload(True);original=m.media_record(1)
        old=(self.thumbs/'1.jpg').read_bytes();existing=set((self.folder/'covers').iterdir())
        with patch.object(m,'bootstrap',side_effect=OSError('simulated storage failure')),self.assertRaises(HTTPException) as error:self.restore(payload)
        self.assertEqual(error.exception.status_code,503)
        self.assertEqual(m.media_record(1)['custom_cover'],original['custom_cover']);self.assertEqual((self.thumbs/'1.jpg').read_bytes(),old)
        self.assertEqual(set((self.folder/'covers').iterdir()),existing)
        self.assertEqual(len(list((self.folder/'backups').glob('before-restore-*.db'))),1)

    def test_missing_manual_cover_cancels_complete_backup(self):
        self.seed_images();(self.folder/self.cover).unlink()
        with self.assertRaises(HTTPException) as error:self.payload()
        self.assertIn('手动封面缺失',error.exception.detail)
        self.assertEqual(list((self.folder/'backups').glob('.snapshot-*')),[])

    def test_restore_reconciles_interrupted_scan_state_without_replaying_it(self):
        self.seed_images()
        with m.connection() as db:db.execute('INSERT OR REPLACE INTO scan_checkpoint VALUES(1,1,0)')
        payload=self.payload();m.scanner.job=None
        self.restore(payload);self.assertEqual(m.scanner.snapshot()['state'],'interrupted');self.assertFalse(m.scanner.busy())
        with m.connection() as db:db.execute('DELETE FROM scan_checkpoint')
        payload=self.payload();self.restore(payload);self.assertIsNone(m.scanner.snapshot())

    def test_upload_disconnect_cleans_staging_without_touching_library(self):
        calls=0
        async def receive():
            nonlocal calls;calls+=1
            if calls==1:return {'type':'http.request','body':b'PKincomplete','more_body':True}
            return {'type':'http.disconnect'}
        request=Request({'type':'http','method':'POST','path':'/api/backup/restore','headers':[]},receive)
        with self.assertRaises(Exception):asyncio.run(m.restore_backup(request))
        self.assertFalse(any((self.folder/'backups').glob('restore-*')));self.assertEqual(m.media_record(1)['title'],'B')

    def test_valid_checksum_cannot_bypass_image_dimensions_and_database_limit(self):
        self.seed_images();original=self.payload()
        def forged(files):
            files[self.cover]=b'\xff\xd8\xff\xc0\x00\x07\x08\xff\xff\xff\xff\xff\xd9'
            manifest=json.loads(files['manifest.json']);manifest['files'][self.cover]={'size':len(files[self.cover]),'sha256':hashlib.sha256(files[self.cover]).hexdigest()}
            files['manifest.json']=json.dumps(manifest).encode()
        with self.assertRaises(HTTPException) as error:self.restore(self.rewrite(original,forged))
        self.assertIn('超大图片',error.exception.detail)
        with patch.object(archive,'MAX_DATABASE',1024),self.assertRaises(HTTPException):self.restore(original)

    def test_failure_after_first_thumbnail_publish_restores_original_bytes(self):
        self.seed_images()
        with m.connection() as db:db.execute("INSERT INTO media(id,path,name,title,thumbnail,created_at,updated_at) VALUES(2,'fixture-second.mp4','second','second','thumbnails/2.jpg',0,0)")
        (self.thumbs/'2.jpg').write_bytes(self.image);payload=self.payload(True)
        for number in [1,2]:(self.thumbs/f'{number}.jpg').write_bytes(b'\xff\xd8old '+str(number).encode()+b'\xff\xd9')
        original_copy=m.shutil.copyfile;count=0
        def fail_second(source,target,*args,**kwargs):
            nonlocal count
            if Path(target).name.startswith('.restore-'):
                count+=1
                if count==2:raise OSError('simulated partial publish failure')
            return original_copy(source,target,*args,**kwargs)
        with patch.object(m.shutil,'copyfile',side_effect=fail_second),self.assertRaises(HTTPException):self.restore(payload)
        for number in [1,2]:self.assertEqual((self.thumbs/f'{number}.jpg').read_bytes(),b'\xff\xd8old '+str(number).encode()+b'\xff\xd9')
        self.assertEqual(m.media_record(1)['custom_cover'],self.cover)
