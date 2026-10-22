"""Search fast paths preserve literal filters, stable order and one read snapshot."""
from contextlib import contextmanager
import json
import unittest
from unittest.mock import patch
import test_correctness as fixture
from app import main as m,media_order


class SearchQueryTests(unittest.TestCase):
    def setUp(self):
        fixture.CorrectnessTests.setUp(self)
        with m.connection() as db:
            db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)',(str(self.folder),))
            db.executemany('''INSERT INTO media(id,path,root_id,name,title,kind,ext,size,duration,width,height,
                progress,watched,last_played,created_at,updated_at,tags,favorite,missing,modified)
                VALUES(?,?,1,?,?,?,'.mp4',?,120,1920,1080,?,?,?,?,0,?,?,?,?)''',[
                (i,str(self.folder/f'video-{i}.mp4'),f'clip-{i}.mp4',f'公共 视频 {i}',
                'movie' if i%2 else 'episode',i*1024,i%60,int(i%3==0),i*.5,i,
                json.dumps(['tag-%_\\','离线'],ensure_ascii=False),int(i%5==0),int(i%11==0),i)
                for i in range(10,210)])
            db.execute("UPDATE media SET title='Only %_\\ ASCII 中文',name='Unique-Case.mp4',root_id=1,favorite=1,progress=10,width=1920,height=1080 WHERE id=1")

    @contextmanager
    def traced(self):
        original=m.read_connection;statements=[]
        @contextmanager
        def reading():
            with original() as db:
                db.set_trace_callback(statements.append);yield db
        with patch.object(m,'read_connection',reading):yield statements

    def test_zero_matches_does_not_run_a_second_text_scan(self):
        with self.traced() as statements:result=m.media(q='does-not-exist',page=999,page_size=24)
        self.assertEqual((result['total'],result['pages'],result['page'],result['items']),(0,1,1,[]))
        media=[s for s in statements if 'FROM media' in s]
        self.assertEqual(len(media),1);self.assertIn('SELECT id',media[0])

    def test_single_match_uses_primary_key_without_repeating_like(self):
        with self.traced() as statements:result=m.media(q='Unique-case',page=999,page_size=24)
        self.assertEqual((result['total'],result['page'],result['pages']),(1,1,1))
        self.assertEqual([r['id'] for r in result['items']],[1])
        media=[s for s in statements if 'FROM media' in s]
        self.assertEqual(len(media),2);self.assertNotIn('LIKE',media[-1]);self.assertIn('WHERE id=1',media[-1])

    def seed_matches(self,count):
        with m.connection() as db:
            db.execute("DELETE FROM media WHERE title IN ('BoundedCase','Changed after probe')")
            db.executemany('''INSERT INTO media(id,path,root_id,name,title,ext,size,duration,width,height,
                created_at,updated_at,missing) VALUES(?,?,1,?,'BoundedCase','.mp4',?,120,1920,1080,?,0,?)''',[
                (500+i*3,str(self.folder/f'bounded-{i}.mp4'),f'bounded-{i%27:02}-{i}.mp4',i*1024,i/3,int(i>=count))
                for i in range(count+2)])

    def test_multiple_matches_use_one_text_scan_and_primary_key_page(self):
        with self.traced() as statements:result=m.media(q='公共',page=2,page_size=24)
        self.assertGreater(result['total'],48)
        media=[s for s in statements if 'FROM media' in s]
        self.assertEqual(len(media),2);self.assertEqual(sum('LIKE' in s for s in media),1)
        self.assertIn('ORDER BY id ASC LIMIT 1024',media[0]);self.assertIn('WHERE id IN (',media[-1])

    def test_cap_boundaries_preserve_exact_total_and_all_sort_pages(self):
        cap=m.media_search.MATCH_ID_LIMIT
        for count in [cap-1,cap,cap+1]:
            self.seed_matches(count)
            for order in media_order.ORDERS:
                with self.subTest(count=count,order=order):
                    expected=m.media(q='BoundedCase',sort=order,page=None,limit=2000)
                    self.assertEqual(len(expected),count)
                    for page in [1,2,999]:
                        result=m.media(q='BoundedCase',sort=order,page=page,page_size=24)
                        bounded=min(page,(count+23)//24);offset=(bounded-1)*24
                        self.assertEqual(result['total'],count);self.assertEqual(result['page'],bounded)
                        self.assertEqual(result['items'],expected[offset:offset+24])

    def test_continuation_is_ordered_even_with_reverse_unordered_selects_and_sparse_ids(self):
        self.seed_matches(m.media_search.MATCH_ID_LIMIT+5)
        with m.connection() as db:
            db.execute('UPDATE media SET id=-5000 WHERE id=500')
        expected=m.media(q='BoundedCase',sort='name_desc',page=None,limit=2000)
        original=m.read_connection;statements=[]
        @contextmanager
        def reading():
            with original() as db:
                db.execute('PRAGMA reverse_unordered_selects=ON');db.set_trace_callback(statements.append);yield db
        with patch.object(m,'read_connection',reading):result=m.media(q='BoundedCase',sort='name_desc',page=2,page_size=24)
        self.assertEqual(result['total'],len(expected));self.assertEqual(result['items'],expected[24:48])
        self.assertTrue(any('COUNT(*)' in s and 'AND id>' in s for s in statements))
        self.assertIn('ORDER BY id ASC LIMIT 1024',next(s for s in statements if s.startswith('SELECT id')))

    def test_probe_tail_count_and_page_keep_one_snapshot_during_concurrent_write(self):
        original=m.read_connection;changed=[]
        class Proxy:
            def __init__(self,db):self.db=db
            def execute(self,sql,args=()):
                result=self.db.execute(sql,args)
                if sql.startswith('SELECT id FROM media NOT INDEXED') and not changed:
                    with m.connection() as writer:
                        writer.execute("UPDATE media SET title='Changed after probe',missing=1 WHERE id>=500")
                    changed.append(True)
                return result
        @contextmanager
        def reading():
            with original() as db:yield Proxy(db)
        for count in [32,m.media_search.MATCH_ID_LIMIT+5]:
            with self.subTest(count=count):
                changed.clear();self.seed_matches(count)
                expected=m.media(q='BoundedCase',page=None,limit=2000)
                with patch.object(m,'read_connection',reading):result=m.media(q='BoundedCase',page=1,page_size=24)
                self.assertEqual(changed,[True]);self.assertEqual(result['total'],len(expected))
                self.assertEqual(result['items'],expected[:24])
                self.assertEqual(m.media(q='BoundedCase',page=1,page_size=24)['total'],0)

    def test_filtered_search_does_not_replace_selective_indexes_with_global_probe(self):
        for filters in [{'root_id':1},{'view':'movies'},{'favorite':True},{'resolution':'FHD'}]:
            with self.subTest(filters=filters),patch.object(m.media_search,'count_and_ids') as probe:
                m.media(q='公共',page=1,page_size=24,**filters);probe.assert_not_called()

    def test_all_orders_and_literal_queries_match_legacy_results(self):
        for order in media_order.ORDERS:
            for query in ['公共','%_\\','中文','clip-','not-found','公共 视频 101']:
                with self.subTest(order=order,query=query):
                    expected=m.media(q=query,sort=order,page=None,limit=1000)
                    total=len(expected)
                    for page in [1,2,999]:
                        result=m.media(q=query,sort=order,page=page,page_size=24)
                        bounded=min(page,max(1,(total+23)//24));offset=(bounded-1)*24
                        self.assertEqual(result['total'],total);self.assertEqual(result['page'],bounded)
                        self.assertEqual(result['items'],expected[offset:offset+24])

    def test_filter_combinations_do_not_leak_a_single_record(self):
        for options in [{'favorite':True},{'root_id':1},{'view':'movies'},{'view':'series'},
            {'view':'continue'},{'view':'history'},{'watch_status':'watched'},
            {'watch_status':'unwatched'},{'format_ext':'.mkv'},{'format_ext':'mp4'},
            {'resolution':'4K'},{'resolution':'FHD'},{'duration_band':'short'},
            {'root_id':1,'recursive':False},{'root_id':1,'folder':'missing'}]:
            with self.subTest(options=options):
                expected=m.media(q='Unique-Case',page=None,limit=1000,**options)
                result=m.media(q='Unique-Case',page=99,page_size=24,**options)
                self.assertEqual(result['total'],len(expected));self.assertEqual(result['items'],expected)

    def test_count_and_primary_key_lookup_use_the_same_wal_snapshot(self):
        original=m.read_connection;changed=[]
        class Proxy:
            def __init__(self,db):self.db=db
            def execute(self,sql,args=()):
                result=self.db.execute(sql,args)
                if 'COUNT(*)' in sql and not changed:
                    with m.connection() as writer:
                        writer.execute("UPDATE media SET title='Changed after count',name='Changed.mp4',favorite=0 WHERE id=1")
                    changed.append(True)
                return result
        @contextmanager
        def reading():
            with original() as db:yield Proxy(db)
        before=m.media_record(1)
        with patch.object(m,'read_connection',reading):result=m.media(q='Unique-Case',page=1,page_size=24,favorite=True)
        self.assertEqual(changed,[True]);self.assertEqual(result['total'],1)
        self.assertEqual(result['items'][0]['title'],before['title']);self.assertTrue(result['items'][0]['favorite'])
        self.assertEqual(m.media_record(1)['title'],'Changed after count')


if __name__=='__main__':unittest.main()
