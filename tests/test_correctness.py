import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from starlette.requests import Request
from starlette.responses import Response
from fastapi import HTTPException
import test_stability  # Configures an isolated database before importing the app.
from app import main as m
from app.local_security import local_request_error
from app.playback import PlaybackManager


class CorrectnessTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='avhub-correctness-')
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.thumbs = self.folder / 'thumbnails'
        self.thumbs.mkdir()
        for name, value in [('DATA', self.folder), ('DB', self.folder / 'library.db'), ('THUMBS', self.thumbs)]:
            context = patch.object(m, name, value)
            context.start(); self.addCleanup(context.stop)
        m.playback.close(); m.scanner.close(); m.bootstrap()
        self.source = self.folder / 'B.mp4'
        self.source.write_bytes(b'original video B')
        info = self.source.stat()
        with m.connection() as db:
            db.execute('''INSERT INTO media(id,path,name,title,size,modified,duration,thumbnail,created_at,updated_at)
                VALUES(1,?,'B.mp4','B',?,?,120,'thumbnails/1.jpg',0,0)''',
                (str(self.source.resolve()), info.st_size, info.st_mtime))

    def restore(self, payload):
        async def receive(): return {'type':'http.request', 'body':payload, 'more_body':False}
        request = Request({'type':'http', 'method':'POST', 'path':'/api/backup/restore', 'headers':[]}, receive)
        return asyncio.run(m.restore_backup(request))

    def test_restore_invalidates_same_id_cover_from_different_source_and_scan_repairs_it(self):
        payload = Path(m.create_backup().path).read_bytes()
        old = b'\xff\xd8cover A\xff\xd9'
        (self.thumbs / '1.jpg').write_bytes(old)
        with m.connection() as db:
            db.execute("UPDATE media SET path=?,title='A' WHERE id=1", (str(self.folder / 'A.mp4'),))
        self.assertTrue(self.restore(payload)['ok'])
        self.assertEqual(m.one_media(1)['title'], 'B')
        self.assertIsNone(m.one_media(1)['thumbnail_url'])
        with self.assertRaises(HTTPException) as error: m.get_thumb(1)
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual((self.thumbs / '1.jpg').read_bytes(), old)  # No destructive cache clearing.
        def generate(command, *_):
            Path(command[-1]).write_bytes(b'\xff\xd8cover B\xff\xd9');return 0,b'',b''
        with patch.object(m, 'probe') as probe, patch.object(m, 'scan_process', side_effect=generate):
            self.assertFalse(m.scan_file(1, self.source))
            probe.assert_not_called()
        self.assertEqual(Path(m.get_thumb(1).path).read_bytes(), b'\xff\xd8cover B\xff\xd9')
        self.assertEqual(self.source.read_bytes(), b'original video B')

    def test_restore_reuses_matching_source_cache_but_rejects_changed_fingerprint(self):
        jpeg = b'\xff\xd8verified cover B\xff\xd9'
        (self.thumbs / '1.jpg').write_bytes(jpeg)
        payload = Path(m.create_backup().path).read_bytes()
        self.restore(payload)
        self.assertEqual(Path(m.get_thumb(1).path).read_bytes(), jpeg)
        with m.connection() as db: db.execute('UPDATE media SET size=size+1 WHERE id=1')
        self.restore(payload)
        with self.assertRaises(HTTPException): m.get_thumb(1)

    def test_new_playlist_and_first_item_commit_together(self):
        created = m.create_playlist(m.PlaylistInput(name='New', media_id=1))
        self.assertEqual(created['count'], 1)
        detail = m.playlist_detail(created['id'])
        self.assertEqual([item['id'] for item in detail['items']], [1])
        self.assertEqual(detail['revision'], 1)
        with self.assertRaises(HTTPException) as error: m.create_playlist(m.PlaylistInput(name='New', media_id=1))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(len(m.playlists()), 1)

    def test_restore_does_not_trust_a_cover_without_source_fingerprint(self):
        (self.thumbs / '1.jpg').write_bytes(b'\xff\xd8unknown source\xff\xd9')
        with m.connection() as db: db.execute('UPDATE media SET size=NULL,modified=NULL WHERE id=1')
        self.restore(Path(m.create_backup().path).read_bytes())
        with self.assertRaises(HTTPException): m.get_thumb(1)

    def test_invalid_or_offline_media_does_not_create_an_empty_playlist(self):
        for media_id in [2, 1]:
            with m.connection() as db: db.execute('UPDATE media SET missing=1 WHERE id=1')
            with self.assertRaises(HTTPException) as error: m.create_playlist(m.PlaylistInput(name='Must not exist', media_id=media_id))
            self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(m.playlists(), [])

    def test_live_hls_manifest_uses_one_snapshot_for_body_and_content_length(self):
        path = self.folder / 'index.m3u8'
        old = b'#EXTM3U\n#EXTINF:2,\nsegment_000001.ts\n'
        path.write_bytes(old)
        with patch.object(m.playback, 'manifest', side_effect=lambda _: path.read_bytes()):
            response = m.hls_file('test', 'index.m3u8')
        path.write_bytes(old + b'#EXTINF:2,\nsegment_000002.ts\n')
        self.assertEqual(response.body, old)
        self.assertEqual(int(response.headers['content-length']),len(old))
        self.assertEqual(response.headers['cache-control'],'no-store')

    def test_locked_session_cache_is_retried_and_retained_for_later_cleanup(self):
        manager = PlaybackManager(self.folder)
        cache = self.folder / ('a' * 32)
        cache.mkdir(); (cache / 'index.m3u8').write_bytes(b'locked fixture')
        with patch('app.playback.shutil.rmtree'), patch('app.playback.time.sleep'):
            manager._remove_folder(cache)
        self.assertIn(cache, manager.pending_removals)
        manager.sweep()
        self.assertFalse(cache.exists())
        self.assertEqual(manager.pending_removals,set())
        outside = self.folder / 'not-a-session'
        outside.mkdir()
        manager._remove_folder(outside)
        self.assertTrue(outside.exists())


