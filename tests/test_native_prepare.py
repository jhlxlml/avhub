import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock
from fastapi import HTTPException
from app.native_prepare import NativePrepare,signatures
from app.packet_probe import stream_packets

ROOT=Path(__file__).resolve().parents[1]
FFMPEG=str(ROOT/'bin/ffmpeg.exe');FFPROBE=str(ROOT/'bin/ffprobe.exe')
def run(command,timeout,event):
    if event.is_set():raise ValueError('cancelled')
    result=subprocess.run(command,capture_output=True,timeout=timeout)
    return result.returncode,result.stdout,result.stderr


class NativePrepareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='avhub-native-source-');cls.root=Path(cls.temp.name)
        cls.source=cls.root/'original.mkv';sub=cls.root/'source.srt';sub.write_text('1\n00:00:01,000 --> 00:00:02,000\nsubtitle\n',encoding='utf-8')
        subprocess.run([FFMPEG,'-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=24','-f','lavfi','-i','sine=frequency=440',
            '-f','lavfi','-i','sine=frequency=880','-i',str(sub),'-t','6','-map','0:v','-map','1:a','-map','2:a','-map','3:s',
            '-c:v','libvpx-vp9','-deadline','realtime','-lossless','1','-g','48','-c:a','libopus','-c:s','srt',str(cls.source)],check=True,timeout=15)
        cls.before=hashlib.sha256(cls.source.read_bytes()).hexdigest();cls.modified=cls.source.stat().st_mtime_ns
    @classmethod
    def tearDownClass(cls):
        if hashlib.sha256(cls.source.read_bytes()).hexdigest()!=cls.before or cls.source.stat().st_mtime_ns!=cls.modified:raise AssertionError('Original modified')
        cls.temp.cleanup()
    def setUp(self):
        self.temp_cache=tempfile.TemporaryDirectory(prefix='avhub-native-cache-');self.directory=Path(self.temp_cache.name)
        self.cache=NativePrepare(lambda:self.directory)
    def tearDown(self):self.cache.close();self.temp_cache.cleanup()
    def prepare(self,stream=stream_packets,source=None):
        result=self.cache.start(source or self.source,FFMPEG,FFPROBE,run,stream)
        self.cache.jobs[result['key']]['thread'].join(timeout=5)
        state=self.cache.info(source or self.source);self.assertEqual(state['state'],'ready',state);return state
    def hashes(self,path):
        result=subprocess.run([FFPROBE,'-v','error','-show_packets','-show_data_hash','sha256',
            '-show_entries','packet=stream_index,data_hash','-of','json',str(path)],capture_output=True,timeout=5)
        return [(p['stream_index'],p['data_hash']) for p in json.loads(result.stdout)['packets']]
    def test_copy_preserves_every_encoded_video_audio_and_subtitle_packet(self):
        runner=Mock(side_effect=stream_packets);state=self.prepare(runner)
        key,path=self.cache.ready(self.source)
        self.assertEqual(self.hashes(self.source),self.hashes(path))
        command=runner.call_args.args[0];self.assertEqual(command[command.index('-c')+1],'copy')
        for forbidden in ('-vf','-af','-pix_fmt','-crf','-r'):self.assertNotIn(forbidden,command)
        self.assertIn('-cues_to_front',command)
        fresh=NativePrepare(lambda:self.directory)
        self.assertIsNotNone(fresh.ready(self.source));fresh.close()
        self.assertEqual(state['percent'],100)
    def test_pin_and_paused_prepared_playback_protect_cache_from_clear(self):
        self.prepare();key,path=self.cache.pin(self.source)
        with self.assertRaises(HTTPException):self.cache.clear(self.source)
        self.cache.unpin(key);self.cache.activity('owner',self.source,False,prepared=True)
        with self.assertRaises(HTTPException):self.cache.clear(self.source)
        self.cache.activity('owner',None,False,present=False)
        self.assertGreater(self.cache.clear(self.source)['freed_bytes'],0);self.assertFalse(path.exists())
        self.assertTrue(self.source.exists())
    def test_hdr10_bit_depth_color_and_encoded_packets_survive_preparation(self):
        source=self.directory/'hdr10.mkv'
        subprocess.run([FFMPEG,'-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=24','-t','2',
            '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p10le',
            '-x264-params','colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=tv',str(source)],check=True,timeout=10)
        before=hashlib.sha256(source.read_bytes()).hexdigest();self.prepare(source=source)
        key,path=self.cache.ready(source);color=self.cache.metadata(key)['signature'][0]['color']
        self.assertEqual(color['bit_depth'],10);self.assertEqual(color['transfer'],'smpte2084')
        self.assertTrue(color['hdr']);self.assertEqual(color['primaries'],'bt2020')
        self.assertEqual(self.hashes(source),self.hashes(path))
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)
    def test_mismatched_ownership_marker_blocks_cleanup(self):
        self.prepare();key,path=self.cache.ready(self.source)
        marker=path.parent/'owner.json';owner=json.loads(marker.read_text(encoding='utf-8'))
        owner['source'][1]+=1;marker.write_text(json.dumps(owner),encoding='utf-8')
        with self.assertRaises(HTTPException):self.cache.clear(self.source)
        self.assertTrue(path.exists())
    def test_signature_detects_hdr_mastering_display_and_aspect_changes(self):
        stream={'codec_type':'video','codec_name':'hevc','width':3840,'height':2160,'pix_fmt':'yuv420p10le',
            'color_transfer':'smpte2084','sample_aspect_ratio':'1:1','side_data_list':[
                {'side_data_type':'Mastering display metadata','max_luminance':'1000/1'},
                {'side_data_type':'Display Matrix','rotation':90}]}
        before=signatures(json.dumps({'streams':[stream]}))
        for key,value in [('sample_aspect_ratio','2:1'),('side_data_list',[])]:
            after=signatures(json.dumps({'streams':[stream|{key:value}]}));self.assertNotEqual(before,after)
    def test_budget_failure_does_not_encode_to_reduce_file_size(self):
        self.cache.budget=1;runner=Mock()
        with self.assertRaises(HTTPException):self.cache.start(self.source,FFMPEG,FFPROBE,run,runner)
        runner.assert_not_called();self.assertTrue(self.source.exists())
    def test_cached_file_imported_as_source_or_unknown_entries_are_never_deleted(self):
        self.prepare();key,path=self.cache.ready(self.source)
        self.cache.protected=lambda:{str(path)}
        with self.assertRaises(HTTPException):self.cache.clear(self.source)
        self.cache.protected=lambda:set();note=path.parent/'keep.txt';note.write_text('keep',encoding='utf-8')
        with self.assertRaises(HTTPException):self.cache.clear(self.source)
        self.assertTrue(note.exists());self.assertTrue(path.exists())
    def test_cancelled_copy_cannot_publish_and_reclaims_only_its_owned_files(self):
        entered=threading.Event()
        def slow(command,timeout,event,consume):
            entered.set();event.wait(3);raise ValueError('stopped')
        result=self.cache.start(self.source,FFMPEG,FFPROBE,run,slow);self.assertTrue(entered.wait(1))
        self.cache.cancel(self.source);self.cache.jobs[result['key']]['thread'].join(timeout=2)
        self.assertEqual(self.cache.info(self.source)['state'],'cancelled');self.assertFalse(list(self.cache.root().iterdir()))
    def test_disable_stops_unfinished_job_without_removing_completed_copy(self):
        self.prepare();ready=self.cache.ready(self.source)
        other=self.directory/'other.mkv';shutil.copyfile(self.source,other);entered=threading.Event()
        def slow(command,timeout,event,consume):
            entered.set();event.wait(3);raise ValueError('disabled')
        result=self.cache.start(other,FFMPEG,FFPROBE,run,slow);self.assertTrue(entered.wait(1))
        self.cache.cancel_pending();self.cache.jobs[result['key']]['thread'].join(timeout=2)
        self.assertEqual(self.cache.info(other)['state'],'cancelled');self.assertEqual(self.cache.ready(self.source),ready)
        self.assertFalse(self.cache.closed);self.prepare(source=other)
    def test_playback_preempts_copy_and_idle_restarts_without_reencoding(self):
        entered=threading.Event();calls=[]
        def interruptible(command,timeout,event,consume):
            calls.append(command)
            if len(calls)==1:
                entered.set();event.wait(3);raise ValueError('paused for playback')
            return stream_packets(command,timeout,event,consume)
        result=self.cache.start(self.source,FFMPEG,FFPROBE,run,interruptible);self.assertTrue(entered.wait(1))
        self.cache.activity('owner',self.source,True)
        end=time.monotonic()+2
        while self.cache.info(self.source)['state']!='waiting' and time.monotonic()<end:time.sleep(.02)
        self.assertEqual(self.cache.info(self.source)['state'],'waiting')
        self.cache.activity('owner',self.source,False)
        self.cache.jobs[result['key']]['thread'].join(timeout=4)
        self.assertEqual(self.cache.info(self.source)['state'],'ready');self.assertEqual(len(calls),2)
    def test_source_change_rejects_old_copy(self):
        source=self.directory/'case.mkv';shutil.copyfile(self.source,source)
        def change(command,timeout,event,consume):
            result=stream_packets(command,timeout,event,consume);s=source.stat();os.utime(source,ns=(s.st_atime_ns,s.st_mtime_ns+1000000000));return result
        result=self.cache.start(source,FFMPEG,FFPROBE,run,change);self.cache.jobs[result['key']]['thread'].join(timeout=4)
        job=self.cache.jobs[result['key']];self.assertEqual(job['state'],'failed');self.assertIsNone(self.cache.ready(source))
    def test_metadata_mismatch_never_publishes_a_falsely_lossless_copy(self):
        def bad_probe(command,timeout,event):
            code,raw,error=run(command,timeout,event)
            if str(command[-1]).endswith('preparing.mkv'):
                data=json.loads(raw);data['streams'][0]['width']=80;raw=json.dumps(data).encode()
            return code,raw,error
        result=self.cache.start(self.source,FFMPEG,FFPROBE,bad_probe,stream_packets);self.cache.jobs[result['key']]['thread'].join(timeout=4)
        self.assertEqual(self.cache.jobs[result['key']]['state'],'failed');self.assertIsNone(self.cache.ready(self.source))
