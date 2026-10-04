import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException
import test_stability  # Initializes the isolated test data directory.
from app import main as m


class AutoplayTests(unittest.TestCase):
    def setUp(self):
        with m.connection() as db:
            db.execute('DELETE FROM playlist_items')
            db.execute('DELETE FROM playlists')
            db.execute('DELETE FROM media')
            db.execute('DELETE FROM series_groups')
            db.execute('DELETE FROM preferences')
            # Names intentionally disagree with episode ordering; seasons may
            # reside in different folders and roots in a manually merged group.
            db.execute("INSERT INTO series_groups(id,identity,title,created_at) VALUES(1,'manual-fixture','合并剧集',0)")
            for ident, season, episode, group, root, missing in [
                (1, 0, 1, 1, 1, 0), (2, 1, 1, 1, 1, 1), (3, 1, 2, 1, 1, 0),
                (4, 2, 1, 1, 2, 0), (5, 1, 3, None, 1, 0), (6, 1, 3, None, 2, 0),
                (7, 2, 1, None, 1, 0), (8, 1, 3, None, 1, 0)]:
                db.execute('''INSERT INTO media(id,path,name,title,kind,season,episode,series_id,root_id,missing,created_at,updated_at)
                    VALUES(?,?,?,'同名剧','episode',?,?,?,?,?,0,0)''',
                    (ident,str(Path('fixture') / f'S{season}' / f'{ident}.mp4'),f'{9-ident}.mp4',season,episode,group,root,missing))

    def test_same_series_crosses_seasons_and_skips_missing_and_other_groups(self):
        page = m.media_siblings(3, page=None, page_size=1, scope='series')
        self.assertEqual([page['previous']['id'],page['next']['id']], [1,4])
        self.assertEqual(page['total'],3)
        self.assertEqual(page['name'],'合并剧集')
        self.assertEqual(page['scope'],'series')
        self.assertEqual(page['page'],2)
        self.assertEqual([row['id'] for row in page['items']],[3])
        self.assertEqual(m.next_episode(3,scope='series')['next']['id'],4)
        self.assertIsNone(m.next_episode(4,scope='series')['next'])

    def test_legacy_series_is_root_isolated_and_duplicates_have_stable_neighbors(self):
        page = m.media_siblings(5, page=None, page_size=40, scope='series')
        self.assertEqual({row['id'] for row in page['items']},{5,7,8})
        self.assertEqual(page['previous']['id'],8)
        self.assertEqual(page['next']['id'],7)
        self.assertEqual(m.next_episode(8,scope='series')['next']['id'],5)

    def test_random_series_uses_entire_series_excluding_current_and_missing(self):
        with patch.object(m.random,'randrange',return_value=1):
            result = m.random_next(1,scope='series')
        self.assertEqual(result['candidates'],2)
        self.assertEqual(result['next']['id'],4)
        with m.connection() as db:db.execute('UPDATE media SET missing=1 WHERE id IN (3,4)')
        self.assertIsNone(m.random_next(1,scope='series')['next'])

    def test_playlist_takes_precedence_over_series_scope(self):
        with m.connection() as db:
            db.execute("INSERT INTO playlists VALUES(1,'跨剧片单',0,0)")
            db.executemany('INSERT INTO playlist_items VALUES(1,?,?)',[(1,0),(2,1),(5,2)])
        self.assertEqual(m.random_next(1,playlist_id=1,scope='series')['next']['id'],5)

    def test_non_episode_falls_back_to_exact_directory_not_subfolders(self):
        with m.connection() as db:
            db.execute("UPDATE media SET kind='movie',root_id=1,path=? WHERE id=1",(str(Path('fixture')/'S1'/'one.mp4'),))
        page=m.media_siblings(1,page=None,page_size=40,scope='series')
        self.assertEqual(page['scope'],'directory')
        self.assertEqual(page['requested_scope'],'series')
        self.assertEqual({row['id'] for row in page['items']},{1,3,5,8})

    def test_ten_thousand_episodes_keep_queue_page_bounded_and_random_reaches_last(self):
        with m.connection() as db:
            db.executemany('''INSERT INTO media(id,path,name,title,kind,season,episode,series_id,created_at,updated_at)
                VALUES(?,?,?,'同名剧','episode',3,?,1,0,0)''',
                [(100+i,f'large/{i}.mp4',f'{i:05}.mp4',i+1) for i in range(10000)])
        page=m.media_siblings(5100,page=None,page_size=40,scope='series')
        self.assertEqual(page['total'],10003)
        self.assertEqual(len(page['items']),40)
        self.assertEqual(page['next']['id'],5101)
        with patch.object(m.random,'randrange',return_value=10001):
            self.assertEqual(m.random_next(1,scope='series')['next']['id'],10099)

    def test_preferences_persist_and_reject_invalid_scope_atomically(self):
        for enabled in (False,True):
            for mode in ('sequential','random','repeat-one'):
                for scope in ('series','directory'):
                    values={'autoNext':enabled,'queueMode':mode,'queueScope':scope}
                    m.set_preferences(m.PreferencesInput(values=values))
                    self.assertEqual(m.get_preferences()['values'],values)
        with self.assertRaises(HTTPException):
            m.set_preferences(m.PreferencesInput(values={'autoNext':False,'queueScope':'all'}))
        self.assertEqual(m.get_preferences()['values']['autoNext'],True)


if __name__=='__main__':unittest.main()
