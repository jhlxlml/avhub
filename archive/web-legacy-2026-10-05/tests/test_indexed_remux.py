import json
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock

from fastapi import HTTPException
from app.indexed_remux import IndexedRemux,build_remux_index,validate
from app.playback import PlaybackManager

ROOT=Path(__file__).resolve().parents[1]
FFMPEG=str(ROOT/'bin/ffmpeg.exe');FFPROBE=str(ROOT/'bin/ffprobe.exe')


class IndexedRemuxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='avhub-indexed-remux-');cls.root=Path(cls.temp.name)
        cls.source=cls.root/'source.mkv'
        subprocess.run([FFMPEG,'-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=25',
            '-f','lavfi','-i','sine=frequency=440','-f','lavfi','-i','sine=frequency=880',
            '-t','24','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','fast','-g','50','-bf','3',
            '-c:a','aac',str(cls.source)],check=True,timeout=15)
        cls.original=cls.source.read_bytes();cls.modified=cls.source.stat().st_mtime_ns

    @classmethod
    def tearDownClass(cls):
        if cls.source.read_bytes()!=cls.original or cls.source.stat().st_mtime_ns!=cls.modified:raise AssertionError('Source changed')
        cls.temp.cleanup()

    def setUp(self):
        self.work=tempfile.TemporaryDirectory(prefix='avhub-remux-cache-');self.folder=Path(self.work.name)

    def tearDown(self):self.work.cleanup()

    @staticmethod
    def probe_run(command,timeout,cancelled):
        if cancelled.is_set():raise ValueError('cancelled')
        result=subprocess.run(command,capture_output=True,timeout=timeout)
        return result.returncode,result.stdout,result.stderr

    def data(self,run=None):return build_remux_index(self.source,self.folder/'index',FFPROBE,run or self.probe_run,threading.Event())

    def test_cache_and_strict_timeline_validation(self):
        run=Mock(side_effect=self.probe_run);data=self.data(run)
        self.assertGreater(len(data['fragments']),8);self.assertEqual(self.data(run),data);self.assertEqual(run.call_count,1)
        for mutate in [lambda x:x['fragments'][2].__setitem__(0,123),lambda x:x.__setitem__('duration',float('nan')),
                       lambda x:x['fragments'][2].__setitem__(2,.5)]:
            corrupt=json.loads(json.dumps(data));mutate(corrupt)
            with self.assertRaises(ValueError):validate(corrupt,data['source'])
        next((self.folder/'index').glob('*.json')).write_text('{broken',encoding='utf-8')
        self.assertEqual(self.data(run),data);self.assertEqual(run.call_count,2)

    def test_fragments_start_at_original_keyframes_and_copy_encoded_video(self):
        data=self.data();run=Mock(side_effect=self.probe_run)
        stream=IndexedRemux(self.source,data=data,ffmpeg=FFMPEG,run=run,folder=self.folder,audio_index=2)
        self.assertIn(b'#EXT-X-ENDLIST',stream.manifest())
        start=data['fragments'][7][0]
        with stream.open_fragment(7) as reader:raw=reader.read()
        with stream.open_fragment(7) as reader:self.assertEqual(reader.read(),raw)
        self.assertEqual(run.call_count,1)
        self.assertIn('-c:v',run.call_args.args[0]);self.assertNotIn('libx264',run.call_args.args[0])
        result=subprocess.run([FFPROBE,'-v','error','-select_streams','v:0','-show_packets',
            '-show_entries','packet=pts_time,flags','-of','json','-i','pipe:0'],input=raw,capture_output=True,timeout=5)
        packets=json.loads(result.stdout)['packets']
        self.assertIn('K',packets[0]['flags']);self.assertLess(abs(float(packets[0]['pts_time'])-start),.15,(start,packets[:3],run.call_args.args[0]))
        decode=subprocess.run([FFMPEG,'-v','error','-i','pipe:0','-frames:v','1','-f','null','-'],input=raw,capture_output=True,timeout=5)
        self.assertEqual(decode.returncode,0,decode.stderr)
        # Encoded payload survives muxing (SPS/Annex-B can change), so compare
        # decoded pixels at the same source keyframe rather than container bytes.
        source_frame=subprocess.run([FFMPEG,'-v','error','-ss',str(start),'-i',str(self.source),'-frames:v','1',
            '-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,timeout=5).stdout
        remux_frame=subprocess.run([FFMPEG,'-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],input=raw,capture_output=True,timeout=5).stdout
        self.assertTrue(source_frame);self.assertEqual(source_frame,remux_frame)

    def test_cancelled_generation_and_budget(self):
        stream=IndexedRemux(self.source,data=self.data(),ffmpeg=FFMPEG,run=self.probe_run,folder=self.folder,budget=1)
        for index in [0,4,9]:
            with stream.open_fragment(index) as reader:self.assertTrue(reader.read(188))
        self.assertEqual(len(list(self.folder.glob('segment_*.ts'))),1)
        stream.cancelled.set()
        with self.assertRaises(ValueError):stream.open_fragment(2)
        self.assertFalse(list(self.folder.glob('*.tmp')))

    def test_first_segment_keeps_its_first_frame_and_decoded_resolution(self):
        stream=IndexedRemux(self.source,data=self.data(),ffmpeg=FFMPEG,run=self.probe_run,folder=self.folder)
        with stream.open_fragment(0) as reader:raw=reader.read()
        result=subprocess.run([FFMPEG,'-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],input=raw,capture_output=True,timeout=5)
        source=subprocess.run([FFMPEG,'-v','error','-i',str(self.source),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,timeout=5)
        self.assertEqual(len(result.stdout),160*90*3);self.assertEqual(result.stdout,source.stdout)

    def test_avi_missing_pts_and_flv_nonzero_origin_have_correct_keyframe_pixels(self):
        for container,audio in [('avi','mp3'),('flv','aac')]:
            with self.subTest(container=container):
                source=self.folder/f'source.{container}';cache=self.folder/container;cache.mkdir()
                subprocess.run([FFMPEG,'-v','error','-i',str(self.source),'-map','0:v','-map','0:a:0',
                    '-c:v','libx264' if container=='avi' else 'copy','-preset','fast','-g','50','-bf','3','-c:a',audio,str(source)],check=True,timeout=10)
                data=build_remux_index(source,cache/'index',FFPROBE,self.probe_run,threading.Event())
                stream=IndexedRemux(source,data=data,ffmpeg=FFMPEG,run=self.probe_run,folder=cache,copy_audio=audio=='aac')
                for index in [0,3,7]:
                    with stream.open_fragment(index) as reader:raw=reader.read()
                    remux=subprocess.run([FFMPEG,'-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],input=raw,capture_output=True,timeout=5)
                    # AVI has no source PTS; genpts and full decoder ordering
                    # differ by up to a couple of frames. Compare the original
                    # keyframe in a bounded 120ms window, not a second input -ss
                    # (which has the same demuxer seek ambiguity being tested).
                    target=data['fragments'][index][0]
                    select=f"select='eq(pict_type,I)*between(t,{target-.12},{target+.12})'"
                    command=[FFMPEG,'-v','error','-i',str(source),'-vf',select,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']
                    original=subprocess.run(command,capture_output=True,timeout=5)
                    self.assertEqual(len(remux.stdout),160*90*3);self.assertEqual(remux.stdout,original.stdout,(container,index,data['fragments'][index]))

    def test_stop_cancels_an_inflight_fragment_without_holding_manager_lock(self):
        manager=PlaybackManager(self.folder/'hls');began=threading.Event();finished=threading.Event();errors=[]
        try:
            session=manager.create_indexed_remux(self.source,FFPROBE,FFMPEG,self.probe_run)
            token=session['token'];manager.sessions[token].worker.join(timeout=5)
            def slow(command,timeout,cancelled):
                began.set()
                if cancelled.wait(2):raise ValueError('cancelled')
                raise AssertionError('generation was not cancelled')
            manager.sessions[token].indexed.run=slow
            def read():
                try:manager.remux_fragment(token,'segment_000008.ts')
                except Exception as exc:errors.append(exc)
                finally:finished.set()
            thread=threading.Thread(target=read);thread.start();self.assertTrue(began.wait(1))
            started=time.monotonic();self.assertEqual(manager.status(token)['state'],'ready');manager.stop(token)
            self.assertLess(time.monotonic()-started,.5);self.assertTrue(finished.wait(1));thread.join(timeout=1)
            self.assertEqual(len(errors),1);self.assertIsInstance(errors[0],HTTPException)
            self.assertFalse(list(manager.cache.iterdir()))
        finally:manager.close()

    def test_manager_uses_single_vod_session_not_sequential_encoder(self):
        manager=PlaybackManager(self.folder/'hls')
        try:
            session=manager.create_indexed_remux(self.source,FFPROBE,FFMPEG,self.probe_run,audio_track_index=2)
            manager.sessions[session['token']].worker.join(timeout=10)
            ready=manager.status(session['token'])
            self.assertEqual(ready['delivery'],'indexed-remux');self.assertEqual(ready['state'],'ready');self.assertEqual(ready['offset'],0)
            self.assertIsNone(manager.sessions[session['token']].process)
            for index in [10,1,6]:
                reader,_,length=manager.remux_fragment(session['token'],f'segment_{index:06d}.ts')
                with reader:self.assertEqual(len(reader.read()),length)
            self.assertEqual(len(manager.sessions),1)
            for name in ['../segment_000001.ts','segment_999999.ts','init.mp4']:
                with self.assertRaises(HTTPException):manager.remux_fragment(session['token'],name)
            manager.stop(session['token']);self.assertFalse(list(manager.cache.iterdir()))
        finally:manager.close()

    def test_creation_never_removes_a_preexisting_token_folder(self):
        manager=PlaybackManager(self.folder/'hls')
        try:
            token='a'*32;existing=manager.cache/token;existing.mkdir();marker=existing/'keep.txt';marker.write_text('keep')
            with self.assertRaises(HTTPException):manager.create_indexed_remux(self.source,FFPROBE,FFMPEG,self.probe_run,client_token=token)
            self.assertEqual(marker.read_text(),'keep');self.assertEqual(len(manager.sessions),0)
        finally:manager.close()

    def test_pinned_fragment_release_retries_windows_cleanup_immediately(self):
        manager=PlaybackManager(self.folder/'hls')
        try:
            session=manager.create_indexed_remux(self.source,FFPROBE,FFMPEG,self.probe_run)
            token=session['token'];manager.sessions[token].worker.join(timeout=5)
            reader,_,_=manager.remux_fragment(token,'segment_000004.ts')
            manager.stop(token)
            self.assertTrue(reader.read(188))
            manager.release_fragment(token,reader)
            self.assertTrue(reader.closed);self.assertFalse(list(manager.cache.iterdir()))
            self.assertFalse(manager.pending_removals)
        finally:manager.close()

    def test_obsolete_fragment_releases_queue_without_cancelling_playback(self):
        began=threading.Event();obsolete=threading.Event();errors=[];calls=[]
        def slow(command,timeout,cancelled):
            calls.append(command)
            if len(calls)==1:
                began.set()
                self.assertTrue(cancelled.wait(2),'disconnected work should be cancelled')
                raise ValueError('obsolete request')
            return self.probe_run(command,timeout,cancelled)
        stream=IndexedRemux(self.source,data=self.data(),ffmpeg=FFMPEG,run=slow,folder=self.folder)
        def old_request():
            try:stream.open_fragment(8,obsolete)
            except ValueError as exc:errors.append(exc)
        worker=threading.Thread(target=old_request);worker.start()
        self.assertTrue(began.wait(1));started=time.monotonic();obsolete.set()
        with stream.open_fragment(2) as reader:self.assertTrue(reader.read(188))
        worker.join(timeout=1)
        self.assertFalse(worker.is_alive());self.assertLess(time.monotonic()-started,1)
        self.assertEqual(len(errors),1);self.assertEqual(len(calls),2)
        self.assertFalse(stream.cancelled.is_set());self.assertFalse(list(self.folder.glob('*.tmp')))
        self.assertFalse((self.folder/'segment_000008.ts').exists())

    def test_request_cancelled_while_queued_never_runs_encoder(self):
        obsolete=threading.Event();errors=[];run=Mock(side_effect=self.probe_run)
        stream=IndexedRemux(self.source,data=self.data(),ffmpeg=FFMPEG,run=run,folder=self.folder)
        def request():
            try:stream.open_fragment(3,obsolete)
            except ValueError as exc:errors.append(exc)
        stream.generation.acquire()
        try:
            worker=threading.Thread(target=request);worker.start();obsolete.set();worker.join(timeout=1)
            self.assertFalse(worker.is_alive());self.assertEqual(len(errors),1);run.assert_not_called()
        finally:stream.generation.release()
