import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import test_stability
from app import main as m
from app.scan_jobs import ThumbnailJobs, DeferredThumbnails, ThumbnailService
from app.scanning import ScanManager


class ScanJobsTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory(prefix='avhub-spooled-scan-');self.addCleanup(temporary.cleanup)
        self.folder=Path(temporary.name);self.thumbs=self.folder/'thumbnails';self.thumbs.mkdir()
        for key,value in [('DATA',self.folder),('DB',self.folder/'library.db'),('THUMBS',self.thumbs)]:
            context=patch.object(m,key,value);context.start();self.addCleanup(context.stop)
        m.bootstrap();self.source=self.folder/'source';self.source.mkdir()
        self.manager=ScanManager();self.addCleanup(self.manager.close)
        self.jobs=ThumbnailJobs(m.connection,[1])
        with m.connection() as db:db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)',(str(self.source),))

    def seed(self,count=1):
        for number in range(1,count+1):
            path=self.source/f'{number}.mp4';path.write_bytes(b'never modified')
            stat=path.stat()
            with m.connection() as db:
                db.execute('''INSERT INTO media(id,root_id,path,name,title,size,modified,duration,created_at,updated_at)
                    VALUES(?,1,?,?,?, ?,?,120,0,0)''',(number,str(path),path.name,path.stem,stat.st_size,stat.st_mtime))
            self.jobs.schedule(path,number,120,True)

    def join(self):
        self.manager.thread.join(10);self.assertFalse(self.manager.busy())
        return self.manager.snapshot()

    def test_slow_thumbnail_does_not_block_hundreds_of_video_indexes(self):
        for number in range(80):(self.source/f'{number}.mp4').write_bytes(b'read only')
        entered=threading.Event();release=threading.Event()
        def slow(*a,**kw):
            entered.set()
            while not release.wait(.02):
                if kw['cancelled'].is_set():raise m.ScanCancelled()
            return None
        metadata={'duration':120,'width':320,'height':180,'video_codec':'h264','audio_tracks':[],'subtitles':[]}
        with patch.object(m,'probe',return_value=metadata),patch.object(m,'thumbnail',side_effect=slow):
            service=ThumbnailService(m.connection,m.process_thumbnail,m.read_connection)
            with patch.object(m,'thumbnail_service',service):
                service.start()
                try:
                    self.manager.start(1,lambda manager:m.run_scan([{'id':1,'path':str(self.source)}],manager))
                    self.assertTrue(entered.wait(3));snap=self.join()
                    self.assertEqual(snap['state'],'completed')
                    self.assertTrue(snap['discovery_done'],'thumbnail backpressure blocked indexing')
                    self.assertEqual((snap['processed'],snap['updated']),(80,80))
                    self.assertEqual(self.jobs.count(),80)
                    self.assertIsNotNone(service.snapshot()['current'])
                    # Directory management is no longer blocked by a slow cover.
                    self.manager.require_idle();service.pause();service.close()
                finally:release.set();service.close()
        self.assertEqual(self.jobs.count(),80)  # Interrupted images remain recoverable.
        self.assertTrue(all(p.read_bytes()==b'read only' for p in self.source.iterdir()))

    def test_cancel_then_new_worker_resumes_persisted_jobs(self):
        self.seed(4);entered=threading.Event();release=threading.Event()
        def slow(*job):entered.set();release.wait(5);return True
        def first(manager):
            with DeferredThumbnails(manager,slow,self.jobs):self.assertTrue(entered.wait(3));manager.cancelled.set();release.set()
        self.manager.start(1,first);self.assertEqual(self.join()['state'],'cancelled');self.assertEqual(self.jobs.count(),4)
        calls=[]
        def second(manager):
            with DeferredThumbnails(manager,lambda *job:calls.append(job[1]) or True,ThumbnailJobs(m.connection,[1])):pass
        self.manager.start(1,second);self.assertEqual(self.join()['state'],'completed')
        self.assertEqual(calls,[1,2,3,4]);self.assertEqual(self.jobs.count(),0)
        self.assertEqual(self.manager.snapshot()['thumbnails_pending'],0)

    def test_failed_fingerprint_cooldown_and_changed_source_retry(self):
        self.seed();key,_=self.jobs.next();self.assertTrue(self.jobs.finish(key,False))
        self.assertFalse(self.jobs.schedule(self.source/'1.mp4',1));self.assertEqual(self.jobs.count(),0)
        with m.connection() as db:db.execute('UPDATE media SET size=size+1 WHERE id=1')
        self.assertTrue(self.jobs.schedule(self.source/'1.mp4',1));self.assertEqual(self.jobs.count(),1)

    def test_old_completion_cannot_delete_replaced_job(self):
        self.seed();old,_=self.jobs.next()
        with m.connection() as db:db.execute('UPDATE media SET modified=modified+1 WHERE id=1')
        self.assertFalse(self.jobs.schedule(self.source/'1.mp4',1))  # Already counted pending.
        self.assertFalse(self.jobs.finish(old,True));self.assertEqual(self.jobs.count(),1)
        current,_=self.jobs.next();self.assertTrue(self.jobs.finish(current,True));self.assertFalse(self.jobs.finish(current,True))

    def test_missing_or_stale_job_does_not_touch_source(self):
        self.seed(2)
        with m.connection() as db:
            db.execute('UPDATE media SET missing=1 WHERE id=1');db.execute('DELETE FROM media WHERE id=2')
        calls=[]
        def run(manager):
            with DeferredThumbnails(manager,lambda *job:calls.append(job) or True,self.jobs):pass
        self.manager.start(1,run);self.join();self.assertEqual(calls,[]);self.assertEqual(self.jobs.count(),0)

    def test_reassigned_root_counts_job_when_old_root_was_not_active(self):
        self.seed()
        with m.connection() as db:db.execute('UPDATE thumbnail_jobs SET root_id=2 WHERE media_id=1')
        def run(manager):
            with DeferredThumbnails(manager,lambda *job:True,self.jobs) as images:
                images.submit(self.source/'1.mp4',1,120,True)
        self.manager.start(1,run);snap=self.join()
        self.assertEqual(snap['state'],'completed');self.assertEqual(snap['thumbnails_pending'],0)
        self.assertEqual(self.jobs.count(),0)

    def test_offline_root_preserves_jobs_without_loading_images(self):
        self.seed()
        with patch.object(m,'thumbnail',side_effect=AssertionError('offline source read')):
            self.manager.start(1,lambda manager:m.run_scan([{'id':1,'path':str(self.folder/'offline')}],manager))
            snap=self.join()
        self.assertEqual(snap['error_count'],1);self.assertEqual(snap['thumbnails_pending'],0)
        self.assertEqual(self.jobs.count(),1);self.assertEqual(m.media_record(1)['missing'],0)

    def test_worker_storage_failure_marks_scan_failed(self):
        self.seed()
        def run(manager):
            with DeferredThumbnails(manager,lambda *job:True,self.jobs):pass
        with patch.object(self.jobs,'next',side_effect=OSError('disk error')):
            self.manager.start(1,run);snap=self.join()
        self.assertEqual(snap['state'],'failed');self.assertIn('封面任务存储失败',snap['errors'][0]['message'])

    def test_subtitle_discovery_stats_only_name_and_extension_matches(self):
        candidates=[self.source/f'other-{i}.mkv' for i in range(10_000)]+[self.source/'1.zh.srt',self.source/'1.folder.srt']
        with patch.object(Path,'iterdir',return_value=iter(candidates)),patch.object(Path,'is_file',return_value=True) as stat:
            self.assertEqual(len(m.sidecar_subtitles(self.source/'1.mp4')),2)
        self.assertEqual(stat.call_count,2)

    def test_direct_start_never_enumerates_subtitles_and_exposes_stage_timings(self):
        self.seed()
        with patch.object(m,'sidecar_subtitles',side_effect=AssertionError('playback path enumerated subtitles')):
            result=m.start_playback(1,m.PlaybackInput(prefer_original=True))
        self.assertEqual(result['mode'],'direct')
        for key in ['metadata_ms','source_check_ms','total_ms']:self.assertGreaterEqual(result['preparation'][key],0)
        self.assertGreaterEqual(result['preparation']['total_ms'],result['preparation']['metadata_ms'])


if __name__=='__main__':unittest.main()
