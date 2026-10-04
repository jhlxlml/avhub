import asyncio
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import test_stability
from app import main as m
from app.playback import PlaybackManager
from app.subtitle_conversion import convert_ass, decode_text, MAX_SUBTITLE_BYTES
from app.video_color import color_metadata, transcode_color
from fastapi import HTTPException

ASS_TEXT = r'''[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:02.00,0:00:04.50,Default,,0,0,0,,{\b1}中文，字幕{\b0}\N第二行
'''


class PlaylistPagingTests(unittest.TestCase):
    def setUp(self):
        with m.connection() as db:
            db.execute('DELETE FROM media');db.execute('DELETE FROM playlist_items');db.execute('DELETE FROM playlists')
            db.execute("INSERT INTO playlists(id,name,created_at) VALUES(1,'large',0)")
            db.executemany('''INSERT INTO media(id,path,name,title,missing,created_at,updated_at)
                VALUES(?,?,?, ?,?,0,0)''',[(i,f'{i}.mp4',f'{i:05}.mp4',f'视频 {i:05}',int(i==41)) for i in range(1,10001)])
            db.executemany('INSERT INTO playlist_items VALUES(1,?,?)',[(i,i) for i in range(1,10001)])

    def detail(self,**kwargs): return m.playlist_detail(1,page=kwargs.pop('page',1),page_size=40,**kwargs)

    def test_pages_counts_search_and_missing_are_bounded(self):
        page=self.detail(page=2)
        self.assertEqual((page['count'],page['playable_count'],page['total'],len(page['items'])),(10000,9999,10000,40))
        self.assertTrue(page['items'][0]['missing'])
        self.assertEqual(page['items'][0]['playlist_index'],40)
        self.assertEqual(self.detail(q='09999')['items'][0]['id'],9999)
        self.assertEqual(self.detail(page=999)['page'],250)

    def test_cross_page_move_is_local_and_stale_revision_is_rejected(self):
        m.move_playlist_item(1,41,m.PlaylistMoveInput(direction=-1,expected_revision=0))
        self.assertEqual(self.detail()['items'][-1]['id'],41)
        self.assertEqual(self.detail(page=2)['items'][0]['id'],40)
        with self.assertRaises(HTTPException) as error:
            m.move_playlist_item(1,42,m.PlaylistMoveInput(direction=-1,expected_revision=0))
        self.assertEqual(error.exception.status_code,409)
        with self.assertRaises(HTTPException): m.remove_playlist_item(1,42,compact=True,expected_revision=0)
        small=m.remove_playlist_item(1,41,compact=True,expected_revision=1)
        self.assertNotIn('items',small);self.assertEqual(small['revision'],2)

    def test_queue_locates_current_page_and_skips_offline_neighbors(self):
        result=m.playlist_queue(1,media_id=40,page=None,page_size=40)
        self.assertEqual(result['next']['id'],42)
        self.assertEqual(result['previous']['id'],39)
        self.assertEqual(len(result['items']),40)
        self.assertEqual(m.playlist_queue(1,media_id=9999,page=None,page_size=40)['page'],250)
        self.assertEqual(m.playlist_queue(1,page=None,page_size=40)['current']['id'],1)
        self.assertEqual(m.playlist_queue(1,media_id=9999,page=1,page_size=40,q='00002')['items'][0]['id'],2)

    def test_mutations_can_return_only_metadata(self):
        self.assertNotIn('items',m.rename_playlist(1,m.PlaylistInput(name='rename'),compact=True))
        self.assertNotIn('items',m.add_playlist_item(1,2,compact=True))
        self.assertEqual(self.detail()['revision'],0)  # Duplicate insertion does not change order.


