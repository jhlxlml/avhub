import json
import struct
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

from app.mp4_timeline import boxes,sample_keys,quick_timeline,container_copy_color,UnsafeCopyColor,MAX_METADATA
from app.indexed_remux import build_remux_index,IndexedRemux
from app.video_color import h264_copy_color_args

ROOT=Path(__file__).resolve().parents[1]
FFMPEG=str(ROOT/'bin/ffmpeg.exe');FFPROBE=str(ROOT/'bin/ffprobe.exe')


class Mp4TimelineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='avhub-mp4-timeline-');self.folder=Path(self.temp.name)
        self.cancelled=threading.Event()

    def tearDown(self):self.temp.cleanup()

    @staticmethod
    def probe_run(command,timeout,cancelled):
        result=subprocess.run(command,capture_output=True,timeout=timeout)
        return result.returncode,result.stdout,result.stderr

    def source(self,bframes=3,extra=(),name='clip'):
        source=self.folder/f'{name}-{bframes}.mp4'
        subprocess.run([FFMPEG,'-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=25',
            '-f','lavfi','-i','sine=frequency=440','-t','14','-c:v','libx264','-preset','fast',
            '-g','50','-bf',str(bframes),'-c:a','aac',*extra,str(source)],check=True,timeout=15)
        return source

    def test_b_frame_and_no_reorder_tables_match_demuxed_keyframes_and_pixels(self):
        for bframes in [0,3]:
            with self.subTest(bframes=bframes):
                source=self.source(bframes)
                original=source.read_bytes();modified=source.stat().st_mtime_ns
                run=Mock(side_effect=self.probe_run)
                quick=quick_timeline(source,FFPROBE,run,self.cancelled)
                self.assertEqual(run.call_count,1);self.assertIn('%+#8',run.call_args.args[0])
                _,raw,_=self.probe_run([FFPROBE,'-v','error','-fflags','+genpts','-select_streams','v:0','-show_packets',
                    '-show_entries','packet=pts_time,dts_time,flags:format=start_time,duration','-of','json',str(source)],10,self.cancelled)
                packets=[p for p in json.loads(raw)['packets'] if 'K' in p['flags']]
                self.assertEqual(len(quick['packets']),len(packets))
                for a,b in zip(quick['packets'],packets):
                    for key in ['pts_time','dts_time']:self.assertAlmostEqual(a[key],float(b[key]),places=5)
                index=build_remux_index(source,self.folder/f'index-{bframes}',FFPROBE,self.probe_run,self.cancelled)
                stream=IndexedRemux(source,data=index,ffmpeg=FFMPEG,run=self.probe_run,folder=self.folder)
                with stream.open_fragment(3) as reader:fragment=reader.read()
                encoded=subprocess.run([FFMPEG,'-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],input=fragment,capture_output=True,timeout=5)
                original_frame=subprocess.run([FFMPEG,'-v','error','-ss','6','-i',str(source),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,timeout=5)
                self.assertEqual(len(encoded.stdout),160*90*3);self.assertEqual(encoded.stdout,original_frame.stdout)
                self.assertEqual(source.read_bytes(),original);self.assertEqual(source.stat().st_mtime_ns,modified)
                # Separate fixtures cannot reuse the same session's fragments.
                for file in self.folder.glob('segment_*'):file.unlink()

    def test_unsupported_complex_edit_falls_back_and_is_never_guessed(self):
        source=self.source(extra=('-output_ts_offset','2'))
        with self.assertRaises(ValueError):sample_keys(source,self.cancelled)
        run=Mock(side_effect=self.probe_run)
        index=build_remux_index(source,self.folder/'index',FFPROBE,run,self.cancelled)
        self.assertTrue(index['fragments']);self.assertEqual(run.call_count,1)
        self.assertNotIn('-read_intervals',run.call_args.args[0])

    def test_signed_demux_offset_falls_back_and_variable_timing_matches_real_demuxing(self):
        variants=[('signed',('-movflags','+negative_cts_offsets')),
                  ('vfr',('-vf','setpts=if(lt(N\\,150)\\,N/(25*TB)\\,(6+(N-150)/20)/TB)','-fps_mode','vfr'))]
        for name,extra in variants:
            with self.subTest(name=name):
                source=self.source(extra=extra,name=name)
                if name=='signed':
                    # MOV demuxing can shift DTS separately for negative CTS.
                    # Do not guess that shift from only the first keyframe.
                    with self.assertRaisesRegex(ValueError,'锚点不一致'):quick_timeline(source,FFPROBE,self.probe_run,self.cancelled)
                    run=Mock(side_effect=self.probe_run)
                    index=build_remux_index(source,self.folder/name,FFPROBE,run,self.cancelled)
                    self.assertTrue(index['fragments']);self.assertEqual(run.call_count,2)
                    self.assertNotIn('-read_intervals',run.call_args.args[0])
                    continue
                quick=quick_timeline(source,FFPROBE,self.probe_run,self.cancelled)
                _,raw,_=self.probe_run([FFPROBE,'-v','error','-fflags','+genpts','-select_streams','v:0','-show_packets',
                    '-show_entries','packet=pts_time,dts_time,flags','-of','json',str(source)],10,self.cancelled)
                keys=[p for p in json.loads(raw)['packets'] if 'K' in p['flags']]
                self.assertEqual(len(keys),len(quick['packets']))
                for actual,wanted in zip(quick['packets'],keys):
                    for field in ['pts_time','dts_time']:self.assertAlmostEqual(actual[field],float(wanted[field]),places=5)
                run=Mock(side_effect=self.probe_run)
                cached=build_remux_index(source,self.folder/name,FFPROBE,run,self.cancelled)
                calls=run.call_count
                self.assertEqual(build_remux_index(source,self.folder/name,FFPROBE,run,self.cancelled),cached)
                self.assertEqual(run.call_count,calls)

    def test_extended_mdat_is_skipped_without_reading_its_payload(self):
        source=self.source();moov=next(bytes(value) for kind,value in boxes(memoryview(source.read_bytes())) if kind==b'moov')
        # Logical sparse reader: no physical 4 GiB fixture allocation on Windows.
        mdat_size=4*1024**3+32;reads=[]
        class SparseReader:
            position=0
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def seek(self,position):self.position=position
            def read(self,length):
                reads.append(length)
                chunks={0:struct.pack('>I4s',1,b'mdat'),8:struct.pack('>Q',mdat_size),
                        mdat_size:struct.pack('>I4s',len(moov)+8,b'moov'),mdat_size+8:moov}
                raw=chunks[self.position];self.position+=length
                if len(raw)!=length:raise AssertionError('Unexpected payload read')
                return raw
        sparse=Mock();sparse.stat.return_value=Mock(st_size=mdat_size+8+len(moov));sparse.open.return_value=SparseReader()
        keys,_=sample_keys(sparse,self.cancelled)
        self.assertGreater(len(keys),5);self.assertLess(sum(reads),1024**2)

    def test_invalid_sizes_and_cancellation_are_bounded(self):
        source=self.folder/'broken.mp4'
        for raw in [b'bad',struct.pack('>I4s',7,b'moov'),struct.pack('>I4sQ',1,b'moov',2**63)]:
            source.write_bytes(raw)
            with self.assertRaises(ValueError):sample_keys(source,self.cancelled)
        with source.open('wb') as output:
            output.write(struct.pack('>I4s',MAX_METADATA+9,b'moov'));output.truncate(MAX_METADATA+9)
        with self.assertRaisesRegex(ValueError,'时间表过大'):sample_keys(source,self.cancelled)
        source=self.source();self.cancelled.set()
        run=Mock()
        with self.assertRaisesRegex(ValueError,'取消'):quick_timeline(source,FFPROBE,run,self.cancelled)
        run.assert_not_called()

    def test_container_color_tags_survive_stream_copy_delivery(self):
        fields='stream=codec_name,width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries'
        def color(arguments):
            result=subprocess.run([FFPROBE,'-v','error','-select_streams','v:0','-show_entries',fields,'-of','json',*arguments],capture_output=True,timeout=5)
            return json.loads(result.stdout)['streams'][0]
        for pixfmt,primaries,transfer,matrix in [('yuv420p','bt709','bt709','bt709'),('yuv420p10le','bt2020','smpte2084','bt2020nc')]:
            with self.subTest(pixfmt=pixfmt):
                base=self.source(extra=('-pix_fmt',pixfmt),name=pixfmt);source=self.folder/f'container-{pixfmt}.mp4'
                subprocess.run([FFMPEG,'-v','error','-i',str(base),'-c','copy','-color_primaries',primaries,
                    '-color_trc',transfer,'-colorspace',matrix,'-color_range','tv',str(source)],check=True,timeout=5)
                original=color([str(source)]);self.assertEqual(original['color_primaries'],primaries)
                cache=self.folder/pixfmt;cache.mkdir()
                data=build_remux_index(source,cache/'index',FFPROBE,self.probe_run,self.cancelled)
                stream=IndexedRemux(source,data=data,ffmpeg=FFMPEG,run=self.probe_run,folder=cache)
                with stream.open_fragment(2) as reader:raw=reader.read()
                target=cache/'delivered.ts';target.write_bytes(raw)
                self.assertEqual(color([str(target)]),original)
                def pixels(arguments):return subprocess.run([FFMPEG,'-v','error',*arguments,'-frames:v','1','-f','rawvideo','-pix_fmt',pixfmt,'-'],capture_output=True,timeout=5).stdout
                source_pixels=pixels(['-ss','4','-i',str(source)])
                self.assertTrue(source_pixels);self.assertEqual(pixels(['-i',str(target)]),source_pixels)
                # Old time indexes are enriched from bounded colr reads, not a
                # packet rebuild. The source is never rewritten to add VUI.
                file=next((cache/'index').glob('*.json'));old=json.loads(file.read_text());old.pop('copy_color');file.write_text(json.dumps(old))
                no_probe=Mock(side_effect=AssertionError('A cached time index must not rescan'))
                self.assertEqual(build_remux_index(source,cache/'index',FFPROBE,no_probe,self.cancelled),data)
                no_probe.assert_not_called()

    def test_icc_is_refused_and_color_arguments_are_numeric_only(self):
        atom=lambda name,data:struct.pack('>I4s',len(data)+8,name)+data
        entry=bytes(78)+atom(b'colr',b'prof'+b'owned ICC fixture')
        stsd=bytes(4)+struct.pack('>I',1)+atom(b'avc1',entry)
        media=atom(b'hdlr',bytes(8)+b'vide')+atom(b'minf',atom(b'stbl',atom(b'stsd',stsd)))
        source=self.folder/'icc.mp4';source.write_bytes(atom(b'moov',atom(b'trak',atom(b'mdia',media))))
        with self.assertRaises(UnsafeCopyColor):container_copy_color(source,self.cancelled)
        self.assertEqual(h264_copy_color_args({'colour_primaries':'1:tonemap=bt709','video_full_range_flag':True}),[])
        args=h264_copy_color_args({'colour_primaries':9,'transfer_characteristics':16,'matrix_coefficients':9,'video_full_range_flag':0})
        self.assertIn('transfer_characteristics=16',args[1]);self.assertNotIn('tonemap',str(args))
