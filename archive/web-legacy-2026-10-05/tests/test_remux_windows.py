import subprocess
import threading
import time
import unittest
from unittest.mock import Mock
from tests import test_indexed_remux as fixtures
from app.indexed_remux import IndexedRemux
from app.remux_window import run_remux_window
from app.playback import PlaybackManager


FFMPEG=fixtures.FFMPEG;FFPROBE=fixtures.FFPROBE

class RemuxWindowTests(unittest.TestCase):
    setUpClass=classmethod(fixtures.IndexedRemuxTests.setUpClass.__func__)
    tearDownClass=classmethod(fixtures.IndexedRemuxTests.tearDownClass.__func__)
    setUp=fixtures.IndexedRemuxTests.setUp
    tearDown=fixtures.IndexedRemuxTests.tearDown
    probe_run=staticmethod(fixtures.IndexedRemuxTests.probe_run)
    data=fixtures.IndexedRemuxTests.data
    def stream(self,runner=None,**kwargs):
        return IndexedRemux(self.source,data=self.data(),ffmpeg=FFMPEG,run=self.probe_run,
            folder=self.folder,batch_run=runner or run_remux_window,**kwargs)

    def retire(self,stream):
        stream.cancelled.set();stream.cancel_windows()
        for thread in stream.window_threads():thread.join(timeout=2)

    def test_multiple_short_fragments_share_one_encoder_and_exact_keyframe_pixels(self):
        runner=Mock(side_effect=run_remux_window);stream=self.stream(runner,audio_index=2)
        try:
            for index in [3,4,5,6]:
                with stream.open_fragment(index) as reader:raw=reader.read()
                target=stream.data['fragments'][index][0]
                source=subprocess.run([FFMPEG,'-v','error','-ss',str(target),'-i',str(self.source),'-frames:v','1',
                    '-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,timeout=5).stdout
                decoded=subprocess.run([FFMPEG,'-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],
                    input=raw,capture_output=True,timeout=5)
                self.assertEqual(decoded.returncode,0,decoded.stderr);self.assertTrue(source);self.assertEqual(source,decoded.stdout)
            self.assertEqual(runner.call_count,1)
            self.assertEqual(stream.fragment_stats()['batch_failures'],0)
            self.assertEqual(stream.fragment_stats()['processes'],1)
            with stream.open_fragment(4) as reader:self.assertTrue(reader.avhub_timing['cache_hit'])
        finally:self.retire(stream)

    def test_first_short_piece_returns_while_later_publication_is_blocked(self):
        blocked=threading.Event();release=threading.Event()
        def runner(command,timeout,cancelled,publish):
            def piece(*args):
                publish(*args)
                if not blocked.is_set():
                    blocked.set()
                    while not release.wait(.01):
                        if cancelled.is_set():raise ValueError('cancelled')
            return run_remux_window(command,timeout,cancelled,piece)
        stream=self.stream(runner)
        try:
            with stream.open_fragment(3) as reader:self.assertTrue(reader.read(188))
            self.assertTrue(blocked.is_set());self.assertFalse(stream.scheduler.active.done)
            self.assertFalse((self.folder/'segment_000004.ts').exists())
            release.set()
            with stream.open_fragment(4) as reader:self.assertTrue(reader.read(188))
            self.assertEqual(stream.fragment_stats()['processes'],1)
        finally:release.set();self.retire(stream)

    def test_new_user_seek_cancels_prefetch_but_same_window_requests_do_not(self):
        blocked=threading.Event();calls=[]
        def runner(command,timeout,cancelled,publish):
            calls.append(command)
            if len(calls)==1:
                def piece(*args):
                    publish(*args);blocked.set()
                    while not cancelled.wait(.01):pass
                    raise ValueError('superseded')
                return run_remux_window(command,timeout,cancelled,piece)
            return run_remux_window(command,timeout,cancelled,publish)
        stream=self.stream(runner)
        try:
            with stream.open_fragment(3,seek_revision=1) as reader:self.assertTrue(reader.read(188))
            self.assertTrue(blocked.is_set());self.assertFalse(stream.scheduler.active.stop.is_set())
            stream.seek(stream.data['fragments'][8][0],2)
            began=time.monotonic()
            with stream.open_fragment(8,seek_revision=2) as reader:self.assertTrue(reader.read(188))
            self.assertLess(time.monotonic()-began,1)
            self.assertEqual(len(calls),2);self.assertFalse(stream.cancelled.is_set())
            # A late seek hint cannot cancel the current newer generation.
            stream.seek(stream.data['fragments'][3][0],1)
            self.assertEqual(stream.scheduler.revision,2)
        finally:self.retire(stream)

    def test_duplicate_waiters_share_worker_and_one_disconnect_does_not_cancel_the_other(self):
        entered=threading.Event();release=threading.Event();first_cancel=threading.Event();result=[];errors=[];calls=[]
        def runner(command,timeout,cancelled,publish):
            calls.append(command);entered.set()
            while not release.wait(.01):
                if cancelled.is_set():raise ValueError('all cancelled')
            return run_remux_window(command,timeout,cancelled,publish)
        stream=self.stream(runner)
        def read(cancel):
            try:
                with stream.open_fragment(3,cancel) as reader:result.append(reader.read(188))
            except Exception as e:errors.append(e)
        first=threading.Thread(target=read,args=(first_cancel,));second=threading.Thread(target=read,args=(None,))
        try:
            first.start();self.assertTrue(entered.wait(1));second.start()
            deadline=time.monotonic()+1
            while len(stream.scheduler.active.consumers)<2 and time.monotonic()<deadline:time.sleep(.01)
            first_cancel.set();first.join(timeout=1);self.assertFalse(first.is_alive());release.set();second.join(timeout=2)
            self.assertFalse(second.is_alive());self.assertEqual(len(errors),1);self.assertEqual(len(result),1);self.assertEqual(len(calls),1)
        finally:release.set();self.retire(stream);first.join(timeout=1);second.join(timeout=1)

    def test_invalid_batch_falls_back_to_original_single_remux_not_transcoding(self):
        def bad(command,timeout,cancelled,publish):return 1,b'unsupported segment layout'
        stream=self.stream(bad)
        try:
            with stream.open_fragment(3) as reader:self.assertTrue(reader.read(188))
            self.assertTrue(stream.scheduler.disabled);self.assertEqual(stream.fragment_stats()['batch_failures'],1)
            with stream.open_fragment(7) as reader:self.assertTrue(reader.read(188))
            self.assertEqual(stream.fragment_stats()['batch_failures'],1)
        finally:self.retire(stream)

    def test_failure_after_first_piece_disables_later_speculation_for_the_session(self):
        def runner(command,timeout,cancelled,publish):
            first=True
            def piece(*args):
                nonlocal first
                if not first:raise ValueError('unsupported following boundary')
                publish(*args);first=False
            return run_remux_window(command,timeout,cancelled,piece)
        stream=self.stream(runner)
        try:
            with stream.open_fragment(3) as reader:self.assertTrue(reader.read(188))
            for thread in stream.window_threads():thread.join(timeout=2)
            self.assertTrue(stream.scheduler.disabled)
            with stream.open_fragment(8) as reader:self.assertTrue(reader.read(188))
            self.assertEqual(stream.fragment_stats()['batch_failures'],1)
        finally:self.retire(stream)

    def test_manager_exit_stops_window_and_retries_its_private_folder_cleanup(self):
        entered=threading.Event();manager=PlaybackManager(self.folder/'hls')
        def slow(command,timeout,cancelled,publish):
            entered.set();cancelled.wait(3);raise ValueError('closed')
        try:
            session=manager.create_indexed_remux(self.source,FFPROBE,FFMPEG,self.probe_run,batch_run=slow)
            token=session['token'];manager.sessions[token].worker.join(timeout=5);errors=[]
            def read():
                try:manager.remux_fragment(token,'segment_000003.ts')
                except Exception as e:errors.append(e)
            reader=threading.Thread(target=read);reader.start();self.assertTrue(entered.wait(1))
            threads=manager.sessions[token].indexed.window_threads()
            manager.stop(token);reader.join(timeout=1)
            for thread in threads:thread.join(timeout=1)
            self.assertTrue(errors);self.assertFalse(list(manager.cache.iterdir()));self.assertFalse(manager.pending_removals)
        finally:manager.close()

    def test_overlapping_windows_preserve_a_reader_pinned_cached_piece(self):
        stream=self.stream()
        try:
            with stream.open_fragment(3) as pinned:
                first=pinned.read(188)
                with stream.open_fragment(1) as reader:self.assertTrue(reader.read(188))
                for thread in stream.window_threads():thread.join(timeout=2)
                self.assertTrue(pinned.read(188));self.assertTrue(first)
                self.assertEqual(stream.fragment_stats()['batch_failures'],0)
                with stream.open_fragment(3) as reader:self.assertEqual(reader.read(188),first)
        finally:self.retire(stream)

    def test_high_bitrate_and_tiny_budget_bound_speculative_window(self):
        stream=self.stream()
        try:
            stream.data['source']=list(stream.data['source'])
            stream.data['source'][1]=int(stream.data['duration']*3*1024**2)
            self.assertEqual(len(stream.window_scheduler().window(3)),2)
            stream.budget=1
            self.assertEqual(stream.window_scheduler().window(3),())
        finally:self.retire(stream)
