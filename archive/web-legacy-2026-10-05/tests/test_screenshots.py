import asyncio
import json
import struct
import tempfile
import unittest
import uuid
import zlib
from pathlib import Path
from unittest.mock import patch
from starlette.requests import Request
from starlette.requests import ClientDisconnect
from fastapi import HTTPException
from pydantic import ValidationError
import test_stability  # Isolated database configured before the app import.
from app import main as m
from app import screenshots as s


def chunk(kind,body):
    return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)

def png(width=320,height=180,raw=None):
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw if raw is not None else (b'\0'+b'\x00\x44\x88\xff'*width)*height))+chunk(b'IEND',b'')


class ScreenshotTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory(prefix='avhub-screenshots-');self.addCleanup(temporary.cleanup)
        self.folder=Path(temporary.name)
        for name,value in [('DATA',self.folder),('DB',self.folder/'library.db'),('THUMBS',self.folder/'thumbnails'),('screenshot_store',s.ScreenshotStore())]:
            context=patch.object(m,name,value);context.start();self.addCleanup(context.stop)
        m.THUMBS.mkdir();m.bootstrap()
        self.source=self.folder/'original.mp4';self.source.write_bytes(b'read-only original video')
        self.original_stat=self.source.stat()
        with m.connection() as db:db.execute("INSERT INTO media(id,path,name,title,duration,created_at,updated_at) VALUES(1,?,'original','Title: / unsafe',120,0,0)",(str(self.source),))

    def upload(self,payload=None,identity=None,point=12.345,media_id=1,content_type='image/png',disconnect=False):
        identity=identity or uuid.uuid4().hex
        parts=[payload if payload is not None else png()]
        async def receive():
            if disconnect:return {'type':'http.disconnect'}
            return {'type':'http.request','body':parts.pop(),'more_body':False}
        request=Request({'type':'http','method':'POST','path':'/api/media/1/screenshot','headers':[(b'content-type',content_type.encode())]},receive)
        return asyncio.run(m.save_screenshot(media_id,request,point,identity))

    def assert_no_images(self):
        self.assertEqual(list(self.folder.rglob('*.png')),[])
        self.assertEqual(list((self.folder/'screenshot-staging').glob('*')),[])

    def test_default_save_preserves_png_bytes_dimensions_and_source(self):
        payload=png();saved=self.upload(payload)
        self.assertEqual(Path(saved['path']).read_bytes(),payload)
        self.assertEqual((saved['width'],saved['height']),(320,180))
        self.assertEqual(Path(saved['directory']),self.folder/'screenshots')
        self.assertIn('00-00-12.345',saved['filename'])
        self.assertNotIn('/',saved['filename']);self.assertNotIn(':',saved['filename'])
        self.assertEqual(m.saved_screenshot(saved['id']),saved)
        self.assertEqual(self.source.read_bytes(),b'read-only original video')
        self.assertEqual(self.source.stat().st_mtime_ns,self.original_stat.st_mtime_ns)

    def test_custom_directory_and_shortcut_persist_with_fresh_store(self):
        directory=self.folder/'custom';directory.mkdir()
        saved=m.save_screenshot_settings(m.ScreenshotSettingsInput(directory=str(directory),shortcut='C'))
        m.screenshot_store=s.ScreenshotStore()
        self.assertEqual(m.screenshot_settings(),saved)
        self.assertEqual(Path(self.upload()['path']).parent,directory)
        self.assertEqual(m.get_preferences()['values']['screenshots']['shortcut'],'C')

    def test_legacy_shortcuts_normalize_to_c_without_losing_directory(self):
        directory=self.folder/'custom';directory.mkdir()
        for shortcut in ('F8','Shift+S'):
            with self.subTest(shortcut=shortcut):
                with m.connection() as db:db.execute("INSERT OR REPLACE INTO preferences VALUES('screenshots',?,0)",(json.dumps({'directory':str(directory),'shortcut':shortcut}),))
                settings=m.screenshot_settings()
                self.assertEqual(settings['directory'],str(directory));self.assertEqual(settings['shortcut'],'C')
                self.assertEqual(m.get_preferences()['values']['screenshots']['shortcut'],'C')
                self.assertEqual(Path(self.upload()['path']).parent,directory)
                m.set_preferences(m.PreferencesInput(values={'screenshots':{'directory':str(directory),'shortcut':shortcut}}))
                with m.connection() as db:self.assertEqual(json.loads(db.execute("SELECT value FROM preferences WHERE key='screenshots'").fetchone()[0])['shortcut'],'C')

    def test_settings_only_offer_c_and_frame_endpoint_is_removed(self):
        self.assertEqual(m.ScreenshotSettingsInput().shortcut,'C')
        for shortcut in ('F8','Shift+S'):
            with self.assertRaises(ValidationError):m.ScreenshotSettingsInput(shortcut=shortcut)
        self.assertFalse(any(route.path=='/api/media/{media_id}/frame' for route in m.app.routes))

    def test_settings_read_does_not_create_default_directory(self):
        self.assertTrue(m.screenshot_settings()['available'])
        self.assertFalse((self.folder/'screenshots').exists())

    def test_explicit_save_survives_clock_rollback_and_rejects_late_preference_write(self):
        future=1e15
        m.set_preferences(m.PreferencesInput(values={'screenshots':{'directory':'','shortcut':'C'}},updated_at=future))
        directory=self.folder/'custom';directory.mkdir()
        self.assertEqual(m.save_screenshot_settings(m.ScreenshotSettingsInput(directory=str(directory)))['directory'],str(directory))
        m.set_preferences(m.PreferencesInput(values={'screenshots':{'directory':'','shortcut':'F8'}},updated_at=future))
        self.assertEqual(m.screenshot_settings()['directory'],str(directory))
        self.assertEqual(m.screenshot_settings()['shortcut'],'C')

    def test_repeated_identity_is_idempotent_and_new_identity_never_overwrites(self):
        identity=uuid.uuid4().hex;first=self.upload(identity=identity)
        self.assertEqual(first,self.upload(identity=identity))
        second=self.upload();self.assertNotEqual(first['path'],second['path'])
        self.assertEqual(len(list((self.folder/'screenshots').glob('*.png'))),2)
        with self.assertRaises(HTTPException):self.upload(identity=identity,point=13)

    def test_malformed_png_crc_and_trailing_data_are_rejected_and_cleaned(self):
        payload=png()
        for invalid in [b'<!doctype html>',payload[:-2],payload[:-4]+b'wrong',payload+b'extra',payload[:40]+b'x'+payload[41:]]:
            with self.subTest(size=len(invalid)),self.assertRaises(HTTPException) as error:self.upload(invalid)
            self.assertEqual(error.exception.status_code,422);self.assert_no_images()

    def test_decompression_size_and_nonempty_iend_rejected(self):
        for invalid in [png(1,1,b'\0'*1000000),png()[:-12]+chunk(b'IEND',b'x')]:
            with self.assertRaises(HTTPException):self.upload(invalid)
        self.assert_no_images()

    def test_upload_byte_limit_and_pixel_limit(self):
        with patch.object(s,'MAX_BYTES',10),self.assertRaises(HTTPException) as error:self.upload()
        self.assertEqual(error.exception.status_code,413)
        with patch.object(s,'MAX_PIXELS',100),self.assertRaises(HTTPException):self.upload()
        self.assert_no_images()

    def test_disconnect_and_bad_media_or_type_leave_no_partial_file(self):
        with self.assertRaises(ClientDisconnect):self.upload(disconnect=True)
        for arguments,status in [({'media_id':999},404),({'content_type':'text/html'},415)]:
            with self.assertRaises(HTTPException) as error:self.upload(**arguments)
            self.assertEqual(error.exception.status_code,status)
        self.assert_no_images();self.assertEqual(m.screenshot_store.running,{})

    def test_missing_directory_keeps_configuration_and_never_falls_back(self):
        directory=self.folder/'custom';directory.mkdir()
        m.save_screenshot_settings(m.ScreenshotSettingsInput(directory=str(directory)))
        directory.rmdir()
        settings=m.screenshot_settings();self.assertFalse(settings['available']);self.assertEqual(settings['directory'],str(directory))
        with self.assertRaises(HTTPException) as error:self.upload()
        self.assertEqual(error.exception.status_code,503);self.assertFalse((self.folder/'screenshots').exists())
        m.save_screenshot_settings(m.ScreenshotSettingsInput())
        self.assertTrue(m.screenshot_settings()['available'])

    def test_invalid_preferences_and_missing_destination_not_persisted(self):
        for directory in ['relative','C:\\folder:stream','\\\\?\\C:\\folder','\\\\.\\PIPE\\a',str(self.folder/'missing')]:
            with self.subTest(directory=directory),self.assertRaises(HTTPException):m.save_screenshot_settings(m.ScreenshotSettingsInput(directory=directory))
            self.assertNotIn('screenshots',m.get_preferences()['values'])

    def test_metadata_expiration_does_not_delete_screenshots(self):
        result=self.upload()
        with patch('app.screenshots.time.monotonic',return_value=1e30):m.screenshot_store.prune()
        self.assertEqual(m.screenshot_store.saved,{})
        self.assertTrue(Path(result['path']).is_file())

    def test_permission_failure_never_replaces_other_files_or_keeps_partial_file(self):
        with patch('app.screenshots.shutil.copyfileobj',side_effect=PermissionError('disk full')),self.assertRaises(HTTPException) as error:self.upload()
        self.assertEqual(error.exception.status_code,503);self.assert_no_images()
        self.assertEqual(self.source.read_bytes(),b'read-only original video')
