"""Completed scan presence reads do not block saves or overwrite newer states."""
from contextlib import contextmanager
import sqlite3
import threading
import unittest
from unittest.mock import patch
import test_correctness as fixture
from app import main as m
from app.db_timing import DatabaseTiming


class ScanPresenceTests(unittest.TestCase):
    def setUp(self):
        fixture.CorrectnessTests.setUp(self)
        with m.connection() as db:
            db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)',(str(self.folder),))
            db.execute('UPDATE media SET root_id=1 WHERE id=1')

    def seed(self,count):
        with m.connection() as db:
            db.executemany('''INSERT INTO media(id,path,root_id,name,title,created_at,updated_at)
                VALUES(?,?,1,?,'owned',0,0)''',[(i,str(self.folder/f'{i}.mp4'),f'{i}.mp4') for i in range(2,count+1)])

    def test_unchanged_scan_needs_no_writer_even_while_another_writer_holds_the_gate(self):
        done=threading.Event();errors=[];result=[]
        def run():
            try:result.append(m.reconcile_scan_presence(1,{str(self.source.resolve())}))
            except BaseException as error:errors.append(error)
            finally:done.set()
        worker=threading.Thread(target=run)
        with patch.object(m,'connection',side_effect=AssertionError('Unchanged reconciliation opened a writer')):
            with m.DB_LOCK:
                worker.start();self.assertTrue(done.wait(2),'Snapshot read waited for the writer gate')
            worker.join(3)
        self.assertFalse(worker.is_alive());self.assertEqual(errors,[]);self.assertEqual(result,[0])

    def test_only_missing_changes_are_committed_and_other_metadata_and_sources_stay_intact(self):
        self.seed(3);source=self.source.read_bytes()
        with m.connection() as db:
            db.execute("UPDATE media SET missing=1,progress=37,favorite=1,title='edited',updated_at=123 WHERE id=2")
            db.execute("UPDATE media SET file_state='recycled',missing=1 WHERE id=3")
        before=m.media_record(2)
        self.assertEqual(m.reconcile_scan_presence(1,{str(self.folder/'2.mp4')}),2)
        with m.read_connection() as db:
            self.assertEqual([tuple(r) for r in db.execute('SELECT id,missing FROM media ORDER BY id')],[(1,1),(2,0),(3,1)])
        after=m.media_record(2);before['missing']=0;self.assertEqual(after,before)
        self.assertEqual(self.source.read_bytes(),source)

    def test_newer_root_path_state_identity_or_missing_value_is_not_overwritten(self):
        self.seed(7);original=m.connection;changed=[]
        @contextmanager
        def racing():
            with original() as writer:
                writer.execute('UPDATE media SET root_id=2 WHERE id=1')
                writer.execute("UPDATE media SET path=path||'.moved' WHERE id=2")
                writer.execute("UPDATE media SET file_state='recycled' WHERE id=3")
                writer.execute('UPDATE media SET missing=1 WHERE id=4')
                writer.execute("UPDATE media SET source_identity='new-source' WHERE id=5")
                writer.execute('UPDATE media SET modified=42,size=100 WHERE id=6')
            changed.append(True)
            with original() as db:yield db
        with patch.object(m,'connection',racing):self.assertEqual(m.reconcile_scan_presence(1,set()),1)
        self.assertEqual(changed,[True])
        with m.read_connection() as db:
            self.assertEqual([r[0] for r in db.execute('SELECT missing FROM media ORDER BY id')],[0,0,0,1,0,0,1])

    def test_failed_update_rolls_back_the_whole_reconciliation(self):
        self.seed(3);original=sqlite3.connect
        class Failure(sqlite3.Connection):
            def executemany(self,sql,args):
                super().execute(sql,args[0]);raise sqlite3.OperationalError('owned update fault')
        def connect(*args,**kwargs):return original(*args,**{**kwargs,'factory':Failure})
        with patch.object(m.sqlite3,'connect',side_effect=connect):
            with self.assertRaises(sqlite3.OperationalError):m.reconcile_scan_presence(1,set())
        with m.read_connection() as db:self.assertEqual(db.execute('SELECT SUM(missing) FROM media').fetchone()[0],0)

    def test_reconciliation_diagnostics_separate_read_from_actual_writes(self):
        timing=DatabaseTiming()
        with patch.object(m,'database_timing',timing):
            self.assertEqual(m.reconcile_scan_presence(1,{str(self.source.resolve())}),0)
            first=timing.report()['operation_lifetime']['groups']
            self.assertEqual(first['read:scan-reconcile']['count'],1)
            self.assertNotIn('serialized:scan-reconcile',first)
            self.assertEqual(m.reconcile_scan_presence(1,set()),1)
        written=timing.report()['operation_lifetime']['groups']['serialized:scan-reconcile']
        self.assertEqual(written['changed_rows'],1);self.assertEqual(written['open_transactions'],1)
        self.assertEqual(written['worst_commit']['transaction_outcome'],'committed')
