import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from contextlib import closing
from app.data_migration import migrate,configured_directory

class DataMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='avhub-migration-test-');self.root=Path(self.temp.name)
        self.source=self.root/'old';self.source.mkdir();self.target=self.root/'new';self.target.mkdir();self.identity=str(uuid.uuid4())
        self.db=sqlite3.connect(self.source/'library.db')
        self.db.executescript('CREATE TABLE roots(id INTEGER,path TEXT); CREATE TABLE preferences(key TEXT,value TEXT); CREATE TABLE media(id INTEGER,thumbnail TEXT,custom_cover TEXT,progress REAL,favorite INTEGER); CREATE TABLE playlists(id INTEGER,name TEXT);')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute("INSERT INTO preferences VALUES('theme','light')")
        self.db.execute("INSERT INTO roots VALUES(1,'E:/original-videos')")
        self.db.execute("INSERT INTO media VALUES(1,'thumbnails/1.jpg',NULL,45,1)")
        self.db.execute("INSERT INTO playlists VALUES(1,'我的列表')");self.db.commit()
        (self.source/'thumbnails').mkdir();(self.source/'thumbnails/1.jpg').write_bytes(b'test-image')
        (self.source/'hls').mkdir();(self.source/'hls/keep.ts').write_bytes(b'generated-cache')
        (self.source/'screenshots').mkdir();(self.source/'screenshots/keep.png').write_bytes(b'screenshot')
        (self.source/'avhub-directory-choices.json').write_text(json.dumps({'version':1,'folders':{'media':str(self.root)}}))
    def tearDown(self):self.db.close();self.temp.cleanup()
    def test_copy_reads_live_wal_preserves_preferences_progress_and_old_files(self):
        migrate(self.source,self.target,self.identity)
        with closing(sqlite3.connect(self.target/'library.db')) as db:
            self.assertEqual(db.execute('SELECT progress,favorite FROM media').fetchone(),(45,1))
            self.assertEqual(db.execute('SELECT value FROM preferences').fetchone()[0],'light')
            self.assertEqual(db.execute('SELECT name FROM playlists').fetchone()[0],'我的列表')
        self.assertTrue((self.source/'library.db').exists());self.assertEqual((self.target/'thumbnails/1.jpg').read_bytes(),b'test-image')
        self.assertFalse((self.target/'hls').exists());self.assertFalse((self.target/'screenshots').exists())
        self.assertEqual(json.loads((self.target/'avhub-directory-choices.json').read_text())['folders']['media'],str(self.root))
        migrate(self.source,self.target,self.identity)  # completed task is idempotent
    def test_never_overwrites_an_existing_library(self):
        (self.target/'library.db').write_bytes(b'important')
        with self.assertRaises(ValueError):migrate(self.source,self.target,self.identity)
        self.assertEqual((self.target/'library.db').read_bytes(),b'important')
    def test_missing_manual_cover_aborts_without_publishing_database(self):
        self.db.execute('UPDATE media SET custom_cover=?',('covers/'+'a'*32+'.jpg',));self.db.commit()
        with self.assertRaises(ValueError):migrate(self.source,self.target,self.identity)
        self.assertFalse((self.target/'library.db').exists());self.assertTrue((self.source/'library.db').exists())
    def test_insufficient_space_does_not_publish_or_delete_source(self):
        with patch('app.data_migration.shutil.disk_usage',return_value=type('Space',(),{'free':1})()):
            with self.assertRaises(ValueError):migrate(self.source,self.target,self.identity)
        self.assertFalse((self.target/'library.db').exists());self.assertTrue((self.source/'library.db').exists())
    def test_new_default_and_legacy_upgrade(self):
        home=self.root/'app';home.mkdir()
        self.assertEqual(configured_directory(home,home/'data'),home/'AVHub-data')
        location=configured_directory(self.root,self.source)
        self.assertEqual(location,self.root/'AVHub-data');self.assertTrue((location/'library.db').exists())
        self.assertNotIn('pending',json.loads((self.root/'avhub-data-location.json').read_text()))
    def test_parent_child_and_foreign_marker_are_rejected(self):
        with self.assertRaises(ValueError):migrate(self.source,self.root,self.identity)
        (self.target/'.avhub-data-migration.json').write_text('{}')
        with self.assertRaises(ValueError):migrate(self.source,self.target,self.identity)
    def test_interrupted_publication_resumes_only_owned_images(self):
        original=Path.rename
        def interrupted(file,target):
            if file.name=='library.db':raise OSError('simulated shutdown')
            return original(file,target)
        with patch.object(Path,'rename',interrupted):
            with self.assertRaises(OSError):migrate(self.source,self.target,self.identity)
        self.assertFalse((self.target/'library.db').exists())
        migrate(self.source,self.target,self.identity)
        self.assertTrue((self.target/'library.db').exists())
