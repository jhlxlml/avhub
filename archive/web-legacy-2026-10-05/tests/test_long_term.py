import hashlib
import json
import io
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock
from pathlib import Path
from unittest.mock import patch

import test_stability
from test_stability import Process
from app import main as m
from app.playback import PlaybackManager
from app.hls_cache import parse_manifest, window_manifest
from app.cache_owner import running
from fastapi import HTTPException


def playlist(count=12):
    return ('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n' +
            ''.join(f'#EXTINF:2,\nsegment_{i:06}.ts\n' for i in range(count))).encode()


class RollingCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='avhub-rolling-')
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.mp4'; self.source.write_bytes(b'original untouched')
        self.manager = PlaybackManager(self.root / 'cache')
        self.process = Process()
        with patch('app.playback.subprocess.Popen', return_value=self.process):
            self.token = self.manager.create(self.source, 'ffmpeg', offset=45)['token']
        self.session = self.manager.sessions[self.token]
        (self.session.folder / 'index.m3u8').write_bytes(playlist())
        for i in range(12): (self.session.folder / f'segment_{i:06}.ts').write_bytes(b'fragment' * 25)

    def tearDown(self):
        self.manager.close(); self.temp.cleanup()

    def test_retention_removes_only_old_prefix_and_advertises_accurate_window(self):
        self.manager.back_seconds = 6
        status = self.manager.status(self.token, position=65)
        self.assertEqual((status['window_start'], status['window_end']), (59, 69))
        self.assertEqual(status['state'], 'ready')
        content = self.manager.manifest(self.token)
        self.assertIn(b'#EXT-X-MEDIA-SEQUENCE:7', content)
        self.assertNotIn(b'#EXT-X-PLAYLIST-TYPE:EVENT', content)
        self.assertNotIn(b'segment_000006.ts', content)
        self.assertIn(b'segment_000007.ts', content)
        with self.assertRaises(HTTPException) as exc: self.manager.file(self.token, 'segment_000000.ts')
        self.assertEqual(exc.exception.status_code, 410)
        self.assertEqual(self.source.read_bytes(), b'original untouched')

    def test_byte_pressure_shrinks_retention_without_failing_or_killing(self):
        self.manager.cache_target = 2500
        status = self.manager.status(self.token, position=65)
        self.assertEqual(self.session.first_sequence, 5)
        self.assertEqual(status['state'], 'ready')
        self.assertFalse(self.process.terminated)
        self.assertTrue((self.session.folder / 'segment_000010.ts').is_file())

    def test_capacity_target_cannot_deadlock_publication_near_buffer_end(self):
        self.session.cache_bytes = self.manager.cache_target * 2
        self.session.generated = 8
        self.session.playhead = 0
        self.assertTrue(self.manager._should_throttle(self.session))
        self.session.playhead = 7.75
        self.assertFalse(self.manager._should_throttle(self.session))
        self.manager.cache_target = 2500
        self.manager.status(self.token, position=68)
        self.assertGreaterEqual(self.session.first_sequence, 10)

    def test_windows_locked_fragment_is_retried_but_not_advertised(self):
        self.manager.back_seconds = 6
        with patch.object(Path, 'unlink', side_effect=PermissionError('locked reader')):
            self.manager.status(self.token, position=65)
        self.assertTrue(self.session.expired_files)
        self.assertIn(b'#EXT-X-MEDIA-SEQUENCE:7', self.manager.manifest(self.token))
        self.manager.status(self.token, position=65)
        self.assertFalse(self.session.expired_files)

    def test_discontinuity_sequence_and_very_long_playlist(self):
        original = playlist(7200).replace(b'#EXTINF:2,\nsegment_000001.ts', b'#EXT-X-DISCONTINUITY\n#EXTINF:2,\nsegment_000001.ts') + b'#EXT-X-ENDLIST\n'
        content = window_manifest(original, 7180)
        self.assertIn(b'#EXT-X-MEDIA-SEQUENCE:7180', content)
        self.assertIn(b'#EXT-X-DISCONTINUITY-SEQUENCE:1', content)
        self.assertEqual(len(parse_manifest(content)[1]), 20)
        self.assertTrue(content.endswith(b'#EXT-X-ENDLIST\n'))

    def test_cancelled_late_creation_is_rejected_and_tombstones_are_bounded(self):
        token = 'f' * 32
        self.manager.stop(token)
        with self.assertRaises(HTTPException): self.manager.create(self.source, 'ffmpeg', client_token=token)
        for i in range(2050): self.manager.stop(f'{i:032x}')
        self.assertLessEqual(len(self.manager.cancelled_creations), 2048)

    def test_crash_cleanup_does_not_remove_active_unknown_or_external_directories(self):
        dead = self.manager.cache / ('a' * 32); dead.mkdir(); (dead / 'owner.json').write_text(json.dumps({'pid': 987654}))
        unknown = self.manager.cache / ('b' * 32); unknown.mkdir()
        other = self.manager.cache / 'do-not-remove'; other.mkdir()
        with patch('app.cache_owner.running', side_effect=lambda pid: pid != 987654):
            recovered = PlaybackManager(self.manager.cache)
        self.assertFalse(dead.exists()); self.assertTrue(unknown.exists()); self.assertTrue(other.exists())
        self.assertTrue(self.session.folder.exists()); recovered.close()
        self.assertTrue(running(__import__('os').getpid()))

    def test_two_tasks_keep_independent_windows_and_progress(self):
        with patch('app.playback.subprocess.Popen', return_value=Process()):
            second = self.manager.create(self.source, 'ffmpeg')['token']
        self.manager.back_seconds = 6
        self.manager.status(self.token, position=65)
        self.assertEqual(self.manager.sessions[second].playhead, 0)
        self.assertEqual(self.manager.sessions[second].first_sequence, 0)

    def test_full_disk_and_unwritable_creation_have_actionable_errors(self):
        (self.session.folder / 'ffmpeg.log').write_bytes(b'No space left on device')
        self.process.code = 1
        self.assertIn('磁盘空间不足', self.manager.status(self.token)['error'])
        with patch.object(Path, 'mkdir', side_effect=PermissionError('read only')):
            with self.assertRaises(HTTPException) as error: self.manager.create(self.source, 'ffmpeg')
        self.assertEqual(error.exception.status_code, 503)
        self.assertIn('写入权限', error.exception.detail)

    def test_repeated_encoder_errors_do_not_fill_the_cache_and_wait_forever(self):
        with (self.session.folder / 'ffmpeg.log').open('wb') as log: log.truncate(5 * 1024**2)
        status = self.manager.status(self.token, position=45)
        self.assertEqual(status['state'], 'failed')
        self.assertIn('大量报错', status['error'])
        self.assertTrue(self.process.terminated)

    def test_errors_before_first_manifest_are_stopped_by_background_sweep(self):
        (self.session.folder / 'index.m3u8').unlink()
        with (self.session.folder / 'ffmpeg.log').open('wb') as log: log.truncate(5 * 1024**2)
        self.manager.sweep()
        self.assertIn('大量报错', self.session.error)
        self.assertTrue(self.process.terminated)
        self.assertTrue(self.session.log.closed)

    def test_cache_read_failure_returns_failed_status_and_stops_encoder(self):
        with patch.object(Path, 'read_bytes', side_effect=OSError('cache disconnected')):
            result = self.manager.status(self.token, position=65)
        self.assertEqual(result['state'], 'failed')
        self.assertIn('缓存不可读写', result['error'])
        self.assertTrue(self.process.terminated)
        self.assertTrue(self.session.log.closed)

    def test_manifest_write_failure_retires_worker_and_encoder(self):
        self.process.stdout = io.BytesIO(playlist(1))
        with patch.object(Path, 'write_bytes', side_effect=OSError('disk full')):
            self.manager._pace(self.session)
        self.assertIn('缓存不可读写', self.session.error)
        self.assertTrue(self.process.terminated)
        self.assertTrue(self.process.stdout.closed)

    def test_existing_failed_task_cannot_keep_a_running_encoder(self):
        self.session.error = 'previous error'
        self.session.throttled = True
        self.manager.sweep()
        self.assertTrue(self.process.terminated)

    def test_owned_job_is_closed_on_stop_and_guard_failure_leaves_no_task(self):
        owner = Mock()
        self.session.owner = owner
        self.manager.stop(self.token)
        owner.close.assert_called_once()
        failed = Process(); failed.stdout = io.BytesIO()
        def kill(): failed.code = -9
        failed.kill = kill
        with patch('app.playback.subprocess.Popen', return_value=failed), \
             patch('app.playback.own_encoder', side_effect=OSError('job assignment denied')):
            with self.assertRaises(HTTPException) as error:
                self.manager.create(self.source, 'ffmpeg')
        self.assertEqual(error.exception.status_code, 503)
        self.assertIn('进程保护', error.exception.detail)
        self.assertEqual(failed.poll(), -9)
        self.assertTrue(failed.stdout.closed)
        self.assertEqual(self.manager.sessions, {})
        self.assertEqual(list(self.manager.cache.iterdir()), [])


class ActualPacingTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows owner-exit job protection')
    def test_killed_owner_releases_pipe_encoder_and_restart_cleans_owned_cache(self):
        # Only kill our temporary helper, never a user's service or media task.
        with tempfile.TemporaryDirectory(prefix='avhub-crash-') as directory:
            root = Path(directory); source = root / 'source.mkv'; cache = root / 'cache'
            subprocess.run([m.executable('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x18:r=25',
                            '-t', '180', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', str(source)],
                           check=True, timeout=20)
            code = '''import json, sys, time
from pathlib import Path
from app.playback import PlaybackManager
p = PlaybackManager(Path(sys.argv[1]), ahead_seconds=4)
r = p.create(Path(sys.argv[2]), sys.argv[3], copy_video=True)
s = p.sessions[r['token']]
while not s.throttled and not s.error: time.sleep(.05)
print(json.dumps({'token': s.token, 'pid': s.process.pid}), flush=True)
time.sleep(60)
'''
            child = subprocess.Popen([sys.executable, '-u', '-c', code, str(cache), str(source), m.executable('ffmpeg')],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                                         creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                # communicate timeout bounds helper startup even if it hangs.
                try: child.communicate(timeout=8)
                except subprocess.TimeoutExpired: pass
                child.kill(); output, error = child.communicate(timeout=5)
                self.assertTrue(output.strip(), error.decode(errors='replace'))
                data = json.loads(output.splitlines()[0])
                deadline = time.monotonic() + 8
                while running(data['pid']) and time.monotonic() < deadline: time.sleep(.1)
                self.assertFalse(running(data['pid']), 'FFmpeg must exit when the owner pipe closes')
                self.assertIsNone(unrelated.poll(), 'Unrelated processes must not be terminated')
                self.assertTrue((cache / data['token']).exists())
                recovered = PlaybackManager(cache)
                try: self.assertFalse((cache / data['token']).exists())
                finally: recovered.close()
                self.assertTrue(source.is_file())
            finally:
                if child.poll() is None: child.kill()
                child.communicate(timeout=5)
                if unrelated.poll() is None: unrelated.kill()
                unrelated.wait(timeout=5)

    def test_pipe_manifest_protocol(self):
        with tempfile.TemporaryDirectory(prefix='avhub-pipe-') as directory:
            root = Path(directory)
            result = subprocess.run([m.executable('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=32x18:r=25',
                            '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-f', 'hls', '-hls_time', '1',
                            '-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments+temp_file',
                            '-hls_segment_filename', str(root / 'segment_%06d.ts'), 'pipe:1'], capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertGreater(result.stdout.count(b'#EXTM3U'), 3)
            self.assertIn(b'#EXT-X-ENDLIST', result.stdout)
            self.assertGreater(len(list(root.glob('segment_*.ts'))), 3)
    def test_two_hour_source_pauses_generation_resumes_and_retires_worker(self):
        with tempfile.TemporaryDirectory(prefix='avhub-long-source-') as directory:
            root = Path(directory); source = root / 'two-hour.mkv'
            subprocess.run([m.executable('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=32x18:r=25',
                            '-t', '7200', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', str(source)], check=True, timeout=30)
            before = hashlib.sha256(source.read_bytes()).digest()
            manager = PlaybackManager(root / 'cache', ahead_seconds=12, back_seconds=6)
            try:
                token = manager.create(source, m.executable('ffmpeg'), copy_video=True)['token']
                session = manager.sessions[token]
                def wait_for(predicate):
                    deadline = time.monotonic() + 10
                    while not predicate() and time.monotonic() < deadline: time.sleep(.05)
                    self.assertTrue(predicate(), (session.folder / 'ffmpeg.log').read_text())
                wait_for(lambda: session.throttled and session.window_end >= 12)
                # A low-frame-rate source emits fewer progress records. Wait
                # for the bounded pipe to fill, rather than assuming no output
                # remains in flight as soon as our reader enters its wait.
                settled = time.monotonic(); deadline = settled + 15
                count = len(list(session.folder.glob('segment_*.ts')))
                while time.monotonic() < deadline and time.monotonic() - settled < 3:
                    time.sleep(.1)
                    current = len(list(session.folder.glob('segment_*.ts')))
                    if current != count: count = current; settled = time.monotonic()
                self.assertGreaterEqual(time.monotonic() - settled, 3, f'producer must stop growing its cache; window={session.window_end}, read={session.generated}')
                time.sleep(.4)
                self.assertEqual(len(list(session.folder.glob('segment_*.ts'))), count)
                self.assertIsNone(session.process.poll())
                previous_end = session.window_end
                manager.status(token, position=previous_end - 2)
                wait_for(lambda: session.window_end >= previous_end + 6)
                self.assertGreater(session.first_sequence, 0)
                self.assertEqual(manager.status(token)['state'], 'ready')
                worker = session.worker
                manager.stop(token); worker.join(timeout=2)
                self.assertFalse(worker.is_alive())
                self.assertFalse(session.folder.exists())
                self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), before)
            finally: manager.close()


class DiagnosticsTests(unittest.TestCase):
    def test_reports_actual_paths_protocol_and_no_session_token(self):
        report = m.diagnostics()
        self.assertEqual(report['data_dir'], str(m.DATA))
        self.assertEqual(report['database'], str(m.DB))
        self.assertEqual(report['build']['api_protocol'], 2)
        self.assertEqual(report['build']['build_id'], m.health()['build_id'])
        self.assertNotIn('session_token', json.dumps(report))
        self.assertIn('ffmpeg', report['tools'])
