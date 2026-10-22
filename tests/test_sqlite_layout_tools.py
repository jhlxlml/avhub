"""The page tools are scoped, read-only inspectors, not library maintenance."""
from contextlib import closing
import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]


def script(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


class SQLiteLayoutToolTests(unittest.TestCase):
    def test_varint_decoder_handles_serial_header_boundaries(self):
        decode=script('probe-sqlite-real-layout').varint
        for data,value in [(b'\0',0),(b'\x7f',127),(b'\x81\0',128),(b'\xff\x7f',16383),(b'\xff'*9,2**64-1)]:
            with self.subTest(value=value):self.assertEqual(decode(data,0),(value,len(data)))

    def test_probe_refuses_unowned_or_existing_destination(self):
        probe=script('probe-sqlite-real-layout')
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-real-') as owned:
            target=Path(owned)/'real-layout.db';target.write_bytes(b'owned existing data')
            with patch.object(sqlite3,'connect') as connect:
                with self.assertRaises(ValueError):probe.worker('host',target)
                with self.assertRaises(ValueError):probe.worker('host',Path(owned)/'different.db')
                connect.assert_not_called()
            self.assertEqual(target.read_bytes(),b'owned existing data')

    def test_inspector_rejects_non_benchmark_paths_before_connecting(self):
        inspector=script('inspect-sqlite-pages')
        with patch.object(sqlite3,'connect') as connect:
            with self.assertRaises(ValueError):inspector.inspect(ROOT/'AVHub-data/library.db')
            connect.assert_not_called()

    def test_page_attribution_reads_owned_snapshot_without_changing_either_database(self):
        inspector=script('inspect-sqlite-pages')
        with tempfile.TemporaryDirectory(prefix='avhub-library-benchmark-') as owned:
            root=Path(owned);source=root/'source.db';snapshot=root/'layout-snapshot.db'
            with closing(sqlite3.connect(source)) as db:
                db.executescript('''CREATE TABLE media(id INTEGER PRIMARY KEY,title TEXT);
                    CREATE INDEX media_title ON media(title);
                    CREATE TABLE roots(id INTEGER);CREATE TABLE series_groups(id INTEGER);
                    CREATE TABLE playlist_items(id INTEGER);INSERT INTO media VALUES(1,'owned');''')
                db.commit()
                with closing(sqlite3.connect(snapshot)) as dst:db.backup(dst)
            digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
            before=[digest(source),digest(snapshot)]
            result=inspector.inspect(snapshot)
            self.assertEqual(result['integrity'],'ok');self.assertEqual(result['counts']['media'],1)
            self.assertIn('media_title',[row['name'] for row in result['objects']])
            self.assertEqual(sum(row['pages'] for row in result['objects']),result['pages']['page_count'])
            self.assertEqual([digest(source),digest(snapshot)],before)


if __name__=='__main__':unittest.main()