class LocalSecurityTests(unittest.TestCase):
    def request(self, method='POST', host='127.0.0.1:8765', **headers):
        scope = {'type':'http', 'scheme':'http', 'method':method, 'path':'/api/media/1/favorite',
                 'query_string':b'', 'server':('127.0.0.1',8765),
                 'headers':[(b'host',host.encode())] + [(key.replace('_','-').encode(), value.encode()) for key,value in headers.items()]}
        return Request(scope)

    def test_browser_and_desktop_reject_foreign_host(self):
        for desktop in [False, True]:
            for host in ['foreign.example:8765', '127.0.0.1:8766', '127.0.0.1.attacker.example:8765']:
                self.assertIsNotNone(local_request_error(self.request(host=host), 8765, desktop))
        self.assertIsNone(local_request_error(self.request(host='localhost:8765', origin='http://localhost:8765'),8765,False))
        self.assertIsNotNone(local_request_error(self.request(host='localhost:8765'),8765,True))

    def test_cross_origin_and_fetch_metadata_writes_are_rejected(self):
        for method in ['POST','PUT','PATCH','DELETE']:
            for origin in ['https://foreign.example','null','http://localhost:8765','http://127.0.0.1:8766','http://127.0.0.1:8765/path']:
                self.assertIsNotNone(local_request_error(self.request(method=method, origin=origin),8765,False))
            self.assertIsNotNone(local_request_error(self.request(method=method, referer='https://foreign.example/page'),8765,False))
            self.assertIsNotNone(local_request_error(self.request(method=method, sec_fetch_site='cross-site'),8765,False))
            self.assertIsNone(local_request_error(self.request(method=method, origin='http://127.0.0.1:8765',sec_fetch_site='same-origin'),8765,False))
        self.assertIsNone(local_request_error(self.request(),8765,False))  # Local CLI clients.

    def test_actual_server_port_is_used_instead_of_default(self):
        request = self.request(host='127.0.0.1:8877', origin='http://127.0.0.1:8877')
        request.scope['server'] = ('127.0.0.1',8877)
        self.assertIsNone(local_request_error(request,8765,False))

    def test_middleware_sets_headers_and_keeps_desktop_authentication(self):
        async def next_handler(request): return Response('ok')
        async def call(request): return await m.protect_desktop_session(request,next_handler)
        with patch.object(m,'SESSION_TOKEN',''):
            response = asyncio.run(call(self.request(origin='http://127.0.0.1:8765')))
            self.assertEqual(response.status_code,200)
            self.assertIn("frame-ancestors 'none'",response.headers['content-security-policy'])
            self.assertEqual(response.headers['x-frame-options'],'DENY')
            self.assertEqual(response.headers['x-content-type-options'],'nosniff')
            self.assertEqual(asyncio.run(call(self.request(origin='https://foreign.example'))).status_code,403)
        with patch.object(m,'SESSION_TOKEN','secret'):
            self.assertEqual(asyncio.run(call(self.request())).status_code,403)
            self.assertEqual(asyncio.run(call(self.request(x_avhub_token='secret'))).status_code,200)
            self.assertEqual(asyncio.run(call(self.request(x_avhub_token='secret',origin='https://foreign.example'))).status_code,403)
            self.assertEqual(asyncio.run(call(self.request(cookie='avhub_session=secret'))).status_code,200)
            entry = self.request(method='GET'); entry.scope['path'] = '/'
            self.assertIn('HttpOnly',asyncio.run(call(entry)).headers['set-cookie'])
