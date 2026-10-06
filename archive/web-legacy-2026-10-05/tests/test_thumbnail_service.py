import sqlite3
import subprocess
import threading
import time
import unittest
import asyncio
from pathlib import Path
from unittest.mock import patch, Mock

import test_scan_jobs as fixture
from app import main as m
from app.scan_jobs import ThumbnailService
from fastapi import HTTPException
from starlette.requests import Request
from app.db_timing import DatabaseTiming


class ThumbnailServiceTests(unittest.TestCase):
    setUp=fixture.ScanJobsTests.setUp
    seed=fixture.ScanJobsTests.seed
    def wait_for(self,condition):
        deadline=time.monotonic()+3
        while not condition() and time.monotonic()<deadline:time.sleep(.02)
        self.assertTrue(condition())

    def service(self,process):
        service=ThumbnailService(m.connection,process,m.read_connection)
        context=patch.object(m,'thumbnail_service',service);context.start();self.addCleanup(context.stop)
        self.addCleanup(service.close);return service

    def test_pause_survives_worker_restart_and_resume(self):
        self.seed(3);entered=threading.Event()
        def work(key,cancelled,gate):
            entered.set();cancelled.wait(2);return True,''
        first=self.service(work);first.start();self.assertTrue(entered.wait(2))
        first.pause();first.close();self.assertEqual(self.jobs.count(),3)
        calls=[];second=self.service(lambda key,event,gate:(calls.append(key['media_id']) or True,''))
        second.start();time.sleep(.05);self.assertEqual(calls,[]);self.assertTrue(second.snapshot()['paused'])
        second.pause(False);self.wait_for(lambda:self.jobs.count()==0);self.assertEqual(calls,[1,2,3])

    def test_visible_priority_and_failure_reason(self):
        self.seed(3);service=self.service(lambda key,event,gate:(False,'decoder error'))
        service.prioritize([3]);self.assertEqual(service.jobs.next()[0]['media_id'],3)
        service.start();self.wait_for(lambda:self.jobs.count()==0)
        result=m.failed_thumbnails(page=1,page_size=2)
        self.assertEqual((result['total'],len(result['items'])),(3,2))
        self.assertTrue(all(row['last_error']=='decoder error' for row in result['items']))

    def test_playing_cancels_decode_and_release_resumes_same_pending_job(self):
        self.seed();entered=threading.Event();cancelled_seen=threading.Event();calls=[]
        def work(key,cancelled,gate):
            calls.append(key['media_id'])
            if len(calls)==1:
                entered.set();cancelled.wait(2)
                if cancelled.is_set():cancelled_seen.set()
            return True,''
        service=self.service(work);service.start();self.assertTrue(entered.wait(2))
        service.playback_activity('a'*32,True);self.assertTrue(cancelled_seen.wait(2))
        self.wait_for(lambda:service.current is None)
        self.assertEqual(self.jobs.count(),1);self.assertFalse(service.snapshot()['paused'])
        self.assertEqual(calls,[1]);service.playback_activity('a'*32,False)
        self.wait_for(lambda:self.jobs.count()==0);self.assertEqual(calls,[1,1])

    def test_explicit_time_retry_replaces_revision_not_custom_cover(self):
        self.seed();service=self.service(lambda *args:(True,''));old,_=self.jobs.next()
        with m.connection() as db:db.execute("UPDATE media SET custom_cover='covers/manual.jpg' WHERE id=1")
        result=m.retry_thumbnail(1,m.ThumbnailRetry(frame_time=30))
        self.assertEqual(result['frame_time'],30)
        self.assertFalse(self.jobs.finish(old,True))
        self.assertEqual(m.media_record(1)['custom_cover'],'covers/manual.jpg')
        with self.assertRaises(HTTPException):m.retry_thumbnail(1,m.ThumbnailRetry(frame_time=120))
        self.assertEqual((self.source/'1.mp4').read_bytes(),b'never modified')

    def test_old_decode_cannot_publish_after_retry(self):
        self.seed();service=self.service(m.process_thumbnail);old,_=self.jobs.next()
        def decode(command,*args):
            Path(command[-1]).write_bytes(b'\xff\xd8old\xff\xd9')
            m.retry_thumbnail(1,m.ThumbnailRetry(frame_time=15))
            return 0,b'',b''
        with patch.object(m,'scan_process',side_effect=decode):
            success,_=m.process_thumbnail(old,threading.Event(),service.gate)
        self.assertFalse(success);self.assertFalse((self.thumbs/'1.jpg').exists())
        self.assertEqual(self.jobs.next()[0]['frame_time'],15)

    def test_offline_job_is_deferred_not_failed_or_repeated(self):
        self.seed();service=self.service(lambda *args:(_ for _ in ()).throw(AssertionError('offline read')))
        with m.connection() as db:db.execute('UPDATE roots SET path=? WHERE id=1',(str(self.folder/'offline'),))
        service.start();self.wait_for(lambda:service.snapshot()['blocked']==1)
        self.assertEqual(service.snapshot()['failed'],0);self.assertIsNone(service.jobs.next())

    def test_root_removal_cancels_independent_decode(self):
        self.seed();entered=threading.Event();cancelled_seen=threading.Event()
        def work(key,cancelled,gate):
            entered.set();cancelled.wait(2)
            if cancelled.is_set():cancelled_seen.set()
            return True,''
        service=self.service(work);service.start();self.assertTrue(entered.wait(2))
        m.remove_root(1);self.assertTrue(cancelled_seen.wait(2))
        self.assertEqual(self.jobs.count(),0);self.assertEqual(m.media_record(1)['missing'],1)
        self.assertTrue((self.source/'1.mp4').is_file())

    def test_read_snapshot_bypasses_scan_mutex_but_cannot_write(self):
        self.seed();entered=threading.Event();release=threading.Event()
        def writer():
            with m.connection() as db:
                db.execute("UPDATE media SET title='uncommitted' WHERE id=1");entered.set();release.wait(3)
        thread=threading.Thread(target=writer);thread.start();self.assertTrue(entered.wait(2))
        try:
            began=time.perf_counter();result=m.media(page=1,page_size=24)
            self.assertEqual(result['items'][0]['title'],'1');self.assertLess(time.perf_counter()-began,.3)
            with m.read_connection() as db:
                with self.assertRaises(sqlite3.OperationalError):db.execute('DELETE FROM media')
        finally:release.set();thread.join(3)
        self.assertEqual(m.media_record(1)['title'],'uncommitted')

    def test_selected_capture_failure_preserves_old_image_and_diagnostics(self):
        self.seed();service=self.service(m.process_thumbnail)
        target=self.thumbs/'1.jpg';target.write_bytes(b'\xff\xd8old\xff\xd9')
        m.retry_thumbnail(1,m.ThumbnailRetry(frame_time=30));key,_=self.jobs.next()
        with patch.object(m,'scan_process',return_value=(1,b'',b'Cannot decode packet')) as decode:
            success,error=m.process_thumbnail(key,threading.Event(),service.gate)
        self.assertFalse(success);self.assertEqual(decode.call_count,1)
        self.assertIn('30 秒',error);self.assertIn('Cannot decode packet',error)
        self.assertEqual(target.read_bytes(),b'\xff\xd8old\xff\xd9')
        self.assertEqual(list(self.thumbs.glob('1-*.jpg')),[])

    def test_reserved_sdr_tags_get_thumbnail_only_fallback(self):
        self.seed();commands=[]
        def decode(command,*args):
            commands.append(command.copy())
            if len(commands)==1:return 1,b'',b'Unsupported input: fmt:yuv420p csp:bt709 prim:reserved trc:reserved'
            Path(command[-1]).write_bytes(b'\xff\xd8corrected\xff\xd9');return 0,b'',b''
        with patch.object(m,'scan_process',side_effect=decode):
            self.assertEqual(m.thumbnail(self.source/'1.mp4',1,120,frame_time=30),'thumbnails/1.jpg')
        self.assertEqual(len(commands),2)
        self.assertIn('setparams=color_primaries=bt709:color_trc=bt709',commands[1][commands[1].index('-vf')+1])
        self.assertEqual(commands[0][commands[0].index('-vf')+1],'scale=480:-2')
        self.assertEqual((self.source/'1.mp4').read_bytes(),b'never modified')

    def test_reads_are_concurrent_but_restore_gate_is_exclusive(self):
        self.seed();entered=threading.Event();release=threading.Event()
        def reader():
            with m.read_connection():entered.set();release.wait(2)
        thread=threading.Thread(target=reader);thread.start();self.assertTrue(entered.wait(2))
        try:
            began=time.perf_counter();self.assertEqual(m.media_record(1)['id'],1)
            self.assertLess(time.perf_counter()-began,.3)
        finally:release.set();thread.join(3)
        completed=threading.Event()
        with m.DB_READ_GATE.write():
            thread=threading.Thread(target=lambda:(m.media_record(1),completed.set()));thread.start()
            self.assertFalse(completed.wait(.05))
        self.assertTrue(completed.wait(2));thread.join(3)

    def test_restore_reloads_pause_control_and_invalidates_queued_work(self):
        self.seed();service=self.service(lambda *args:(True,''));service.pause()
        payload=Path(m.create_backup().path).read_bytes();service.pause(False)
        async def receive():return {'type':'http.request','body':payload,'more_body':False}
        request=Request({'type':'http','method':'POST','path':'/api/backup/restore','headers':[]},receive)
        self.assertTrue(asyncio.run(m.restore_backup(request))['ok'])
        self.assertTrue(service.snapshot()['paused']);self.assertEqual(self.jobs.count(),0)

    def test_cover_store_failure_does_not_fail_metadata_scanner(self):
        self.seed();service=self.service(lambda *args:(True,''))
        with patch.object(service.jobs,'next',side_effect=OSError('disk error')):
            service.start();self.wait_for(lambda:'disk error' in service.snapshot()['error']);service.pause()
            self.assertFalse(self.manager.busy());self.assertEqual(self.jobs.count(),1)

    def test_slow_trace_survives_fast_sample_rollover_without_source_paths(self):
        timings=DatabaseTiming();timings.record('serialized',{'lock_wait':3,'total':3})
        for _ in range(600):timings.record('read',{'lock_wait':0,'total':.001})
        report=timings.report();self.assertEqual(report['slow_operations'][0]['lock_wait'],3000)
        self.assertEqual(report['groups']['read']['count'],512)
        self.assertNotIn('path',report['slow_operations'][0])

    def test_readonly_uri_encodes_special_characters_without_creating_wrong_db(self):
        self.seed();target=self.folder/'library #副本%.db'
        with m.connection() as source:
            destination=sqlite3.connect(target)
            try:source.backup(destination)
            finally:destination.close()
        with patch.object(m,'DB',target):
            self.assertEqual(m.media_record(1)['id'],1)
            m.validate_backup(target)
        self.assertFalse((self.folder/'library ').exists())

    def test_cancel_never_waits_on_pipe_without_timeout_and_releases_owner(self):
        process=Mock();process.pid=None
        process.communicate.side_effect=subprocess.TimeoutExpired('ffmpeg',1)
        owner=Mock();cancelled=threading.Event();cancelled.set()
        with patch.object(m.subprocess,'Popen',return_value=process),patch.object(m,'own_encoder',return_value=owner):
            with self.assertRaises(m.ScanCancelled):m.scan_process(['ffmpeg'],20,cancelled)
        process.terminate.assert_called_once();process.kill.assert_called_once();owner.close.assert_called_once()
        self.assertEqual([call.kwargs['timeout'] for call in process.communicate.call_args_list],[2,1])

    def test_timeout_and_ownership_failure_also_have_bounded_pipe_cleanup(self):
        for ownership_failure in [False,True]:
            process=Mock();process.pid=None;owner=Mock()
            process.communicate.side_effect=subprocess.TimeoutExpired('ffprobe',1)
            with patch.object(m.subprocess,'Popen',return_value=process),patch.object(m,'own_encoder',side_effect=OSError('owner error') if ownership_failure else None,return_value=owner):
                with self.assertRaises(OSError if ownership_failure else TimeoutError):m.scan_process(['ffprobe'],0)
            self.assertTrue(all(call.kwargs['timeout'] is not None for call in process.communicate.call_args_list))
            self.assertGreaterEqual(process.kill.call_count,1)
            if not ownership_failure:owner.close.assert_called_once()
