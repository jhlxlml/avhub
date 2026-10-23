"""Isolated read fences, bounded scan lookups and playlist query budgets."""
import asyncio
import sqlite3
import unittest
from unittest.mock import patch

import test_bulk_read_isolation as fixture
from app import main as m
from app.playlist_pages import page_query


class DesktopReadTests(unittest.TestCase):
    setUp=fixture.BulkReadIsolationTests.setUp
    seed=fixture.BulkReadIsolationTests.seed
    held_writer=fixture.BulkReadIsolationTests.held_writer
    worker=fixture.BulkReadIsolationTests.worker

    def test_get_routes_do_not_join_writer_queue(self):
        self.seed()
        (self.thumbs/'1.jpg').write_bytes(b'\xff\xd8test\xff\xd9')
        with m.connection() as db:
            db.execute("UPDATE media SET thumbnail='1.jpg' WHERE id=1")
            db.execute("INSERT INTO playlists(id,name,created_at) VALUES(1,'owned',0)")
            db.execute('INSERT INTO playlist_items VALUES(1,1,0)')
        operations=[lambda:m.get_thumb(1),m.playlists,lambda:m.playlist_detail(1,1,40),
            lambda:m.playlist_queue(1,1,1,40),m.get_preferences,
            lambda:m.get_subtitle_preference(1),lambda:m.grouped_series(page=1,page_size=24)]
        with self.held_writer():
            for operation in operations:
                thread,done,result,errors=self.worker(operation)
                self.assertTrue(done.wait(.5),'GET must not wait for an unrelated writer')
                thread.join(1);self.assertEqual(errors,[])

    def test_custom_cover_get_and_cleanup_do_not_join_writer_queue(self):
        self.seed();cover=self.folder/'covers'/('a'*32+'.jpg');cover.parent.mkdir()
        cover.write_bytes(b'\xff\xd8owned\xff\xd9')
        with m.connection() as db:db.execute('UPDATE media SET custom_cover=? WHERE id=1',(f'covers/{cover.name}',))
        with self.held_writer():
            thread,done,result,errors=self.worker(lambda:m.get_thumb(1))
            self.assertTrue(done.wait(.5));thread.join(1);self.assertEqual(errors,[])
            response=result[0]
            async def read():return b''.join([chunk async for chunk in response.body_iterator])
            self.assertEqual(asyncio.run(read()),b'\xff\xd8owned\xff\xd9')
            asyncio.run(response.background())  # cleanup is idempotent
        self.assertTrue(cover.exists(),'referenced artwork must not be deleted')

    def test_scan_batch_queries_exact_paths_across_old_root_ownership(self):
        self.seed(3)
        with m.connection() as db:db.execute('UPDATE media SET root_id=99 WHERE id=1')
        paths=[str(self.source/'1.mp4'),str(self.source/'not-indexed.mp4')]
        rows=m.scan_index_batch(paths)
        self.assertEqual(list(rows),paths[:1]);self.assertEqual(rows[paths[0]]['root_id'],99)
        self.assertEqual(m.scan_index_batch([]),{})
        with self.assertRaises(ValueError):m.scan_index_batch(['unused']*129)

    def test_scan_batches_ignore_unrelated_library_and_preserve_unchanged_sources(self):
        self.seed(130)
        with m.connection() as db:
            db.executemany('''INSERT INTO media(id,path,root_id,name,title,created_at,updated_at)
                VALUES(?,?,99,'unrelated','unrelated',0,0)''',[(1000+i,f'Z:/owned-offline/{i}.mp4') for i in range(5000)])
        with patch.object(m,'scan_index_batch',wraps=m.scan_index_batch) as lookup,patch.object(m,'probe',side_effect=AssertionError('unchanged files must not re-probe')):
            self.manager.start(1,lambda manager:m.run_scan([{'id':1,'path':str(self.source)}],manager))
            self.manager.thread.join(15)
        self.assertFalse(self.manager.busy());self.assertEqual(self.manager.snapshot()['state'],'completed')
        self.assertEqual(self.manager.snapshot()['error_count'],0)
        self.assertEqual(sum(len(call.args[0]) for call in lookup.call_args_list),130)
        self.assertTrue(all(len(call.args[0])<=128 for call in lookup.call_args_list))
        with m.read_connection() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM media WHERE root_id=99 AND missing=0').fetchone()[0],5000)
        self.assertEqual((self.source/'1.mp4').read_bytes(),b'never modified')


class PlaylistQueryBudgetTests(unittest.TestCase):
    def test_bounded_queries_preserve_search_ordinals_ties_and_offline_neighbors(self):
        db=sqlite3.connect(':memory:');self.addCleanup(db.close);db.row_factory=sqlite3.Row
        db.executescript('''CREATE TABLE playlists(id INTEGER PRIMARY KEY,name TEXT,revision INTEGER);
            CREATE TABLE media(id INTEGER PRIMARY KEY,title TEXT,name TEXT,duration REAL,missing INTEGER);
            CREATE TABLE playlist_items(playlist_id INTEGER,media_id INTEGER,position INTEGER);
            CREATE INDEX playlist_order ON playlist_items(playlist_id,position,media_id);
            INSERT INTO playlists VALUES(1,'owned',1);''')
        db.executemany('INSERT INTO media VALUES(?,?,?,?,?)',[(i,f'clip {i}',f'clip {i}',60,int(i%7==0)) for i in range(1,1001)])
        db.executemany('INSERT INTO playlist_items VALUES(1,?,?)',[(i,i//2) for i in range(1,1001)])
        db.execute('INSERT INTO playlist_items VALUES(1,9999,1)')  # orphan excluded
        for query in ('','clip 999','clip 9','%','_'):
            statements=[];db.set_trace_callback(statements.append)
            result=page_query(db,1,dict,page=1,size=40,q=query,current_id=9)
            db.set_trace_callback(None)
            self.assertLessEqual(len(statements),9)
            for row in result['items']:
                self.assertEqual(row['playlist_index'],row['id']-1)
                self.assertEqual(row['previous_item_id'],row['id']-1 if row['id']>1 else None)
                self.assertEqual(row['next_item_id'],row['id']+1 if row['id']<1000 else None)
            self.assertEqual(result['index'],8)
            self.assertEqual(result['previous']['id'],8)
            self.assertEqual(result['next']['id'],10)
        self.assertEqual(result['total'],0,'LIKE metacharacters remain literal')
