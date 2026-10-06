import os
import unittest
from pathlib import Path
from unittest.mock import patch

import test_stability
from app import main as m
from fastapi import HTTPException


class IndexedFolderTests(unittest.TestCase):
    def setUp(self):
        self.root = m.DATA / 'indexed-offline-root'
        with m.connection() as db:
            db.execute('DELETE FROM media')
            db.execute('DELETE FROM roots')
            db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)', (str(self.root),))
        self.add(1, 'root.mp4')
        self.add(2, 'Drama/first.mp4', favorite=1)
        self.add(3, 'Drama/Season 1/second.mkv')
        self.add(4, 'Drama-long/other.mp4')
        self.add(5, '100%_clips/literal.mp4')
        self.add(6, '100XXclips/unrelated.mp4')
        self.add(7, 'Drama/offline/missing.mp4', missing=1)

    def add(self, media_id, path, root_id=1, missing=0, favorite=0, name=None):
        full = self.root.joinpath(*path.split('/'))
        with m.connection() as db:
            db.execute('''INSERT INTO media(id,path,root_id,name,title,ext,duration,created_at,updated_at,missing,favorite)
                VALUES(?,?,?,?,?,?,120,0,0,?,?)''',
                       (media_id, str(full), root_id, name or full.name, full.stem, full.suffix, missing, favorite))

    def folders(self, **kwargs):
        return m.media_folders(1, page=kwargs.pop('page', 1), page_size=kwargs.pop('page_size', 60), **kwargs)

    def media(self, **kwargs):
        return m.media(page=1, page_size=48, **kwargs)

    def test_children_counts_exclude_missing_and_do_not_read_disk(self):
        with patch.object(Path, 'is_dir', side_effect=AssertionError('disk access')), patch.object(Path, 'resolve', side_effect=AssertionError('disk access')):
            result = self.folders()
            drama = self.folders(folder='Drama')
        self.assertEqual(result['direct_count'], 1)
        self.assertEqual(result['video_count'], 6)
        self.assertEqual([(item['name'],item['count']) for item in drama['items']], [('Season 1',1)])
        self.assertEqual(drama['direct_count'], 1)
        self.assertEqual(drama['video_count'], 2)

    def test_recursive_boundary_and_literal_folder_filters_compose(self):
        result = self.media(root_id=1, folder='Drama')
        self.assertEqual({item['id'] for item in result['items']}, {2,3})
        self.assertEqual([item['id'] for item in self.media(root_id=1, folder='Drama', recursive=False)['items']], [2])
        self.assertEqual([item['id'] for item in self.media(root_id=1, recursive=False)['items']], [1])
        self.assertEqual(self.media(root_id=1, folder='Drama', favorite=True)['total'], 1)
        self.assertEqual([item['id'] for item in self.media(root_id=1, folder='100%_clips')['items']], [5])
        self.assertEqual([item['name'] for item in self.folders(q='%_')['items']], ['100%_clips'])
        self.assertEqual(self.folders(folder='100%_clips')['video_count'], 1)

    def test_invalid_relative_folder_and_unscoped_filter_are_rejected(self):
        for folder in ['../Drama', 'Drama/../x', '/Drama', 'D:/Videos', 'Drama//x', 'Drama/.', 'Drama\x00x']:
            with self.subTest(folder=folder), self.assertRaises(HTTPException) as error:
                self.folders(folder=folder)
            self.assertEqual(error.exception.status_code, 400)
        with self.assertRaises(HTTPException): m.media(folder='Drama', page=1)
        with self.assertRaises(HTTPException): m.media(recursive=False, page=1)
        with self.assertRaises(HTTPException) as error:
            m.media_folders(999, page=1, page_size=60)
        self.assertEqual(error.exception.status_code, 404)

    def test_ten_thousand_children_are_paginated_and_searchable(self):
        with m.connection() as db:
            db.executemany('''INSERT INTO media(id,path,root_id,name,title,created_at,updated_at)
                VALUES(?,?,1,'video.mp4','video',0,0)''',
                [(100+index, str(self.root / f'folder-{index:05}' / 'video.mp4')) for index in range(10000)])
        result = self.folders(page_size=60)
        self.assertEqual(len(result['items']), 60)
        self.assertEqual(result['total'], 10004)
        self.assertEqual(result['pages'], 167)
        self.assertEqual(self.folders(q='folder-09999')['items'][0]['count'], 1)
        self.assertEqual(self.folders(page=999)['page'], 167)
        indexed = self.media(root_id=1, folder='folder-09999')['items'][0]
        self.assertEqual(indexed['ext'], '.mp4')

    def test_same_folder_queue_is_bounded_and_has_stable_neighbors(self):
        for index in range(105):
            self.add(100+index, f'Drama/clip-{index:03}.mp4')
        self.add(300, 'Drama/different-root.mp4', root_id=2)
        self.add(301, 'Drama/clip-009.MP4', name='clip-009.MP4')
        result = m.media_siblings(150, page=None, page_size=40)
        self.assertEqual(result['total'], 107)
        self.assertEqual(result['page'], 2)
        self.assertEqual(len(result['items']), 40)
        self.assertEqual(result['previous']['id'], 149)
        self.assertEqual(result['next']['id'], 151)
        duplicate = m.media_siblings(109, page=None, page_size=40)
        self.assertEqual(duplicate['next']['id'], 301)
        self.assertFalse(any(item['id'] in (3,7,300) for item in result['items']))
        with self.assertRaises(HTTPException): m.media_siblings(7, page=None, page_size=40)
