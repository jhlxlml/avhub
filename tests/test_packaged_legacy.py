"""Synthetic fixture safety; actual upgrades are accepted by the packaged EXE."""
import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('owned_legacy_seed',ROOT/'electron/test/seed-legacy-library.py')
legacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)


class PackagedLegacyFixtureTests(unittest.TestCase):
    def test_old_schema_and_metadata_exist_without_current_bootstrap(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(legacy,'ROOT',Path(directory)):
            database=Path(directory)/'build/candidate/AVHub-data/library.db'
            legacy.seed(database,Path(directory)/'build/legacy-empty')
            with closing(sqlite3.connect(database)) as db:
                columns={row[1] for row in db.execute('PRAGMA table_info(media)')}
                self.assertNotIn('progress_updated_at',columns);self.assertNotIn('video_color',columns)
                self.assertNotIn('revision',{row[1] for row in db.execute('PRAGMA table_info(playlists)')})
                self.assertEqual(db.execute('SELECT favorite,progress,rating FROM media WHERE id=1001').fetchone(),(1,42,4))
                self.assertEqual(db.execute('SELECT * FROM playlist_items').fetchone(),(91,1001,0))
            before=database.read_bytes()
            with self.assertRaises(ValueError):legacy.seed(database,Path(directory)/'build/legacy-empty')
            self.assertEqual(database.read_bytes(),before)

    def test_fixture_cannot_write_outside_owned_build_directory(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(legacy,'ROOT',Path(directory)):
            outside=Path(directory)/'not-build/library.db'
            with self.assertRaises(ValueError):legacy.seed(outside,Path(directory)/'build/media')
            with self.assertRaises(ValueError):legacy.seed(Path(directory)/'build/library.db',Path(directory)/'outside-media')
            self.assertFalse(outside.exists());self.assertFalse((Path(directory)/'outside-media').exists())
