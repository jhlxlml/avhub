import asyncio
import hashlib
import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request
import test_stability  # Isolate app import before touching its database.
from app import main as m, covers, series_library
from app.library_metadata import BulkInput, MetadataInput


def request(payload):
    async def receive():return {'type':'http.request','body':payload,'more_body':False}
    return Request({'type':'http','method':'PUT','path':'/'},receive)


class ScaleTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory(prefix='avhub-scale-');self.addCleanup(temporary.cleanup)
        self.folder=Path(temporary.name);self.thumbs=self.folder/'thumbnails';self.thumbs.mkdir()
        for key,value in [('DATA',self.folder),('DB',self.folder/'library.db'),('THUMBS',self.thumbs)]:
            context=patch.object(m,key,value);context.start();self.addCleanup(context.stop)
        m.bootstrap()
        self.source=self.folder/'read-only.mp4';self.source.write_bytes(b'original video unchanged')
        self.digest=hashlib.sha256(self.source.read_bytes()).digest()
        with m.connection() as db:
            db.executemany('''INSERT INTO media(id,path,root_id,name,title,kind,season,episode,missing,
                created_at,updated_at,tags) VALUES(?,?,?,?,'同名剧','episode',?,?,?,0,0,'["原标签"]')''',
                [(i,str(self.source if i==1 else self.folder/f'{i}.mp4'),2 if i==5 else 1,f'{i}.mp4',
                  {1:0,2:0,3:1,4:None,5:1}[i],i, int(i==2)) for i in range(1,6)])
        self.addCleanup(self.assert_source_unchanged)

    def assert_source_unchanged(self):self.assertEqual(hashlib.sha256(self.source.read_bytes()).digest(),self.digest)
    def groups(self,**options):return m.grouped_series(page=options.pop('page',1),page_size=options.pop('page_size',24),**options)
    def detail(self,id,**options):return m.series_detail(id,page=options.pop('page',1),page_size=options.pop('page_size',48),**options)
    def batch(self,**values):return m.batch_media(BulkInput(**values))

    def test_root_scoped_groups_stable_across_rename_rescan_and_restart(self):
        result=self.groups();self.assertEqual(result['total'],2)
        first=result['items'][0];self.assertEqual((first['count'],first['available_count'],first['seasons']),(4,3,3))
        m.rename_series(first['id'],m.SeriesTitleInput(title='新剧名'))
        m.edit_media(1,MetadataInput(title='单集独立标题'))
        m.bootstrap()
        self.assertEqual(self.detail(first['id'])['title'],'新剧名')
        self.assertEqual(m.one_media(1)['series_id'],first['id'])
        self.assertEqual(m.next_episode(1)['next']['id'],3)  # Offline special 2 is skipped.
        self.assertEqual(self.groups(q='新剧名')['total'],1)

    def test_seasons_special_unknown_offline_and_pagination(self):
        group=self.groups(root_id=1)['items'][0]['id']
        self.assertEqual([x['id'] for x in self.detail(group,season='0')['items']],[1,2])
        self.assertEqual([x['id'] for x in self.detail(group,season='unknown')['items']],[4])
        self.assertEqual([x['id'] for x in self.detail(group,page=99,page_size=2)['items']],[3,4])
        self.assertEqual(self.detail(group,root_id=2)['total'],0)
        with self.assertRaises(HTTPException):self.detail(group,season='-1')

    def test_batch_explicit_group_merges_across_roots_even_same_title(self):
        self.groups()
        self.batch(media_ids=[1,5],changes={'series_title':'同名剧'},favorite=True)
        one,five=m.one_media(1),m.one_media(5)
        self.assertEqual(one['series_id'],five['series_id'])
        self.assertTrue(one['favorite']);self.assertFalse(m.one_media(3)['favorite'])
        m.bootstrap();self.assertEqual(m.one_media(5)['series_id'],one['series_id'])
        m.rename_series(one['series_id'],m.SeriesTitleInput(title='修改后的剧名'))
        self.batch(media_ids=[3],changes={'series_title':'修改后的剧名'})
        self.assertEqual(m.one_media(3)['series_id'],one['series_id'])

    def test_atomic_batch_missing_index_and_tag_overflow_roll_back(self):
        with self.assertRaises(HTTPException):self.batch(media_ids=[1,9000],favorite=True)
        self.assertFalse(m.one_media(1)['favorite'])
        with m.connection() as db:db.execute('UPDATE media SET tags=? WHERE id=3',(json.dumps([str(i) for i in range(30)]),))
        with self.assertRaises(HTTPException):self.batch(media_ids=[1,3],favorite=True,add_tags=['新标签'])
        self.assertEqual(m.one_media(1)['tags'],['原标签']);self.assertFalse(m.one_media(1)['favorite'])

    def test_batch_deduplicates_preserves_tags_and_manual_watch_without_progress(self):
        self.assertEqual(self.batch(media_ids=[1,1,2],add_tags=[' 新标签 ','新标签'],remove_tags=['原标签'],watched=True)['updated'],2)
        m.bootstrap()
        self.assertEqual(m.one_media(1)['tags'],['新标签'])
        self.assertEqual(m.one_media(1)['progress'],0);self.assertEqual(m.one_media(1)['manual_watched'],1)
        self.assertEqual(m.one_media(2)['manual_watched'],1)  # Offline sources can be organized.

    def test_bounds_and_empty_actions_are_rejected(self):
        for values in [{'media_ids':[]},{'media_ids':list(range(1,502))},{'media_ids':[1],'changes':{'kind':'unknown'}},
                       {'media_ids':[1],'changes':{'season':-1}},{'media_ids':[1],'changes':{'title':' '}}]:
            with self.assertRaises(ValidationError):BulkInput(**values)
        with self.assertRaises(HTTPException):self.batch(media_ids=[1])
        with self.assertRaises(HTTPException):self.batch(media_ids=[0],favorite=True)

    def test_invalid_group_assignment_rolls_back_kind_and_title(self):
        with self.assertRaises(HTTPException):self.batch(media_ids=[1,3],changes={'title':'changed','series_id':9999})
        self.assertEqual(m.one_media(1)['title'],'同名剧')
        m.edit_media(1,MetadataInput(kind='video'))
        self.assertIsNone(m.one_media(1)['series_id'])

    def image(self):
        path=self.folder/'local-cover.png'
        subprocess.run([m.executable('ffmpeg'),'-v','error','-f','lavfi','-i','color=c=coral:s=160x90',
                        '-frames:v','1',str(path)],check=True)
        return path.read_bytes()

    def test_real_png_cover_import_reset_and_pinned_response(self):
        payload=self.image()
        value=asyncio.run(m.upload_cover(1,request(payload)))
        path=covers.owned_path(m.DATA,value['custom_cover']);self.assertTrue(m.valid_thumbnail(path))
        self.assertEqual(value['title'],'同名剧');self.assertEqual(self.groups(root_id=1)['items'][0]['thumbnail_url'].split('?')[0],'/thumbs/1')
        response=m.get_thumb(1)
        self.assertIsNotNone(m.reset_cover(1));self.assertIsNone(m.one_media(1)['custom_cover'])
        async def read():
            chunks=[]
            async for chunk in response.body_iterator:chunks.append(chunk)
            await response.background()
            return b''.join(chunks)
        self.assertTrue(asyncio.run(read()).startswith(b'\xff\xd8'))
        self.assertEqual((self.folder/'local-cover.png').read_bytes(),payload)
        self.assertFalse(any(p.name.startswith('.upload-') or 'pending' in p.name for p in (m.DATA/'covers').iterdir()))

    def test_cover_rejects_html_svg_oversize_and_bad_image(self):
        for payload,code in [(b'<svg/>',422),(b'<!doctype html>',422),(b'\xff\xd8\xffbroken',422),(b'x'*(covers.MAX_BYTES+1),413)]:
            with self.assertRaises(HTTPException) as error:asyncio.run(m.upload_cover(1,request(payload)))
            self.assertEqual(error.exception.status_code,code)
        self.assertEqual(list((m.DATA/'covers').iterdir()),[])

    def test_cover_references_never_escape_owned_cache(self):
        for relative in ['../video.mp4','covers/../../read-only.mp4','covers/anything.jpg',str(self.source)]:
            self.assertIsNone(covers.owned_path(m.DATA,relative))
        self.assertIsNotNone(covers.owned_path(m.DATA,'covers/'+'a'*32+'.jpg'))

    def test_cover_backup_same_library_preserves_and_foreign_source_clears(self):
        value=asyncio.run(m.upload_cover(1,request(self.image())))
        with m.connection() as db:
            target=sqlite3.connect(self.folder/'backup.db');db.backup(target);target.close()
        payload=(self.folder/'backup.db').read_bytes()
        asyncio.run(m.restore_backup(request(payload)))
        self.assertEqual(m.one_media(1)['custom_cover'],value['custom_cover'])
        db=sqlite3.connect(self.folder/'backup.db')
        try:
            db.execute("UPDATE media SET path='foreign.mp4' WHERE id=1");db.commit();db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        finally:db.close()
        asyncio.run(m.restore_backup(request((self.folder/'backup.db').read_bytes())))
        self.assertIsNone(m.one_media(1)['custom_cover'])

    def test_extreme_image_dimensions_are_rejected_before_conversion(self):
        with patch.object(m,'scan_process',return_value=(0,json.dumps({'streams':[{'codec_type':'video','codec_name':'png','width':100000,'height':100000}]}),'') ) as runner:
            with self.assertRaises(HTTPException):asyncio.run(m.upload_cover(1,request(b'\x89PNG\r\n\x1a\n')))
            self.assertEqual(runner.call_count,1)

    def test_legacy_schema_migration_is_idempotent(self):
        legacy=sqlite3.connect(':memory:');legacy.row_factory=sqlite3.Row
        legacy.execute('''CREATE TABLE media(id INTEGER PRIMARY KEY,root_id INTEGER,title TEXT,name TEXT,kind TEXT,
            missing INTEGER,season INTEGER,episode INTEGER)''')
        legacy.execute("INSERT INTO media VALUES(1,1,'老剧','old.mp4','episode',0,1,1)")
        series_library.install(legacy);first=legacy.execute('SELECT series_id FROM media').fetchone()[0]
        series_library.install(legacy);self.assertEqual(legacy.execute('SELECT series_id FROM media').fetchone()[0],first)
        legacy.close()

    def test_recent_sort_uses_index_without_temporary_sort(self):
        with m.connection() as db:
            for where in ['missing=0','missing=0 AND favorite=1',"missing=0 AND kind='episode'"]:
                plan=[row[3] for row in db.execute('EXPLAIN QUERY PLAN SELECT * FROM media WHERE '+where+
                    ' ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48')]
                self.assertFalse(any('TEMP B-TREE' in part for part in plan),plan)

    def test_custom_cover_survives_source_index_refresh(self):
        value=asyncio.run(m.upload_cover(1,request(self.image())))
        metadata={'video_codec':'h264','duration':120,'width':320,'height':180,'audio_tracks':[],'subtitles':[]}
        with patch.object(m,'probe',return_value=metadata),patch.object(m,'thumbnail',return_value=None):
            m.scan_file(1,self.source)
        self.assertEqual(m.one_media(1)['custom_cover'],value['custom_cover'])
        m.bootstrap();self.assertEqual(m.one_media(1)['custom_cover'],value['custom_cover'])

    def test_search_pagination_preserves_literal_matching_and_sort_on_both_paths(self):
        with m.connection() as db:
            db.executemany('''INSERT INTO media(id,path,name,title,created_at,updated_at,last_played,tags)
                VALUES(?,?,?,'常见剧名',?,0,?,'[]')''',[(i,str(self.folder/f'search-{i}.mp4'),str(i),i,i%3) for i in range(10,210)])
            db.execute("UPDATE media SET title=?,tags=? WHERE id=1",('字面 %_\\',json.dumps(['rare-tag'])))
        for q in ['常见','rare-tag','%_\\','剧']:
            expected=m.media(q=q,page=None,limit=1000)
            actual=[]
            for page in range(1,(len(expected)+23)//24+1):actual.extend(m.media(q=q,page=page,page_size=24)['items'])
            self.assertEqual([x['id'] for x in actual],[x['id'] for x in expected])
        self.assertEqual([x['id'] for x in m.media(q='%_\\',page=1,page_size=24)['items']],[1])


if __name__=='__main__':unittest.main()
