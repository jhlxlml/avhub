import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

# Import the shared temporary database setup before importing the application.
import test_stability
from app import main as m
from app.scanning import ScanManager
from app.path_index import RootPathIndex
from pathlib import PureWindowsPath
from fastapi import HTTPException


class SubtitleDiscoveryTests(unittest.TestCase):
    def test_sidecar_matching_treats_filename_metacharacters_as_literal_text(self):
        with tempfile.TemporaryDirectory(prefix='avhub-subtitle-test-') as directory:
            folder = Path(directory)
            video = folder / 'Film [1080p] (Part 1).mkv'
            expected = [folder / 'Film [1080p] (Part 1).ass', folder / 'Film [1080p] (Part 1).en.srt', folder / 'Film [1080p] (Part 1).zh-Hans.vtt']
            for subtitle in expected: subtitle.write_text('subtitle', encoding='utf-8')
            (folder / 'Other Film 1080p (Part 1).en.srt').write_text('unrelated', encoding='utf-8')
            (folder / 'Film [1080p] (Part 1).folder.srt').mkdir()

            result = m.sidecar_subtitles(video)

            self.assertEqual([Path(item['path']) for item in result], expected)

    def test_sidecar_discovery_tolerates_missing_video_folder(self):
        missing_video = Path(tempfile.gettempdir()) / 'avhub-no-such-folder-9a31' / 'video.mkv'
        self.assertEqual(m.sidecar_subtitles(missing_video), [])


class PaginationTests(unittest.TestCase):
    def setUp(self):
        m.bootstrap()
        with m.connection() as db:
            db.execute('DELETE FROM media')
            db.executemany('''INSERT INTO media(id,path,name,title,root_id,kind,favorite,duration,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,0)''',
                [(i,f'{i}.mp4',str(i),f'Video {i:03}',1 if i<=330 else 2,'movie',i%2,i,1000-i) for i in range(1,351)])

    def test_beyond_300_stable_paging_counts_and_filters(self):
        ids = []
        for page in range(1,9):
            result = m.media(page=page,page_size=48,sort='name')
            self.assertEqual(result['total'],350)
            ids += [row['id'] for row in result['items']]
        self.assertEqual(ids,list(range(1,351)))
        result = m.media(page=99,page_size=48,sort='name',root_id=2,favorite=True)
        self.assertEqual(result['total'],10)
        self.assertEqual(result['page'],1)
        self.assertEqual(len(result['items']),10)

    def test_sort_and_empty_page(self):
        result = m.media(page=1,page_size=24,sort='duration_desc')
        self.assertEqual(result['items'][0]['duration'],350)
        result = m.media(page=1,page_size=24,sort='duration_asc')
        self.assertEqual(result['items'][0]['duration'],1)
        result = m.media(page=1,page_size=24,sort='added')
        self.assertEqual(result['items'][0]['id'],1)
        result = m.media(page=50,page_size=24,q='no-match')
        self.assertEqual((result['items'],result['page'],result['pages'],result['total']),([],1,1,0))

    def test_search_treats_sql_wildcards_as_literal_characters(self):
        with m.connection() as db:
            db.execute("UPDATE media SET title='100% Real_Movie' WHERE id=1")
            db.execute("UPDATE media SET title='100X Real Movie' WHERE id=2")
        self.assertEqual([item['id'] for item in m.media(q='%', limit=1000)], [1])
        self.assertEqual([item['id'] for item in m.media(q='_', limit=1000)], [1])


