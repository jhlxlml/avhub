import json
import sqlite3
import unittest
from pathlib import Path
from unittest.mock import patch
from starlette.requests import Request
from fastapi import HTTPException
import test_stability
from app import main as m,media_order

class LibraryEnhancementTests(unittest.TestCase):
    def setUp(self):
        with m.connection() as db:
            db.execute('DELETE FROM preferences');db.execute('DELETE FROM media')
            for i,width,height,size in [(1,1920,1080,1024),(2,3840,2160,4096),(3,1280,720,512),(4,None,None,None),(5,0,720,0),(6,1920,1080,1024),(7,-1,1080,-1)]:
                db.execute('INSERT INTO media(id,path,name,title,width,height,size,ext,kind,root_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,0,0)',
                    (i,f'fixture-{i}.mp4',f'fixture-{i}',f'视频 {i}',width,height,size,'.mp4','movie'))
    def ids(self,sort,page=1,page_size=120,**kwargs):
        return [row['id'] for row in m.media(sort=sort,page=page,page_size=page_size,**kwargs)['items']]
    def test_sorting_known_values_before_unknown_with_stable_ties(self):
        for sort in ['resolution_desc','size_desc']:self.assertEqual(self.ids(sort),[2,1,6,3,4,5,7])
        for sort in ['resolution_asc','size_asc']:self.assertEqual(self.ids(sort),[3,1,6,2,4,5,7])
    def test_new_sorts_keep_page_and_filter_semantics(self):
        self.assertEqual(self.ids('size_desc',page_size=2),[2,1]);self.assertEqual(self.ids('size_desc',page=2,page_size=2),[6,3])
        self.assertEqual(self.ids('resolution_desc',q='视频 6'),[6])
        with m.connection() as db:db.execute('UPDATE media SET missing=1 WHERE id=2')
        self.assertEqual(self.ids('resolution_desc')[:2],[1,6])
    def test_unfiltered_sort_orders_use_expression_indexes_without_temp_sort(self):
        with m.connection() as db:
            for key in ('resolution_asc','resolution_desc','size_asc','size_desc'):
                detail=' '.join(str(row[3]) for row in db.execute('EXPLAIN QUERY PLAN SELECT * FROM media WHERE missing=0 ORDER BY '+media_order.ORDERS[key]+' LIMIT 48'))
                self.assertIn(f'media_{key}_order',detail);self.assertNotIn('TEMP B-TREE',detail)
    def test_resume_behavior_is_validated_and_persisted(self):
        self.assertNotIn('resumeBehavior',m.get_preferences()['values'])
        for value in (None,True,1,{},'invalid'):
            with self.assertRaises(HTTPException):m.set_preferences(m.PreferencesInput(values={'resumeBehavior':value}))
        for value in ('ask','resume','restart'):
            m.set_preferences(m.PreferencesInput(values={'resumeBehavior':value}))
            self.assertEqual(m.get_preferences()['values']['resumeBehavior'],value)
            with m.read_connection() as db:self.assertEqual(json.loads(db.execute("SELECT value FROM preferences WHERE key='resumeBehavior'").fetchone()[0]),value)
    def test_exact_old_generated_sort_index_is_repaired_without_touching_media(self):
        with m.connection() as db:
            db.execute('DROP INDEX media_size_asc_order')
            db.execute('CREATE INDEX media_size_asc_order ON media('+media_order.ORDERS['size_asc']+') WHERE missing=0')
            before=db.execute('SELECT COUNT(*) FROM media').fetchone()[0];media_order.install(db)
            sql=db.execute("SELECT sql FROM sqlite_master WHERE name='media_size_asc_order'").fetchone()[0]
            self.assertIn('media(missing,',sql);self.assertEqual(db.execute('SELECT COUNT(*) FROM media').fetchone()[0],before)
    def test_app_info_reports_existing_directory_without_mutation(self):
        previous=m.DATA
        with patch.object(Path,'mkdir',side_effect=AssertionError('must not select/write a directory')):
            info=m.app_info()
        self.assertEqual(info['data_directory'],str(previous));self.assertEqual(m.DATA,previous)
        self.assertEqual(info['build_id'],m.BUILD['build_id'])
    def test_data_folder_open_never_accepts_a_renderer_path_and_requires_local_origin(self):
        def request(origin):return Request({'type':'http','method':'POST','scheme':'http','path':'/api/app-data/reveal','server':('127.0.0.1',8765),
            'headers':[(b'host',b'127.0.0.1:8765')]+([(b'origin',origin.encode())] if origin else [])})
        with patch.object(m,'SERVER_PORT',8765),patch.object(m,'SESSION_TOKEN',''),patch.object(m.sys,'platform','win32'),patch.object(m.os,'startfile',create=True) as opened:
            for origin in (None,'https://evil.example'):
                with self.assertRaises(HTTPException):m.reveal_app_data(request(origin))
            opened.assert_not_called();m.reveal_app_data(request('http://127.0.0.1:8765'))
            opened.assert_called_once_with(str(m.DATA.resolve()))
