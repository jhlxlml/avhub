import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_data = tempfile.TemporaryDirectory(prefix="avhub-unit-")
os.environ['AVHUB_DATA_DIR'] = _data.name
from app import main as m
from app.playback import PlaybackManager
from fastapi import HTTPException


def tearDownModule():
    m.playback.close()
    _data.cleanup()


class LibraryTests(unittest.TestCase):
    def setUp(self):
        with m.connection() as db:
            db.execute('DELETE FROM media')
            db.execute('DELETE FROM playlist_items')
            db.execute('DELETE FROM playlists')
            db.execute('''INSERT INTO media(id,path,name,title,duration,progress,watched,created_at,updated_at)
                          VALUES(1,'fixture.mp4','fixture','fixture',120,0,0,0,0)''')

    def test_delayed_progress_cannot_overwrite_newer_pause_or_completion(self):
        m.save_progress(1, m.ProgressInput(progress=35, updated_at=2000))
        result = m.save_progress(1, m.ProgressInput(progress=8, updated_at=1000))
        self.assertEqual(result['progress'], 35)
        m.save_progress(1, m.ProgressInput(progress=120, watched=True, updated_at=3000))
        m.save_progress(1, m.ProgressInput(progress=40, updated_at=2500))
        self.assertEqual(m.media(view='continue', limit=300), [])
        m.save_progress(1, m.ProgressInput(progress=2, watched=False, updated_at=4000))
        self.assertEqual(len(m.media(view='continue', limit=300)), 1)

    def test_clear_history_resets_watch_state_without_removing_media(self):
        m.save_progress(1, m.ProgressInput(progress=35, updated_at=2000))
        self.assertEqual(len(m.media(view='history', limit=300)), 1)
        cleared = m.clear_history(1)
        self.assertEqual(cleared['progress'], 0)
        self.assertFalse(cleared['watched'])
        self.assertIsNone(cleared['last_played'])
        self.assertEqual(m.media(view='history', limit=300), [])
        self.assertEqual(len(m.media(limit=300)), 1)

    def test_format_watch_and_duration_filters_compose(self):
        with m.connection() as db:
            db.execute("UPDATE media SET ext='.mp4',duration=120,watched=0 WHERE id=1")
            db.executemany("INSERT INTO media(id,path,name,title,ext,duration,watched,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,0)", [
                (2,'long.mkv','long.mkv','长片','.mkv',6000,0),
                (3,'short.mkv','short.mkv','短片','.mkv',900,1),
            ])
        result = m.media(format_ext='mkv', duration_band='long', watch_status='unwatched', limit=300)
        self.assertEqual([item['id'] for item in result], [2])

    def test_idempotent_favorite(self):
        for _ in range(2): m.set_favorite(1, m.FavoriteInput(favorite=True))
        self.assertEqual(len(m.media(favorite=True, limit=300)), 1)
        m.set_favorite(1, m.FavoriteInput(favorite=False))
        self.assertEqual(m.media(favorite=True, limit=300), [])
        self.assertEqual(len(m.media(limit=300)), 1)

    def test_next_episode_follows_season_and_episode_order(self):
        with m.connection() as db:
            db.execute("UPDATE media SET title='示例剧',kind='episode',season=1,episode=1 WHERE id=1")
            db.executemany("INSERT INTO media(id,path,name,title,kind,season,episode,duration,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,0)", [
                (2,'episode-2.mkv','episode-2.mkv','示例剧','episode',1,2,100),
                (3,'episode-s2e1.mkv','episode-s2e1.mkv','示例剧','episode',2,1,100),
                (4,'other-show.mkv','other-show.mkv','另一部剧','episode',1,2,100),
            ])
        self.assertEqual(m.next_episode(1)['next']['id'], 2)
        self.assertEqual(m.next_episode(2)['next']['id'], 3)
        self.assertIsNone(m.next_episode(3)['next'])

    def test_playlist_items_keep_order_and_can_be_removed(self):
        with m.connection() as db:
            db.execute("INSERT INTO media(id,path,name,title,ext,duration,created_at,updated_at) VALUES(2,'second.mp4','second.mp4','second','.mp4',90,0,0)")
        created = m.create_playlist(m.PlaylistInput(name='片单'))
        playlist_id = created['id']
        m.add_playlist_item(playlist_id, 1)
        m.add_playlist_item(playlist_id, 2)
        m.add_playlist_item(playlist_id, 2)
        detail = m.playlist_detail(playlist_id)
        self.assertEqual([item['id'] for item in detail['items']], [1, 2])
        with m.connection() as db: db.execute('UPDATE media SET missing=1 WHERE id=1')
        detail = m.playlist_detail(playlist_id)
        self.assertEqual([item['id'] for item in detail['items']], [1, 2])
        self.assertTrue(detail['items'][0]['missing'])
        detail = m.reorder_playlist_items(playlist_id, m.PlaylistOrderInput(media_ids=[2, 1]))
        self.assertEqual([item['id'] for item in detail['items']], [2, 1])
        detail = m.rename_playlist(playlist_id, m.PlaylistInput(name='已整理'))
        self.assertEqual(detail['name'], '已整理')
        detail = m.remove_playlist_item(playlist_id, 1)
        self.assertEqual([item['id'] for item in detail['items']], [2])
        self.assertTrue(m.delete_playlist(playlist_id)['ok'])
        with self.assertRaises(HTTPException): m.playlist_detail(playlist_id)

    def test_duplicate_playlist_name_returns_conflict_instead_of_server_error(self):
        m.create_playlist(m.PlaylistInput(name='片单'))
        with self.assertRaises(HTTPException) as error:
            m.create_playlist(m.PlaylistInput(name='片单'))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(error.exception.detail, '已有同名播放列表')

    def test_sidecar_subtitle_discovery_and_path_scope(self):
        with tempfile.TemporaryDirectory(prefix='avhub-subtitle-') as folder:
            media_dir = Path(folder) / 'media'; media_dir.mkdir()
            video = media_dir / 'film.mp4'; video.write_bytes(b'video')
            subtitle = media_dir / 'film.zh-CN.srt'; subtitle.write_text('subtitle', encoding='utf-8')
            with m.connection() as db: db.execute('UPDATE media SET path=? WHERE id=1', (str(video),))
            item = m.one_media(1)
            self.assertEqual(item['external_subtitles'], [{'name': subtitle.name, 'path': str(subtitle)}])
            response = m.subtitle(1, str(subtitle))
            self.assertEqual(Path(response.path), subtitle)
            outside = Path(folder) / 'outside.srt'; outside.write_text('no', encoding='utf-8')
            with self.assertRaises(HTTPException) as error: m.subtitle(1, str(outside))
            self.assertEqual(error.exception.status_code, 403)

    def test_codec_decision_not_extension_alone(self):
        item = {'ext':'.mp4', 'video_codec':'hevc', 'audio_tracks':[{'codec':'aac'}]}
        self.assertFalse(m.direct_playable(item))
        self.assertFalse(m.remux_playable(item))
        item['video_codec'] = 'h264'
        self.assertTrue(m.direct_playable(item))
        self.assertTrue(m.remux_playable(item))
        item['audio_tracks'] = [{'codec':'dts'}]
        self.assertFalse(m.direct_playable(item))
        self.assertTrue(m.remux_playable(item))

    def test_compatible_h264_ts_uses_copy_and_unsupported_codec_requires_consent(self):
        with tempfile.TemporaryDirectory(prefix='avhub-remux-') as folder:
            source = Path(folder) / 'sample.ts'
            source.write_bytes(b'media stays untouched')
            with m.connection() as db:
                db.execute("UPDATE media SET path=?,ext='.ts',video_codec='h264',audio_tracks=? WHERE id=1",
                           (str(source), '[{"index":1,"codec":"aac"}]'))
            with patch.object(m.playback, 'create', return_value={'token':'remux-session'}) as create:
                result = m.start_playback(1, m.PlaybackInput())
            self.assertEqual(result['mode'], 'remux')
            self.assertTrue(create.call_args.kwargs['copy_video'])
            self.assertTrue(create.call_args.kwargs['copy_audio'])

            with m.connection() as db:
                db.execute("UPDATE media SET video_codec='hevc' WHERE id=1")
            with patch.object(m.playback, 'create', return_value={'token':'transcode-session'}) as create:
                with self.assertRaises(HTTPException):m.start_playback(1,m.PlaybackInput())
                create.assert_not_called()
                result = m.start_playback(1, m.PlaybackInput(allow_video_transcode=True))
            self.assertEqual(result['mode'], 'hls')
            self.assertFalse(create.call_args.kwargs.get('copy_video', False))

    def test_prefer_original_returns_source_before_codec_based_fallback(self):
        with tempfile.TemporaryDirectory(prefix='avhub-original-') as folder:
            source = Path(folder) / 'sample.mkv'
            source.write_bytes(b'original video bytes')
            with m.connection() as db:
                db.execute("UPDATE media SET path=?,ext='.mkv',video_codec='hevc',audio_tracks=? WHERE id=1",
                           (str(source), '[{"index":1,"codec":"aac"}]'))
            result = m.start_playback(1, m.PlaybackInput(prefer_original=True))
            self.assertEqual(result['mode'], 'direct')
            self.assertEqual(result['url'], '/media/1/file')
            self.assertEqual(source.read_bytes(), b'original video bytes')

    def test_remux_preroll_keeps_requested_timeline_and_source_bytes(self):
        with tempfile.TemporaryDirectory(prefix='avhub-preroll-') as folder:
            source = Path(folder) / 'sample.ts'
            original = b'untouched original video'
            source.write_bytes(original)
            with m.connection() as db:
                db.execute("UPDATE media SET path=?,ext='.ts',video_codec='h264',audio_tracks=? WHERE id=1",
                           (str(source), '[{"index":1,"codec":"aac"}]'))
            for start, preroll, expected in [(20, 2, 18), (20, 10, 10), (1, 2, 0), (20, 0, 20), (200, 2, 117.9)]:
                with self.subTest(start=start, preroll=preroll), patch.object(m.playback, 'create',
                        return_value={'token':'session', 'offset':expected}) as create:
                    result = m.start_playback(1, m.PlaybackInput(start=start, seek_preroll=preroll))
                    self.assertAlmostEqual(create.call_args.args[2], expected)
                    self.assertEqual(result['start'], min(start, 119.9))
                    self.assertEqual(result['offset'], expected)
                    self.assertTrue(create.call_args.kwargs['copy_video'])
                    self.assertTrue(create.call_args.kwargs['copy_audio'])
            self.assertEqual(source.read_bytes(), original)
        for invalid in [-1, 11, float('nan'), float('inf')]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                m.PlaybackInput(seek_preroll=invalid)

    def test_indexed_ts_is_opt_in_and_never_intercepts_audio_selection_or_transcoding(self):
        with tempfile.TemporaryDirectory(prefix='avhub-ts-policy-') as folder:
            source=Path(folder)/'source.ts';source.write_bytes(b'unchanged video')
            with m.connection() as db:
                db.execute("UPDATE media SET path=?,ext='.ts',video_codec='h264',audio_tracks=? WHERE id=1",
                           (str(source),'[{"index":1,"codec":"aac"}]'))
            with patch.object(m.playback,'create_indexed_ts',return_value={'token':'indexed','delivery':'indexed-ts','offset':0}) as index, \
                    patch.object(m.playback,'create',return_value={'token':'legacy'}) as legacy:
                result=m.start_playback(1,m.PlaybackInput(start=90,indexed_ts=True))
                self.assertEqual(result['start'],90);self.assertEqual(result['offset'],0)
                self.assertEqual(result['delivery'],'indexed-ts');index.assert_called_once();legacy.assert_not_called()
                for body in [m.PlaybackInput(),m.PlaybackInput(indexed_ts=True,audio_track_index=1),
                             m.PlaybackInput(indexed_ts=True,force_transcode=True,allow_video_transcode=True),
                             m.PlaybackInput(indexed_ts=True,quality='480p',allow_video_transcode=True)]:
                    m.start_playback(1,body)
                self.assertEqual(index.call_count,1);self.assertEqual(legacy.call_count,4)
            self.assertEqual(source.read_bytes(),b'unchanged video')

    def test_indexed_remux_only_handles_lossless_fallback_and_retains_audio_selection(self):
        with tempfile.TemporaryDirectory(prefix='avhub-remux-policy-') as folder:
            source=Path(folder)/'sample.mkv';source.write_bytes(b'unchanged original')
            with m.connection() as db:db.execute("UPDATE media SET path=?,ext='.mkv',video_codec='h264',audio_tracks=? WHERE id=1",
                (str(source),'[{"index":1,"codec":"aac"},{"index":2,"codec":"ac3"}]'))
            with patch.object(m.playback,'create_indexed_remux',return_value={'token':'index','delivery':'indexed-remux','offset':0}) as indexed, \
                    patch.object(m.playback,'create',return_value={'token':'legacy'}) as legacy:
                result=m.start_playback(1,m.PlaybackInput(indexed_remux=True,prefer_original=True))
                self.assertEqual(result['mode'],'direct');indexed.assert_not_called();legacy.assert_not_called()
                with self.assertRaises(HTTPException):m.start_playback(1,m.PlaybackInput(indexed_remux=True,skip_direct=True,start=90,audio_track_index=2))
                indexed.assert_not_called()
                result=m.start_playback(1,m.PlaybackInput(indexed_remux=True,skip_direct=True,start=90,audio_track_index=2,allow_audio_transcode=True))
                self.assertEqual(result['delivery'],'indexed-remux');self.assertEqual(result['start'],90)
                self.assertEqual(indexed.call_args.kwargs['audio_track_index'],2);self.assertFalse(indexed.call_args.kwargs['copy_audio'])
                for body in [m.PlaybackInput(),m.PlaybackInput(indexed_remux=True,force_transcode=True,allow_video_transcode=True),
                             m.PlaybackInput(indexed_remux=True,quality='720p',allow_video_transcode=True)]:m.start_playback(1,body)
                self.assertEqual(indexed.call_count,1);self.assertEqual(legacy.call_count,3)
            self.assertEqual(source.read_bytes(),b'unchanged original')

    def test_failed_direct_is_skipped_and_explicit_quality_overrides_original_preference(self):
        with tempfile.TemporaryDirectory(prefix='avhub-playback-policy-') as folder:
            source = Path(folder) / 'sample.mp4'
            source.write_bytes(b'unchanged original')
            with m.connection() as db:
                db.execute("UPDATE media SET path=?,ext='.mp4',video_codec='h264',audio_tracks=? WHERE id=1",
                           (str(source), '[{"index":1,"codec":"aac"}]'))
            with patch.object(m.playback, 'create', return_value={'token':'session'}) as create:
                result = m.start_playback(1, m.PlaybackInput(skip_direct=True, prefer_original=True))
                self.assertEqual(result['mode'], 'remux')
                self.assertTrue(create.call_args.kwargs['copy_video'])
                self.assertIn('原片播放失败', result['reason'])
                for body in [m.PlaybackInput(prefer_original=True, quality='720p',allow_video_transcode=True),
                             m.PlaybackInput(prefer_original=True, force_transcode=True,allow_video_transcode=True)]:
                    result = m.start_playback(1, body)
                    self.assertEqual(result['mode'], 'hls')
                    self.assertFalse(create.call_args.kwargs.get('copy_video', False))
                result = m.start_playback(1, m.PlaybackInput(prefer_original=True, audio_track_index=1))
                self.assertEqual(result['mode'], 'remux')
                self.assertEqual(create.call_args.kwargs['audio_track_index'], 1)
            self.assertEqual(source.read_bytes(), b'unchanged original')


