"""Complete/partial scans of owned fixtures, never user media."""
import unittest
from unittest.mock import patch

import test_scan_jobs as fixture
from app import main as m
from app.scan_jobs import ThumbnailService
from app import storage_management


class ExternalRemovalTests(unittest.TestCase):
    setUp=fixture.ScanJobsTests.setUp
    seed=fixture.ScanJobsTests.seed

    def scan(self,walk=None):
        service=ThumbnailService(m.connection,m.process_thumbnail,m.read_connection)
        self.addCleanup(service.close)
        with patch.object(m,'thumbnail_service',service):
            if walk:
                with patch.object(m.os,'walk',side_effect=walk):
                    self.manager.start(1,lambda manager:m.run_scan([{'id':1,'path':str(self.source)}],manager))
                    self.manager.thread.join(10)
            else:
                self.manager.start(1,lambda manager:m.run_scan([{'id':1,'path':str(self.source)}],manager))
                self.manager.thread.join(10)
        self.assertFalse(self.manager.busy())
        return self.manager.snapshot()

    def test_external_removal_and_restore_preserve_metadata_and_referenced_cover(self):
        self.seed(2)
        cover=self.thumbs/'1.jpg';cover.write_bytes(b'owned derived cover')
        manual=self.folder/'covers'/('a'*32+'.jpg');manual.parent.mkdir();manual.write_bytes(b'owned manual artwork')
        with m.connection() as db:
            db.execute("UPDATE media SET thumbnail='1.jpg',custom_cover=?,title='personal',favorite=1,progress=37 WHERE id=1",(f'covers/{manual.name}',))
            db.execute('DELETE FROM thumbnail_jobs WHERE media_id=1')
            db.execute("INSERT INTO playlists(id,name,created_at) VALUES(1,'personal list',0)")
            db.execute('INSERT INTO playlist_items VALUES(1,1,0)')
        source=self.source/'1.mp4';parked=self.folder/'parked.mp4';source.rename(parked)
        self.assertEqual(self.scan()['state'],'completed')
        with m.read_connection() as db:
            row=dict(db.execute('SELECT * FROM media WHERE id=1').fetchone())
            self.assertEqual(row['missing'],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM media WHERE missing=0').fetchone()[0],1)
        detail=m.playlist_detail(1,1,40)
        self.assertEqual(detail['playable_count'],0)
        self.assertEqual(detail['items'][0]['missing'],1)
        preview=storage_management.plan(self.folder,m.DB)
        self.assertNotIn('thumbnails/1.jpg',[name for name,*_ in preview['_files']])
        self.assertNotIn(f'covers/{manual.name}',[name for name,*_ in preview['_files']])
        self.assertEqual(cover.read_bytes(),b'owned derived cover')
        self.assertEqual(manual.read_bytes(),b'owned manual artwork')
        parked.rename(source)
        self.assertEqual(self.scan()['state'],'completed')
        with m.read_connection() as db:
            after=dict(db.execute('SELECT * FROM media WHERE id=1').fetchone())
            self.assertEqual(db.execute('SELECT COUNT(*) FROM media').fetchone()[0],2)
        self.assertEqual(after['missing'],0)
        self.assertEqual((after['title'],after['favorite'],after['progress']),('personal',1,37))
        self.assertEqual(after['custom_cover'],f'covers/{manual.name}')
        self.assertEqual(m.playlist_detail(1,1,40)['playable_count'],1)
        self.assertEqual(source.read_bytes(),b'never modified')

    def test_offline_root_does_not_mark_files_missing(self):
        self.seed(2);parked=self.folder/'offline';self.source.rename(parked)
        state=self.scan()
        self.assertGreater(state['error_count'],0)
        with m.read_connection() as db:
            self.assertEqual(db.execute('SELECT SUM(missing) FROM media').fetchone()[0],0)
        parked.rename(self.source)

    def test_partial_walk_does_not_invalidate_unseen_files(self):
        self.seed(2)
        def walk(root,onerror):
            onerror(PermissionError(13,'owned permission failure',str(root/'locked')))
            yield str(root),[],['1.mp4']
        state=self.scan(walk)
        self.assertGreater(state['error_count'],0)
        with m.read_connection() as db:
            self.assertEqual(db.execute('SELECT SUM(missing) FROM media').fetchone()[0],0)

    def test_cancelled_walk_does_not_invalidate_unseen_files(self):
        self.seed(2)
        def walk(root,onerror):
            self.manager.cancelled.set()
            yield str(root),[],[]
        self.assertEqual(self.scan(walk)['state'],'cancelled')
        with m.read_connection() as db:
            self.assertEqual(db.execute('SELECT SUM(missing) FROM media').fetchone()[0],0)