class ScanTests(unittest.TestCase):
    def setUp(self):
        m.bootstrap()
        self.temp = tempfile.TemporaryDirectory(prefix='avhub-scan-test-')
        self.folder = Path(self.temp.name)
        self.manager = ScanManager()
        with m.connection() as db:
            db.execute('DELETE FROM media')
            db.execute('''INSERT INTO media(id,path,root_id,name,title,created_at,updated_at,progress,favorite,rating,tags)
                VALUES(1,?,1,'old','My edited title',0,0,21,1,5,'["personal"]')''',(str(self.folder/'sample.mp4'),))

    def tearDown(self):
        self.manager.close(); self.temp.cleanup()

    def run_job(self, path):
        self.manager.start(1,lambda manager:m.run_scan([{'id':1,'path':str(path)}],manager))
        self.manager.thread.join(5)
        self.assertFalse(self.manager.busy())
        return self.manager.snapshot()

    def test_incremental_refresh_preserves_personal_data(self):
        source = self.folder/'sample.mp4'
        source.write_bytes(b'new source')
        metadata = {'duration':120,'width':320,'height':180,'video_codec':'h264','audio_tracks':[],'subtitles':[]}
        with patch.object(m,'probe',return_value=metadata) as probe, patch.object(m,'thumbnail',return_value=None):
            first = self.run_job(self.folder)
            second = self.run_job(self.folder)
            self.assertEqual(first['updated'],1)
            self.assertEqual(second['updated'],0)
            self.assertEqual(probe.call_count,1)
        item = m.one_media(1)
        self.assertEqual(item['modified'],source.stat().st_mtime)
        self.assertEqual((item['title'],item['progress'],item['favorite'],item['rating'],item['tags']),
                         ('My edited title',21,1,5,['personal']))
        self.assertEqual(source.read_bytes(),b'new source')

    def test_unchanged_incremental_scan_does_not_write_each_media_row(self):
        source = self.folder/'sample.mp4'
        source.write_bytes(b'unchanged source')
        stat = source.stat()
        with m.connection() as db:
            db.execute('UPDATE media SET path=?,size=?,modified=?,missing=0,root_id=1 WHERE id=1',
                       (str(source.resolve()),stat.st_size,stat.st_mtime))
        with patch.object(m,'thumbnail',return_value=None), patch.object(m,'connection',wraps=m.connection) as connect:
            self.assertFalse(m.scan_file(1, source))
        # One read to compare the index; no per-file UPDATE transaction on an unchanged video.
        self.assertEqual(connect.call_count,1)

    def test_ten_thousand_file_scan_uses_bounded_parallel_workers(self):
        for index in range(10_000):
            (self.folder/f'video-{index:05}.mp4').touch()
        with m.connection() as db:
            root_id = db.execute('SELECT COALESCE(MAX(id),0)+1 FROM roots').fetchone()[0]
            db.execute('INSERT INTO roots(id,path,added_at) VALUES(?,?,0)', (root_id,str(self.folder)))

        lock = threading.Lock(); active = 0; max_active = 0
        def fake_scan(_root_id, _path, _cancelled=None, _existing=None, _resolved_path=None, **_kwargs):
            nonlocal active, max_active
            with lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(.0005)
            with lock: active -= 1
            return True

        with patch.object(m,'scan_file',side_effect=fake_scan):
            job = self.manager.start(root_id,lambda manager:m.run_scan([{'id':root_id,'path':str(self.folder)}],manager))
            self.manager.thread.join(60)

        result = self.manager.snapshot()
        self.assertFalse(self.manager.busy())
        self.assertEqual(result['state'],'completed')
        self.assertEqual((result['total'],result['processed'],result['updated']),(10_000,10_000,10_000))
        self.assertGreater(max_active,1)
        self.assertLessEqual(max_active,2)

    def test_offline_partial_and_cancelled_scan_do_not_mark_missing(self):
        result = self.run_job(self.folder/'offline')
        self.assertEqual(result['error_count'],1)
        self.assertEqual(m.one_media(1)['missing'],0)
        def partial_walk(path,onerror):
            onerror(PermissionError('denied'))
            return iter([])
        with patch.object(m.os,'walk',side_effect=partial_walk):
            result = self.run_job(self.folder)
        self.assertEqual(result['error_count'],1)
        self.assertEqual(m.one_media(1)['missing'],0)

        source = self.folder/'different.mp4'
        source.write_bytes(b'source')
        entered = threading.Event(); release = threading.Event()
        def slow(*args, **kwargs): entered.set(); release.wait(3); return True
        with patch.object(m,'scan_file',side_effect=slow):
            self.manager.start(1,lambda manager:m.run_scan([{'id':1,'path':str(self.folder)}],manager))
            self.assertTrue(entered.wait(2))
            with self.assertRaises(HTTPException): self.manager.start(None,lambda manager:None)
            self.manager.cancel(); release.set(); self.manager.thread.join(5)
        self.assertEqual(self.manager.snapshot()['state'],'cancelled')
        self.assertEqual(m.one_media(1)['missing'],0)

    def test_complete_scan_marks_deleted_and_reports_bad_file(self):
        (self.folder/'broken.mp4').write_bytes(b'broken')
        with patch.object(m,'scan_file',side_effect=ValueError('corrupt video')):
            result = self.run_job(self.folder)
        self.assertEqual(result['processed'],1)
        self.assertEqual(result['error_count'],1)
        self.assertEqual(result['state'],'completed')
        self.assertEqual(m.one_media(1)['missing'],1)

    def test_streaming_indexes_before_directory_discovery_finishes(self):
        source = self.folder / 'first.mp4'
        source.touch()
        processed = threading.Event()
        def walk(_root, onerror):
            yield str(self.folder), [], [source.name]
            self.assertTrue(processed.wait(3), 'indexing must start before the walk finishes')
        def scan(*_args, **_kwargs):
            processed.set()
            return True
        with patch.object(m.os, 'walk', side_effect=walk), patch.object(m, 'scan_file', side_effect=scan):
            result = self.run_job(self.folder)
        self.assertEqual((result['state'], result['processed']), ('completed', 1))

    def test_nested_registered_roots_are_pruned_and_owned_once(self):
        nested = self.folder / 'nested'; nested.mkdir()
        (nested / 'child.mp4').touch()
        (self.folder / 'parent.mp4').touch()
        with m.connection() as db:
            db.execute('DELETE FROM roots')
            db.executemany('INSERT INTO roots(id,path,added_at) VALUES(?,?,0)', [(1,str(self.folder)),(2,str(nested))])
        calls = []
        def scan(root_id, path, *_args, **_kwargs):
            calls.append((root_id, path.name))
            return True
        with patch.object(m, 'scan_file', side_effect=scan):
            self.manager.start(None, lambda manager: m.run_scan([{'id':1,'path':str(self.folder)}, {'id':2,'path':str(nested)}], manager))
            self.manager.thread.join(5)
        self.assertEqual(sorted(calls), [(1,'parent.mp4'),(2,'child.mp4')])

    def test_thumbnail_work_is_separate_from_metadata_indexing(self):
        source = self.folder / 'sample.mp4'; source.touch()
        queued = []
        class Queue:
            def submit(self, *job): queued.append(job)
        metadata = {'duration':120,'width':320,'height':180,'video_codec':'h264','audio_tracks':[],'subtitles':[]}
        with patch.object(m,'probe',return_value=metadata), patch.object(m,'thumbnail') as thumbnail:
            self.assertTrue(m.scan_file(1, source, thumbnails=Queue()))
            thumbnail.assert_not_called()
        self.assertEqual(queued, [(source,1,120,True)])
        self.assertEqual(m.one_media(1)['video_codec'], 'h264')


