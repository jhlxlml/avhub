import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_stability
from app import main as m


class ThumbnailTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='avhub-thumbnails-')
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.cache = self.folder / 'thumbnails'
        self.cache.mkdir()
        for name, value in [('DATA',self.folder),('THUMBS',self.cache),('DB',self.folder/'library.db')]:
            context = patch.object(m,name,value)
            context.start(); self.addCleanup(context.stop)
        m.bootstrap()
        with m.connection() as db:
            db.execute('DELETE FROM media')

    def test_real_subsecond_clip_gets_a_complete_jpeg_without_changing_source(self):
        source = self.folder / 'short.mp4'
        subprocess.run([m.executable('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=25',
                        '-t', '0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(source)], check=True)
        digest = hashlib.sha256(source.read_bytes()).digest()
        self.assertEqual(m.thumbnail(source, 1, .2), 'thumbnails/1.jpg')
        self.assertTrue(m.valid_thumbnail(self.cache/'1.jpg'))
        subprocess.run([m.executable('ffmpeg'), '-v', 'error', '-i', str(self.cache/'1.jpg'), '-frames:v', '1', '-f', 'null', '-'], check=True)
        self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), digest)
        self.assertEqual([p.name for p in self.cache.iterdir()], ['1.jpg'])

    def test_failed_seek_retries_first_frame_and_publishes_only_complete_image(self):
        seeks = []
        def generate(command, *_):
            seeks.append(float(command[command.index('-ss')+1]))
            self.assertFalse((self.cache/'1.jpg').exists())
            Path(command[-1]).write_bytes(b'partial' if len(seeks)==1 else b'\xff\xd8complete\xff\xd9')
            return 0,b'',b''
        with patch.object(m, 'scan_process', side_effect=generate):
            self.assertEqual(m.thumbnail(self.folder/'source.mp4', 1, 120), 'thumbnails/1.jpg')
        self.assertEqual(len(seeks), 2); self.assertAlmostEqual(seeks[0],14.4); self.assertEqual(seeks[1],0)
        self.assertEqual([p.name for p in self.cache.iterdir()], ['1.jpg'])

    def test_cancelled_or_failed_generation_preserves_old_cover_and_cleans_temporary(self):
        old = b'\xff\xd8old\xff\xd9'
        (self.cache/'1.jpg').write_bytes(old)
        with patch.object(m, 'scan_process', side_effect=m.ScanCancelled):
            with self.assertRaises(m.ScanCancelled): m.thumbnail(self.folder/'video.mp4', 1, 20, force=True)
        with patch.object(m, 'scan_process', side_effect=RuntimeError('decode failed')):
            self.assertIsNone(m.thumbnail(self.folder/'video.mp4', 1, 20, force=True))
        self.assertEqual((self.cache/'1.jpg').read_bytes(), old)
        self.assertEqual([p.name for p in self.cache.iterdir()], ['1.jpg'])

    def test_incremental_scan_repairs_missing_cache_without_probing_unchanged_video(self):
        source = self.folder/'unchanged.mp4'; source.write_bytes(b'original')
        stat = source.stat()
        with m.connection() as db:
            db.execute('''INSERT INTO media(id,path,root_id,name,title,size,modified,duration,thumbnail,created_at,updated_at)
                VALUES(1,?,1,'file','title',?,?,20,'thumbnails/1.jpg',0,1)''', (str(source.resolve()),stat.st_size,stat.st_mtime))
        before = m.one_media(1)['thumbnail_url']
        def generate(command, *_):
            Path(command[-1]).write_bytes(b'\xff\xd8generated\xff\xd9');return 0,b'',b''
        with patch.object(m, 'probe') as probe, patch.object(m, 'scan_process', side_effect=generate) as process:
            self.assertFalse(m.scan_file(1, source))
            probe.assert_not_called(); self.assertEqual(process.call_count, 1)
            self.assertFalse(m.scan_file(1, source)); self.assertEqual(process.call_count, 1)
        self.assertNotEqual(m.one_media(1)['thumbnail_url'], before)
        self.assertEqual(source.read_bytes(), b'original')

    def test_empty_and_truncated_cache_is_rejected(self):
        for content in [b'', b'\xff', b'\xff\xd8partial', b'not a jpeg']:
            (self.cache/'1.jpg').write_bytes(content)
            self.assertFalse(m.valid_thumbnail(self.cache/'1.jpg'))
            with self.assertRaises(m.HTTPException) as error: m.get_thumb(1)
            self.assertEqual(error.exception.status_code, 404)

    def test_changed_source_publication_guard_preserves_old_cached_image(self):
        old=b'\xff\xd8old\xff\xd9';(self.cache/'1.jpg').write_bytes(old)
        def generate(command,*_):
            Path(command[-1]).write_bytes(b'\xff\xd8new\xff\xd9');return 0,b'',b''
        with patch.object(m,'scan_process',side_effect=generate):
            self.assertIsNone(m.thumbnail(self.folder/'source.mp4',1,120,force=True,publish_if=lambda:False))
        self.assertEqual((self.cache/'1.jpg').read_bytes(),old)
        self.assertEqual([p.name for p in self.cache.iterdir()],['1.jpg'])
