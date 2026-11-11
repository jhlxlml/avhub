import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import test_stability
from app import main as m


@unittest.skipUnless(sys.version_info>=(3,12),'Explicit transaction API requires Python 3.12+; desktop uses 3.13')
class BootstrapAtomicTests(unittest.TestCase):
    def test_older_development_runtime_retains_legacy_install(self):
        with tempfile.TemporaryDirectory(prefix='avhub-legacy-bootstrap-') as directory,patch.object(m,'DB',Path(directory)/'library.db'),patch.object(m.sys,'version_info',(3,11)):
            m.bootstrap()
            with closing(sqlite3.connect(m.DB)) as db:self.assertIsNotNone(db.execute("SELECT name FROM sqlite_schema WHERE name='media'").fetchone())

    def test_failed_fresh_install_leaves_no_partial_schema(self):
        with tempfile.TemporaryDirectory(prefix='avhub-bootstrap-') as directory,patch.object(m,'DB',Path(directory)/'library.db'):
            with patch.object(m.series_library,'install',side_effect=RuntimeError('controlled schema failure')):
                with self.assertRaisesRegex(RuntimeError,'controlled'):m.bootstrap()
            with closing(sqlite3.connect(m.DB)) as db:
                self.assertEqual(db.execute("SELECT name FROM sqlite_schema WHERE type='table'").fetchall(),[])
            m.bootstrap()
            with closing(sqlite3.connect(m.DB)) as db:self.assertIsNotNone(db.execute("SELECT name FROM sqlite_schema WHERE name='media'").fetchone())

    def test_upgrade_failure_rolls_back_ddl_and_personal_metadata(self):
        with tempfile.TemporaryDirectory(prefix='avhub-upgrade-') as directory,patch.object(m,'DB',Path(directory)/'library.db'):
            m.bootstrap()
            with closing(sqlite3.connect(m.DB)) as db:
                db.execute('ALTER TABLE playlists DROP COLUMN revision')
                db.execute("INSERT INTO media(id,path,name,title,kind,favorite,progress,tags,created_at,updated_at) VALUES(1,'owned.mp4','owned','Personal title','movie',1,37,'[\"keep\"]',0,0)")
                db.execute("INSERT INTO playlists(id,name,created_at) VALUES(1,'Keep list',0)")
                db.execute('INSERT INTO playlist_items VALUES(1,1,0)')
                db.commit()
            def fail(db):
                db.execute('ALTER TABLE media ADD COLUMN atomic_failure_marker TEXT')
                db.execute("UPDATE media SET title='must roll back'")
                raise RuntimeError('controlled migration failure')
            with patch.object(m,'install_scan_jobs',side_effect=fail):
                with self.assertRaisesRegex(RuntimeError,'controlled'):m.bootstrap()
            with closing(sqlite3.connect(m.DB)) as db:
                self.assertNotIn('atomic_failure_marker',{r[1] for r in db.execute('PRAGMA table_info(media)')})
                self.assertNotIn('revision',{r[1] for r in db.execute('PRAGMA table_info(playlists)')})
                self.assertEqual(db.execute('SELECT title,favorite,progress,tags FROM media').fetchone(),('Personal title',1,37,'["keep"]'))
            m.bootstrap()
            with closing(sqlite3.connect(m.DB)) as db:
                self.assertIn('revision',{r[1] for r in db.execute('PRAGMA table_info(playlists)')})
                self.assertEqual(db.execute('SELECT title,favorite,progress,tags FROM media').fetchone(),('Personal title',1,37,'["keep"]'))
                self.assertEqual(db.execute('SELECT * FROM playlist_items').fetchall(),[(1,1,0)])

    def test_reopen_is_idempotent_and_preserves_durability(self):
        with tempfile.TemporaryDirectory(prefix='avhub-bootstrap-') as directory,patch.object(m,'DB',Path(directory)/'library.db'):
            m.bootstrap()
            with closing(sqlite3.connect(m.DB)) as db:before=db.execute('SELECT type,name,sql FROM sqlite_schema ORDER BY name').fetchall()
            m.bootstrap()
            with closing(sqlite3.connect(m.DB)) as db:
                self.assertEqual(before,db.execute('SELECT type,name,sql FROM sqlite_schema ORDER BY name').fetchall())
                self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0],'wal')
                self.assertEqual(db.execute('PRAGMA synchronous').fetchone()[0],2)
                self.assertEqual(db.execute('PRAGMA wal_autocheckpoint').fetchone()[0],1000)