class RootIndexTests(unittest.TestCase):
    def test_ten_thousand_roots_choose_deepest_on_path_boundaries(self):
        roots = [(i, PureWindowsPath(f'D:/media/root-{i}')) for i in range(10_000)]
        roots += [(10001, PureWindowsPath('D:/media/root-9000/season'))]
        index = RootPathIndex(roots)
        self.assertEqual(index.owner(PureWindowsPath('D:/media/root-9000/season/video.mkv')), 10001)
        self.assertEqual(index.owner(PureWindowsPath('D:/media/root-9000/season-extra/video.ts')), 9000)
        self.assertIsNone(index.owner(PureWindowsPath('D:/media/root-90000/video.mp4')))
        self.assertIsNone(index.owner(PureWindowsPath('E:/media/root-9000/video.mp4')))

    def test_directory_metadata_can_be_loaded_without_touching_offline_disks(self):
        with patch.object(m.Path, 'is_dir', side_effect=AssertionError('unexpected disk access')):
            self.assertTrue(all(root['available'] is None for root in m.roots(check_available=False)))

    def test_directory_status_checks_only_requested_rows_and_caps_the_batch(self):
        with m.connection() as db:
            db.execute('DELETE FROM roots')
            db.executemany('INSERT INTO roots(id,path,added_at) VALUES(?,?,0)',
                           [(index, f'D:/offline/{index}') for index in range(1, 101)])
        with patch.object(m.Path, 'is_dir', return_value=False) as check:
            result = m.root_status('1,2,2')
        self.assertEqual([root['id'] for root in result], [1,2])
        self.assertEqual(check.call_count, 2)
        with self.assertRaises(HTTPException): m.root_status(','.join(str(index) for index in range(101)))

class ScanCheckpointTests(unittest.TestCase):
    def test_interrupted_scan_checkpoint_survives_restart_and_clears_on_completion(self):
        events = []
        manager = ScanManager(lambda root_id, state: events.append((root_id, state)))
        manager.start(7, lambda _manager: None)
        manager.thread.join(5)
        self.assertEqual(events, [(7, 'active'), (7, 'finished')])

        m.persist_scan_checkpoint(None, 'active')
        with m.connection() as db:
            checkpoint = db.execute('SELECT root_id FROM scan_checkpoint WHERE id=1').fetchone()
        self.assertIsNone(checkpoint['root_id'])
        restored = ScanManager(m.persist_scan_checkpoint)
        restored.restore_interrupted(checkpoint['root_id'])
        self.assertEqual(restored.snapshot()['state'], 'interrupted')
        restored.start(None, lambda _manager: None)
        restored.thread.join(5)
        with m.connection() as db:
            self.assertIsNone(db.execute('SELECT id FROM scan_checkpoint WHERE id=1').fetchone())

    def test_shutdown_pause_preserves_checkpoint_for_resume(self):
        events = []
        manager = ScanManager(lambda root_id, state: events.append((root_id, state)))
        entered = threading.Event()
        release = threading.Event()
        def wait_for_cancel(_manager):
            entered.set()
            release.wait(3)
        manager.start(3, wait_for_cancel)
        self.assertTrue(entered.wait(2))
        manager.pause_for_shutdown()
        release.set()
        manager.thread.join(5)
        self.assertEqual(manager.snapshot()['state'], 'interrupted')
        self.assertEqual(events, [(3, 'active'), (3, 'interrupted')])
