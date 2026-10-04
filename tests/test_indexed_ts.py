import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
from app.indexed_ts import build_index, IndexedTs, UnsupportedTs, validate
from app.playback import PlaybackManager

ROOT=Path(__file__).resolve().parents[1]


class IndexedTsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary=tempfile.TemporaryDirectory(prefix='avhub-indexed-ts-tests-')
        cls.root=Path(cls.temporary.name)
        cls.source=cls.root/'source.ts'
        subprocess.run([str(ROOT/'bin/ffmpeg.exe'),'-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=25',
            '-f','lavfi','-i','sine=frequency=440','-t','12','-c:v','libx264','-preset','ultrafast',
            '-g','50','-c:a','aac','-f','mpegts',str(cls.source)],check=True,timeout=15)
        cls.original=cls.source.read_bytes();cls.stamp=cls.source.stat().st_mtime_ns

    @classmethod
    def tearDownClass(cls):
        if cls.source.read_bytes()!=cls.original or cls.source.stat().st_mtime_ns!=cls.stamp:
            raise AssertionError('TS source was modified')
        cls.temporary.cleanup()

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='avhub-ts-index-cache-')
        self.cache=Path(self.temp.name)

    def tearDown(self):self.temp.cleanup()

    @staticmethod
    def probe_run(command,timeout,cancelled):
        if cancelled.is_set():raise UnsupportedTs('cancelled')
        result=subprocess.run(command,capture_output=True,timeout=timeout)
        return result.returncode,result.stdout,result.stderr

    def index(self,run=None):
        return build_index(self.source,self.cache/'ts-index',str(ROOT/'bin/ffprobe.exe'),run or self.probe_run,threading.Event())

    def test_original_ranges_headers_and_packet_timestamps_are_preserved(self):
        data=self.index()
        self.assertGreaterEqual(len(data['fragments']),5)
        stream=IndexedTs(self.source,data=data)
        manifest=stream.manifest()
        self.assertIn(b'#EXT-X-PLAYLIST-TYPE:VOD',manifest)
        self.assertIn(b'#EXT-X-ENDLIST',manifest)
        for i,(start,length,position,duration) in enumerate(data['fragments']):
            self.assertEqual(position%188,0);self.assertEqual(length%188,0)
            self.assertGreater(duration,0)
            self.assertIn(f'segment_{i:06d}.ts'.encode(),manifest)
        _,length,position,_=data['fragments'][3]
        payload=bytes.fromhex(data['headers'])+self.original[position:position+length]
        # The virtual fragment can decode by itself without changing encoded bytes.
        result=subprocess.run([str(ROOT/'bin/ffmpeg.exe'),'-v','error','-i','pipe:0',
            '-frames:v','1','-f','null','-'],input=payload,capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(payload[376:],self.original[position:position+length])

    def test_cached_index_skips_probe_and_corrupt_cache_is_rebuilt(self):
        run=Mock(side_effect=self.probe_run)
        data=self.index(run);self.assertEqual(run.call_count,1)
        self.assertEqual(self.index(run),data);self.assertEqual(run.call_count,1)
        next((self.cache/'ts-index').glob('*.json')).write_text('{bad',encoding='utf-8')
        self.assertEqual(self.index(run),data);self.assertEqual(run.call_count,2)

    def test_invalid_ranges_timestamps_headers_and_source_are_rejected(self):
        data=self.index()
        for change in ['position','time','gap','headers','stamp']:
            altered=json.loads(json.dumps(data))
            if change=='position':altered['fragments'][1][2]+=188
            if change=='time':altered['fragments'][1][0]=float('nan')
            if change=='gap':altered['fragments'][1][0]+=.5
            if change=='headers':altered['headers']='00'
            if change=='stamp':altered['source'][2]+=1
            with self.subTest(change=change),self.assertRaises(UnsupportedTs):validate(altered,data['source'])

    def test_changed_source_fingerprint_does_not_reuse_index(self):
        copy=self.cache/'copy.ts';copy.write_bytes(self.original)
        run=Mock(side_effect=self.probe_run)
        build_index(copy,self.cache/'ts-index',str(ROOT/'bin/ffprobe.exe'),run,threading.Event())
        before=copy.stat()
        os.utime(copy,ns=(before.st_atime_ns,before.st_mtime_ns+1000000000))
        build_index(copy,self.cache/'ts-index',str(ROOT/'bin/ffprobe.exe'),run,threading.Event())
        self.assertEqual(run.call_count,2)

    def test_non_monotonic_keyframe_timestamps_are_not_published(self):
        output={'format':{'start_time':'1.4','duration':'12'},'packets':[
            {'pts_time':time,'pos':str(pos),'flags':'K__'}
            for time,pos in [('1.4',564),('3.4',188*100),('2.4',188*200)]]}
        run=Mock(return_value=(0,json.dumps(output).encode(),b''))
        with self.assertRaises(UnsupportedTs):self.index(run)
        self.assertEqual(list(self.cache.glob('ts-index/*.json')),[])

    def test_manager_reads_only_requested_fragment_and_releases_handles(self):
        manager=PlaybackManager(self.cache/'hls')
        try:
            session=manager.create_indexed_ts(self.source,str(ROOT/'bin/ffprobe.exe'),self.probe_run)
            token=session['token'];deadline=time.monotonic()+10
            while manager.status(token)['state']=='preparing' and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(manager.status(token)['state'],'ready')
            self.assertEqual(manager.status(token)['offset'],0)
            self.assertIsNone(manager.sessions[token].process)
            self.assertIn(b'#EXT-X-ENDLIST',manager.manifest(token))
            reader,prefix,length=manager.indexed_fragment(token,'segment_000003.ts')
            try:
                position=manager.sessions[token].indexed.data['fragments'][3][2]
                self.assertEqual(reader.read(length),self.original[position:position+length])
                self.assertEqual(len(prefix),376)
            finally:reader.close()
            for name in ['../source.ts','source.ts','segment_999999.ts']:
                with self.subTest(name=name),self.assertRaises(HTTPException):manager.indexed_fragment(token,name)
            manager.stop(token)
            self.assertEqual(manager.sessions,{})
            with self.assertRaises(HTTPException):manager.manifest(token)
        finally:manager.close()

    def test_cancellation_interrupts_indexing_and_cannot_publish_a_late_session(self):
        entered=threading.Event()
        def blocked(command,timeout,cancelled):
            entered.set();cancelled.wait(5);raise UnsupportedTs('cancelled')
        manager=PlaybackManager(self.cache/'hls')
        result=manager.create_indexed_ts(self.source,'unused',blocked,client_token='a'*32)
        worker=manager.sessions[result['token']].worker
        self.assertTrue(entered.wait(1))
        began=time.monotonic();manager.close()
        self.assertLess(time.monotonic()-began,2.5)
        self.assertFalse(worker.is_alive());self.assertEqual(manager.sessions,{})
        self.assertEqual(list((self.cache/'hls').iterdir()),[])
        with self.assertRaises(HTTPException):
            manager.create_indexed_ts(self.source,'unused',blocked,client_token='a'*32)

    def test_unsupported_packet_layout_fails_explicitly_without_creating_a_remux(self):
        broken=self.cache/'broken.ts';broken.write_bytes(b'bad-ts')
        manager=PlaybackManager(self.cache/'hls')
        try:
            result=manager.create_indexed_ts(broken,'unused',Mock())
            deadline=time.monotonic()+2
            while manager.status(result['token'])['state']=='preparing' and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(manager.status(result['token'])['state'],'failed')
            self.assertEqual(manager.status(result['token'])['delivery'],'indexed-ts')
            self.assertIsNone(manager.sessions[result['token']].process)
        finally:manager.close()


if __name__=='__main__':unittest.main()