class Process:
    def __init__(self): self.code = None; self.terminated = False
    def poll(self): return self.code
    def terminate(self): self.terminated = True; self.code = -1
    def wait(self, timeout=None): return self.code


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='avhub-sessions-')
        self.folder = Path(self.temp.name)
        self.source = self.folder / 'original.mp4'
        self.source.write_bytes(b'untouched source')
        self.manager = PlaybackManager(self.folder / 'cache', idle_seconds=120)
        self.process = Process()
        self.mock = patch('app.playback.subprocess.Popen', return_value=self.process)
        self.mock.start()

    def tearDown(self):
        self.manager.close(); self.mock.stop(); self.temp.cleanup()

    def create(self): return self.manager.create(self.source, 'ffmpeg', 45)['token']

    def test_wait_until_manifest_and_segment_exist(self):
        token = self.create()
        self.assertEqual(self.manager.status(token)['state'], 'preparing')
        folder = self.manager.sessions[token].folder
        (folder / 'index.m3u8').write_text('#EXTM3U')
        self.assertEqual(self.manager.status(token)['state'], 'preparing')
        (folder / 'segment_000000.ts').write_bytes(b'segment')
        self.assertEqual(self.manager.status(token)['state'], 'ready')
        self.assertEqual(self.manager.status(token)['offset'], 45)
        with self.assertRaises(HTTPException): self.manager.file(token, '../original.mp4')
        self.manager.stop(token); self.manager.stop(token)
        self.assertTrue(self.process.terminated)
        self.assertFalse(folder.exists())
        self.assertEqual(self.source.read_bytes(), b'untouched source')

    def test_idle_expiry_and_startup_timeout(self):
        token = self.create()
        self.manager.sessions[token].touched -= 121
        self.manager.sweep()
        self.assertEqual(self.manager.sessions, {})
        self.assertTrue(self.process.terminated)
        self.process.code = None; self.process.terminated = False
        token = self.create()
        self.manager.sessions[token].created -= 91
        self.manager.sweep()
        self.assertEqual(self.manager.status(token)['state'], 'failed')
        self.assertTrue(self.process.terminated)

    def test_completed_stream_status_stops_waiting_for_unpublishable_tail(self):
        token = self.create()
        folder = self.manager.sessions[token].folder
        (folder / 'index.m3u8').write_text('#EXTM3U')
        (folder / 'segment_000000.ts').write_bytes(b'segment')
        self.assertFalse(self.manager.status(token)['complete'])
        self.process.code = 0
        self.assertTrue(self.manager.status(token)['complete'])
        self.assertEqual(self.manager.status(token)['state'], 'ready')

    def test_ffmpeg_error_and_missing_executable(self):
        token = self.create()
        self.process.code = 1
        self.assertEqual(self.manager.status(token)['state'], 'failed')
        self.manager.stop(token)
        with patch('app.playback.subprocess.Popen', side_effect=FileNotFoundError):
            with self.assertRaises(HTTPException) as error: self.create()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(list((self.folder / 'cache').iterdir()), [])

    def test_quality_and_selected_audio_are_mapped_to_local_ffmpeg_session(self):
        with patch('app.playback.subprocess.Popen', return_value=self.process) as popen:
            token = self.manager.create(self.source, 'ffmpeg', 18, 720, 3)['token']
            command = popen.call_args.args[0]
        self.assertIn('0:3', command)
        self.assertIn("min(720,ih)", next(command[i + 1] for i, value in enumerate(command[:-1]) if value == '-vf'))
        self.assertEqual(command[command.index('-hls_time') + 1], '1')
        self.assertIn('zerolatency', command)
        self.assertIn('expr:gte(t,n_forced*1)', command)
        self.assertEqual(self.manager.sessions[token].offset, 18)
        self.manager.stop(token)

    def test_auto_transcode_preserves_source_resolution_and_uses_high_quality_encoding(self):
        with patch('app.playback.subprocess.Popen', return_value=self.process) as popen:
            token = self.manager.create(self.source, 'ffmpeg')['token']
            command = popen.call_args.args[0]
        scale = command[command.index('-vf') + 1]
        self.assertEqual(scale, "scale=w='trunc(iw/2)*2':h='trunc(ih/2)*2'")
        self.assertNotIn('min(1920,iw)', scale)
        self.assertEqual(command[command.index('-crf') + 1], '18')
        self.assertEqual(command[command.index('-preset') + 1], 'medium')
        self.manager.stop(token)

    def test_remux_session_copies_video_and_audio_without_scaling_or_encoding(self):
        with patch('app.playback.subprocess.Popen', return_value=self.process) as popen:
            token = self.manager.create(self.source, 'ffmpeg', 18, audio_track_index=3,
                                        copy_video=True, copy_audio=True)['token']
            command = popen.call_args.args[0]
        self.assertEqual(command[command.index('-c:v') + 1], 'copy')
        self.assertEqual(command[command.index('-c:a') + 1], 'copy')
        self.assertEqual(command[command.index('-hls_time') + 1], '2')
        self.assertNotIn('-vf', command)
        self.assertNotIn('libx264', command)
        self.assertIn('0:3', command)
        self.manager.stop(token)
