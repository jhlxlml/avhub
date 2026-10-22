import asyncio
from contextlib import closing, asynccontextmanager
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import test_correctness as fixture  # Sets the isolated process profile before main is imported.
from app.db_lifecycle import WalAnchor


class WalAnchorTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory(prefix='avhub-wal-anchor-');self.addCleanup(temporary.cleanup)
        self.folder=Path(temporary.name);self.db=self.folder/'library #测试.db'
        with closing(sqlite3.connect(self.db)) as db:
            db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE progress(id INTEGER PRIMARY KEY,value INTEGER)')
            db.execute('INSERT INTO progress VALUES(1,0)');db.commit()
        self.anchor=WalAnchor();self.addCleanup(self.anchor.close)

    def save(self,value):
        self.anchor.ensure(self.db)
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute('PRAGMA synchronous').fetchone()[0],2)
            db.execute('UPDATE progress SET value=? WHERE id=1',(value,));db.commit()

    def value(self):
        with closing(sqlite3.connect(self.db)) as db:return db.execute('SELECT value FROM progress').fetchone()[0]

    def test_default_inactive_then_independent_full_commits_survive_closes(self):
        self.anchor.ensure(self.db);self.assertFalse(self.anchor.status()['connected'])
        self.anchor.start(self.db)
        for value in range(5):self.save(value);self.assertEqual(self.value(),value)
        self.assertTrue(self.db.with_name(self.db.name+'-wal').exists())
        with self.assertRaises(sqlite3.OperationalError):self.anchor.connection.execute('DELETE FROM progress')
        self.anchor.close();self.assertFalse(self.anchor.status()['connected']);self.assertEqual(self.value(),4)

    def test_anchor_never_pins_reader_or_disables_automatic_checkpoint(self):
        self.anchor.start(self.db);self.assertFalse(self.anchor.connection.in_transaction)
        self.save(42)
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute('PRAGMA wal_autocheckpoint').fetchone()[0],1000)
            self.assertEqual(tuple(db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()),(0,0,0))
        self.assertEqual(self.value(),42)

    def test_rollback_does_not_commit_unsaved_state(self):
        self.anchor.start(self.db)
        with closing(sqlite3.connect(self.db)) as db:db.execute('UPDATE progress SET value=99')
        self.assertEqual(self.value(),0)

    def test_nested_maintenance_releases_handle_and_reopens_only_after_exit(self):
        self.anchor.start(self.db)
        with self.anchor.suspend():
            self.assertFalse(self.anchor.status()['connected']);self.assertTrue(self.anchor.status()['suspended'])
            self.anchor.ensure(self.db);self.assertFalse(self.anchor.status()['connected'])
            with self.anchor.suspend():self.save(12)
            self.assertFalse(self.anchor.status()['connected'])
        self.assertTrue(self.anchor.status()['connected']);self.assertEqual(self.value(),12)

    def test_maintenance_exception_and_close_during_suspend_do_not_reopen_wrongly(self):
        self.anchor.start(self.db)
        with self.assertRaisesRegex(RuntimeError,'owned failure'):
            with self.anchor.suspend():raise RuntimeError('owned failure')
        self.assertTrue(self.anchor.status()['connected'])
        with self.anchor.suspend():self.anchor.close()
        self.assertFalse(self.anchor.status()['connected'])

    def test_path_switch_releases_old_library_and_never_creates_missing_database(self):
        self.anchor.start(self.db);old=self.anchor.connection
        missing=self.folder/'missing.db';self.anchor.ensure(missing)
        self.assertFalse(missing.exists());self.assertFalse(self.anchor.status()['connected'])
        with self.assertRaises(sqlite3.ProgrammingError):old.execute('SELECT 1')
        self.assertNotIn(str(self.folder),json.dumps(self.anchor.status()))
        self.anchor.ensure(self.db);self.assertTrue(self.anchor.status()['connected'])

    def test_non_wal_database_is_not_silently_converted(self):
        other=self.folder/'delete.db'
        with closing(sqlite3.connect(other)) as db:db.execute('CREATE TABLE owned(id)')
        self.anchor.start(other);self.assertFalse(self.anchor.status()['connected'])
        with closing(sqlite3.connect(other)) as db:self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0],'delete')

    def test_committed_data_survives_owned_process_exit_without_anchor_cleanup(self):
        # Only this isolated child exits abruptly. No desktop/user process is killed.
        script="""import os,sqlite3,sys
from app.db_lifecycle import WalAnchor
a=WalAnchor();a.start(sys.argv[1]);assert a.status()['connected']
d=sqlite3.connect(sys.argv[1]);assert d.execute('PRAGMA synchronous').fetchone()[0]==2
d.execute('UPDATE progress SET value=73');d.commit();os._exit(0)
"""
        result=subprocess.run([sys.executable,'-c',script,str(self.db)],cwd=Path(__file__).resolve().parents[1],capture_output=True,timeout=15,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(self.value(),73)
        with closing(sqlite3.connect(self.db)) as db:self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')


class LiveLibraryLifecycleTests(unittest.TestCase):
    def test_optional_anchor_open_failure_does_not_hide_or_block_real_commits(self):
        from app import main as m
        case=fixture.CorrectnessTests();case.setUp();self.addCleanup(case.doCleanups)
        anchor=WalAnchor();self.addCleanup(anchor.close);connect=sqlite3.connect
        def failure(*args,**kwargs):
            if kwargs.get('check_same_thread') is False:raise sqlite3.OperationalError('PRIVATE source path')
            return connect(*args,**kwargs)
        with patch.object(m,'db_anchor',anchor),patch('app.db_lifecycle.sqlite3.connect',side_effect=failure):
            anchor.start(m.DB)
            with m.connection() as db:db.execute('UPDATE media SET progress=15 WHERE id=1')
            self.assertEqual(m.media_record(1)['progress'],15)
            self.assertFalse(anchor.status()['connected']);self.assertEqual(anchor.status()['error'],'OperationalError')
            self.assertNotIn('PRIVATE',json.dumps(anchor.status()))

    def test_application_write_failure_rolls_back_with_anchor_still_active(self):
        from app import main as m
        case=fixture.CorrectnessTests();case.setUp();self.addCleanup(case.doCleanups)
        anchor=WalAnchor();self.addCleanup(anchor.close)
        with patch.object(m,'db_anchor',anchor):
            anchor.start(m.DB)
            with self.assertRaisesRegex(RuntimeError,'owned write failure'):
                with m.connection() as db:
                    db.execute('UPDATE media SET progress=98 WHERE id=1');raise RuntimeError('owned write failure')
            self.assertEqual(m.media_record(1)['progress'],0);self.assertTrue(anchor.status()['connected'])

    def test_restore_and_failed_restore_with_active_anchor(self):
        from app import main as m
        case=fixture.CorrectnessTests()
        case.setUp();self.addCleanup(case.doCleanups)
        anchor=WalAnchor();self.addCleanup(anchor.close)
        with patch.object(m,'db_anchor',anchor):
            anchor.start(m.DB)
            with m.connection() as db:db.execute('UPDATE media SET progress=31 WHERE id=1')
            payload=Path(m.create_backup().path).read_bytes()
            with m.connection() as db:db.execute('UPDATE media SET progress=55 WHERE id=1')
            result=case.restore(payload);self.assertTrue(result['ok']);self.assertEqual(m.media_record(1)['progress'],31)
            self.assertTrue(anchor.status()['connected']);self.assertFalse(anchor.status()['suspended'])
            with m.connection() as db:db.execute('UPDATE media SET progress=66 WHERE id=1')
            with patch.object(m,'bootstrap',side_effect=sqlite3.OperationalError('owned install failure')):
                with self.assertRaises(m.HTTPException):case.restore(payload)
            self.assertEqual(m.media_record(1)['progress'],66);self.assertTrue(anchor.status()['connected'])
            with self.assertRaises(m.HTTPException):case.restore(b'not a database')
            self.assertEqual(m.media_record(1)['progress'],66);self.assertTrue(anchor.status()['connected'])

    def test_lifespan_always_closes_anchor_after_worker_start_failure(self):
        from app import main as m
        self.assertTrue(m.DATA.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()),'Lifecycle test must use isolated data')
        anchor=WalAnchor();self.addCleanup(anchor.close)
        @asynccontextmanager
        async def failed_start(_):
            raise RuntimeError('owned startup failure')
            yield
        async def exercise():
            with patch.object(m,'db_anchor',anchor),patch.object(m,'background_lifespan',failed_start):
                with self.assertRaisesRegex(RuntimeError,'owned startup failure'):
                    async with m.lifespan(m.app):pass
        asyncio.run(exercise());self.assertFalse(anchor.status()['connected']);self.assertFalse(anchor.status()['enabled'])

    def test_lifespan_closes_anchor_even_when_worker_cleanup_raises(self):
        from app import main as m
        self.assertTrue(m.DATA.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()))
        anchor=WalAnchor();self.addCleanup(anchor.close)
        @asynccontextmanager
        async def failed_cleanup(_):
            try:yield
            finally:raise RuntimeError('owned cleanup failure')
        async def exercise():
            with patch.object(m,'db_anchor',anchor),patch.object(m,'background_lifespan',failed_cleanup):
                with self.assertRaisesRegex(RuntimeError,'owned cleanup failure'):
                    async with m.lifespan(m.app):self.assertTrue(anchor.status()['connected'])
        asyncio.run(exercise());self.assertFalse(anchor.status()['connected'])