class AssConversionTests(unittest.TestCase):
    def test_text_conversion_and_owned_temporary_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            response=convert_ass(ASS_TEXT,Path(directory),m.executable('ffmpeg'),m.scan_process)
            text=Path(response.path).read_text(encoding='utf-8')
            self.assertTrue(text.startswith('WEBVTT'))
            self.assertIn('00:02.000 --> 00:04.500',text)
            self.assertIn('中文，字幕',text)
            self.assertIn('第二行',text)
            response.background.func()
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_ssa_and_gb18030_sidecar_stays_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);video=root/'film.mp4';video.write_bytes(b'video')
            subtitle=root/'film.zh.ssa'
            ssa='[Script Info]\nScriptType: v4.00\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:02.00,0:00:04.00,Default,,0,0,0,,中文 SSA\n'
            subtitle.write_bytes(ssa.encode('gb18030'));before=subtitle.read_bytes()
            with m.connection() as db:
                db.execute('DELETE FROM media')
                db.execute("INSERT INTO media(id,path,name,title,created_at,updated_at) VALUES(1,?,'film','film',0,0)",(str(video),))
            response=m.subtitle(1,str(subtitle))
            self.assertIn('中文 SSA',Path(response.path).read_text(encoding='utf-8'))
            response.background.func()
            self.assertEqual(subtitle.read_bytes(),before)
            (root/'nested').mkdir()
            outside=root/'nested'/'outside.ass'
            outside.touch()
            try:
                with self.assertRaises(HTTPException):m.subtitle(1,str(outside))
            finally:outside.unlink()

    def test_invalid_oversized_and_utf16_handling(self):
        self.assertEqual(decode_text('中文'.encode('utf-16')),'中文')
        with tempfile.TemporaryDirectory() as directory:
            for text in ('not a subtitle','x'*(MAX_SUBTITLE_BYTES+1)):
                with self.assertRaises(HTTPException):convert_ass(text,Path(directory),m.executable('ffmpeg'),m.scan_process)
            self.assertEqual(list(Path(directory).iterdir()),[])
        class Request:
            def __init__(self, content): self.content=content
            async def stream(self): yield self.content
        for content,status in ((b'\xff',422),(b'x'*(MAX_SUBTITLE_BYTES+1),413)):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(m.import_ass(Request(content)))
            self.assertEqual(error.exception.status_code,status)


class ColorPolicyTests(unittest.TestCase):
    def test_pq_hlg_sdr_and_dynamic_base_policy(self):
        for transfer,hdr in [('smpte2084','PQ'),('arib-std-b67','HLG')]:
            color=color_metadata({'codec_name':'hevc','pix_fmt':'yuv420p10le','color_transfer':transfer})
            self.assertEqual((color['bit_depth'],color['hdr']),(10,hdr))
            plan=transcode_color(color)
            self.assertIn('t=linear',plan['filter']);self.assertIn('format=gbrpf32le',plan['filter'])
            self.assertIn('tonemap=tonemap=hable',plan['filter']);self.assertIn('error_diffusion',plan['filter'])
            self.assertIn('不是原画',plan['warning']);self.assertIn('transfer=bt709', ' '.join(plan['args']))
        self.assertNotIn('tonemap',transcode_color({'bit_depth':10})['filter'])
        with self.assertRaises(HTTPException):transcode_color({'dolby_vision_profile':5,'hdr':'PQ'})
        self.assertIn('兼容基层',transcode_color({'dolby_vision_profile':8,'hdr':'PQ','dynamic_hdr':True})['warning'])

    def test_actual_hdr_and_ten_bit_sdr_conversion_tags_resolution_and_source_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);manager=PlaybackManager(root/'cache')
            try:
                for transfer,width,height,bits in [('smpte2084',160,90,10),('arib-std-b67',160,90,10),('bt709',160,90,10),('smpte2084',3840,2160,10),('bt709',160,90,8)]:
                    source=root/f'{transfer}-{width}-{bits}.mkv'
                    subprocess.run([m.executable('ffmpeg'),'-v','error','-f','lavfi','-i',f'testsrc2=s={width}x{height}:r=12',
                        '-t','0.1' if width==3840 else '1.5','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p10le' if bits==10 else 'yuv420p',
                        '-x264-params',f"colorprim={'bt2020' if transfer!='bt709' else 'bt709'}:transfer={transfer}:colormatrix={'bt2020nc' if transfer!='bt709' else 'bt709'}:range=tv",str(source)],check=True)
                    before=hashlib.sha256(source.read_bytes()).digest()
                    metadata=m.probe(source);color=metadata['video_color']
                    self.assertEqual(color['bit_depth'],bits)
                    self.assertEqual(color['hdr'],{'smpte2084':'PQ','arib-std-b67':'HLG'}.get(transfer))
                    token=manager.create(source,m.executable('ffmpeg'),video_color=color)['token']
                    session=manager.sessions[token];session.process.wait(timeout=30)
                    self.assertEqual(manager.status(token)['state'],'ready',(session.folder/'ffmpeg.log').read_text())
                    result=subprocess.run([m.executable('ffprobe'),'-v','error','-select_streams','v:0','-show_streams','-of','json',str(session.folder/'index.m3u8')],capture_output=True,check=True)
                    video=json.loads(result.stdout)['streams'][0]
                    self.assertEqual((video['width'],video['height'],video['pix_fmt']),(width,height,'yuv420p'))
                    self.assertEqual(video.get('color_transfer'),'bt709',(transfer,color,video));self.assertEqual(video.get('color_primaries'),'bt709')
                    self.assertEqual(video['color_range'],'tv')
                    self.assertEqual(hashlib.sha256(source.read_bytes()).digest(),before)
                    manager.stop(token)
            finally:manager.close()
