"""Service policy harness: mutations only on newly-created isolated sample bytes."""
import json
import os
from pathlib import Path
import unittest
import sqlite3
import threading
import time
from unittest.mock import patch
from fastapi import HTTPException
from app.recycle_records import RecycleRecords
from app.file_operations import identity
from tests import test_file_operations as fixtures


class FakeBin:
    def __init__(self,path):self.path=path;self.deleted=[]
    def items(self):return [str(self.path)] if self.path.exists() else []
    def restore(self,item,target,stamp):
        if Path(target).exists():raise OSError('conflict')
        if identity(item)!=stamp:raise OSError('changed')
        os.rename(item,target)
    def delete(self,item,stamp):
        if identity(item)!=stamp:raise OSError('changed')
        Path(item).unlink();self.deleted.append(item)


class RecycleRecordTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.FileOperationTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.files=self.fixture.service;self.files.authorize(1,True,True,True);self.source=self.fixture.source
        self.bin=self.fixture.root/'owned-mock-bin.mp4';self.bridge=FakeBin(self.bin);self.records=RecycleRecords(self.files,self.bridge)
        op=self.files.prepare(1,'recycle');os.rename(self.source,self.bin);self.files.finish(op['id'],True);self.op=op['id']
        # Only native acceptance exercises the actual Windows namespace. This
        # simulation preserves full source identity checks, not shell path checks.
        self.locate=patch.object(self.records,'locate',side_effect=self.fake_locate);self.locate.start();self.addCleanup(self.locate.stop)
    def fake_locate(self,op,items):
        expected=json.loads(op['stamp']);matches=[]
        if hasattr(items,'by_stamp'):items=items.by_stamp.get(tuple(expected),[])
        for item in items:
            try:
                if identity(item)==expected:matches.append(item)
            except FileNotFoundError:continue
        if len(matches)>1:raise HTTPException(409,'ambiguous')
        return matches[0] if matches else None
    def visible(self):return self.records.list()['total']
    def test_restoration_preserves_identity_favorites_progress_and_playlist(self):
        expected=identity(self.bin);self.assertEqual(self.records.list()['items'][0]['status'],'available')
        self.records.execute(self.op,'restore');self.assertEqual(identity(self.source),expected)
        row=self.fixture.row();self.assertEqual((row['file_state'],row['favorite'],row['progress']),('normal',1,37))
        with self.fixture.connection() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM playlist_items').fetchone()[0],1)
        self.records.execute(self.op,'clear');self.assertEqual(self.visible(),0);self.assertTrue(self.source.exists())
    def test_permanent_delete_requires_confirmation_and_clears_only_after_success(self):
        with self.assertRaises(HTTPException):self.records.execute(self.op,'delete')
        self.assertTrue(self.bin.exists());self.assertEqual(self.visible(),1)
        self.records.execute(self.op,'delete',True);self.assertFalse(self.bin.exists());self.assertEqual(self.visible(),0)
        with self.fixture.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM media').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM playlist_items').fetchone()[0],0)
        with self.fixture.connection() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM file_operations').fetchone()[0],1)
    def test_no_clear_of_recoverable_item_and_no_overwrite(self):
        with self.assertRaises(HTTPException):self.records.execute(self.op,'clear')
        self.source.write_bytes(b'another owned sample')
        with self.assertRaises(HTTPException):self.records.execute(self.op,'restore')
        self.assertEqual(self.source.read_bytes(),b'another owned sample');self.assertTrue(self.bin.exists())
    def test_revoked_permission_blocks_restore_and_permanent_delete(self):
        self.files.authorize(1,False,False)
        for action in ('restore','delete'):
            with self.assertRaises(HTTPException):self.records.execute(self.op,action,True)
        self.assertTrue(self.bin.exists())
    def test_recycle_permission_does_not_grant_permanent_delete(self):
        self.files.authorize(1,False,True)
        with self.assertRaises(HTTPException):self.records.execute(self.op,'delete',True)
        self.assertTrue(self.bin.exists());self.assertFalse(self.files.permissions([1])[0]['permanentDelete'])
    def test_native_refusal_keeps_record_and_releases_reservation(self):
        with patch.object(self.bridge,'delete',side_effect=OSError('owned refusal')):
            with self.assertRaises(OSError):self.records.execute(self.op,'delete',True)
        self.assertEqual(self.visible(),1);self.assertTrue(self.bin.exists());self.files.require_idle()
    def test_external_restore_and_external_deletion_clear_no_files(self):
        os.rename(self.bin,self.source);self.assertEqual(self.records.list()['items'][0]['status'],'restored');self.assertEqual(self.fixture.row()['file_state'],'normal')
        self.records.execute(self.op,'clear');self.assertTrue(self.source.exists())
    def test_missing_record_clears_only_history(self):
        self.bin.unlink();self.assertEqual(self.records.list()['items'][0]['status'],'missing');self.records.execute(self.op,'clear');self.assertEqual(self.visible(),0)
    def test_replaced_bin_item_is_not_mutated(self):
        self.bin.unlink();self.bin.write_bytes(b'other owned sample')
        for action in ('restore','delete'):
            with self.assertRaises(HTTPException):self.records.execute(self.op,action,True)
        self.assertEqual(self.bin.read_bytes(),b'other owned sample');self.assertEqual(self.visible(),1)
    def test_old_unbound_cycle_is_never_associated_with_new_recycle(self):
        os.rename(self.bin,self.source);self.files.allow_scan(self.source)
        with self.fixture.connection() as db:db.execute('UPDATE file_operations SET recycle_status=NULL WHERE id=?',(self.op,))
        next_op=self.files.prepare(1,'recycle');os.rename(self.source,self.bin);self.files.finish(next_op['id'],True)
        with self.assertRaises(HTTPException):self.records.execute(self.op,'delete',True)
        self.assertTrue(self.bin.exists())
    def test_corrupt_identity_is_review_only_and_never_mutates(self):
        with self.fixture.connection() as db:db.execute("UPDATE file_operations SET stamp='[]' WHERE id=?",(self.op,))
        item=self.records.list()['items'][0];self.assertEqual(item['status'],'review');self.assertEqual(item['size'],0)
        with self.assertRaises(HTTPException):self.records.execute(self.op,'delete',True)
        self.assertTrue(self.bin.exists())
    def test_terminal_clear_prunes_visible_details_but_preserves_id_safety(self):
        os.rename(self.bin,self.source);self.records.list();self.records.execute(self.op,'clear')
        self.assertEqual(self.files.history()['total'],0)
        with self.fixture.connection() as db:
            row=db.execute('SELECT * FROM file_operations WHERE id=?',(self.op,)).fetchone()
            self.assertEqual(row['media_id'],1);self.assertIsNone(row['old_title']);self.assertIsNone(row['recycle_receipt'])

    def attempt(self):
        with self.fixture.connection() as db:return dict(db.execute('SELECT * FROM recycle_actions ORDER BY created_at DESC LIMIT 1').fetchone())
    def restart(self):
        from app.file_operations import FileOperations
        files=FileOperations(self.fixture.connection,self.fixture.connection,volume=lambda _:True);files.recover()
        records=RecycleRecords(files,self.bridge);records.recover();return records
    def test_intent_committed_before_native_call_and_does_not_hold_file_lock(self):
        original=self.bridge.restore
        def restore(item,target,stamp):
            self.assertEqual(self.attempt()['state'],'dispatched')
            released=[]
            def reader():
                acquired=self.files.lock.acquire(timeout=.5);released.append(acquired)
                if acquired:self.files.lock.release()
            thread=threading.Thread(target=reader);thread.start();thread.join(1);self.assertEqual(released,[True])
            with self.assertRaises(HTTPException):self.files.require_idle()
            return original(item,target,stamp)
        with patch.object(self.bridge,'restore',side_effect=restore):self.records.execute(self.op,'restore')
        self.assertEqual(self.attempt()['state'],'completed')
    def test_crash_before_dispatch_never_replays_delete(self):
        with self.fixture.connection() as db:op=self.records.operation(db,self.op)
        self.records.prepare(op,'delete',str(self.bin))
        with patch.object(self.bridge,'delete') as delete,patch.object(self.bridge,'items') as items:
            self.restart();delete.assert_not_called();items.assert_not_called()
        self.assertEqual(self.attempt()['state'],'failed');self.assertTrue(self.bin.exists())
    def test_crash_after_delete_keeps_review_until_explicit_readonly_recheck(self):
        with self.fixture.connection() as db:op=self.records.operation(db,self.op)
        attempt=self.records.prepare(op,'delete',str(self.bin))
        with self.fixture.connection() as db:db.execute("UPDATE recycle_actions SET state='dispatched' WHERE id=?",(attempt,))
        self.bin.unlink();fresh=self.restart();self.assertEqual(self.attempt()['state'],'review')
        with self.assertRaises(HTTPException):fresh.execute(self.op,'delete',True)
        self.assertEqual(fresh.list()['items'][0]['status'],'review');self.assertEqual(self.visible(),1)
        with patch.object(self.bridge,'delete') as delete:fresh.recheck(self.op);delete.assert_not_called()
        self.assertEqual(self.attempt()['state'],'acknowledged');self.assertEqual(fresh.list()['items'][0]['status'],'missing')
    def test_dispatched_crash_with_item_still_present_is_not_declared_failed_automatically(self):
        with self.fixture.connection() as db:op=self.records.operation(db,self.op)
        attempt=self.records.prepare(op,'delete',str(self.bin))
        with self.fixture.connection() as db:db.execute("UPDATE recycle_actions SET state='dispatched' WHERE id=?",(attempt,))
        fresh=self.restart();self.assertEqual(self.attempt()['state'],'review')
        with self.assertRaises(HTTPException):fresh.execute(self.op,'delete',True)
        fresh.recheck(self.op);self.assertEqual(self.attempt()['state'],'failed');self.assertTrue(self.bin.exists())
    def test_transport_timeout_remains_review_even_when_bin_item_still_exists(self):
        from app.windows_recycle import UncertainRecycleError
        with patch.object(self.bridge,'delete',side_effect=UncertainRecycleError('owned timeout')):
            with self.assertRaises(UncertainRecycleError):self.records.execute(self.op,'delete',True)
        self.assertEqual(self.attempt()['state'],'review')
        with self.assertRaises(HTTPException):self.records.execute(self.op,'delete',True)
        self.assertTrue(self.bin.exists())
    def test_database_failure_after_restore_recovers_metadata_only(self):
        with patch.object(self.records,'complete',side_effect=sqlite3.OperationalError('owned DB refusal')):
            with self.assertRaises(sqlite3.OperationalError):self.records.execute(self.op,'restore')
        self.assertEqual(self.attempt()['state'],'dispatched');self.assertTrue(self.source.exists())
        with patch.object(self.bridge,'restore') as restore:self.restart();restore.assert_not_called()
        self.assertEqual(self.attempt()['state'],'completed');self.assertEqual(self.fixture.row()['file_state'],'normal')
    def test_database_failure_before_intent_never_calls_native(self):
        with patch.object(self.records,'prepare',side_effect=sqlite3.OperationalError('owned refusal')),patch.object(self.bridge,'delete') as delete:
            with self.assertRaises(sqlite3.OperationalError):self.records.execute(self.op,'delete',True)
            delete.assert_not_called()
        self.assertTrue(self.bin.exists());self.files.require_idle()
    def test_preview_is_bound_to_identity_action_permission_and_expiry(self):
        preview=self.records.preview([self.op],'delete');token=preview['preview_token']
        with self.assertRaises(HTTPException):self.records.execute(self.op,'restore',preview_token=token)
        self.assertTrue(self.bin.exists());self.records.previews[token]['expires']=0
        with self.assertRaises(HTTPException):self.records.execute(self.op,'delete',True,token)
        self.files.authorize(1,False,False)
        preview=self.records.preview([self.op],'delete');self.assertFalse(preview['records'][0]['eligible'])
    def test_snapshot_reused_and_explicit_refresh_is_fresh(self):
        with patch.object(self.bridge,'items',wraps=self.bridge.items) as items:
            self.records.list();self.records.list(q='视频');self.records.list();self.assertEqual(items.call_count,1)
            self.records.list(refresh=True);self.assertEqual(items.call_count,2)
    def test_unresolved_action_fences_scan_and_reader_after_restart(self):
        with self.fixture.connection() as db:op=self.records.operation(db,self.op)
        attempt=self.records.prepare(op,'delete',str(self.bin));self.bin.unlink();fresh=self.restart()
        self.source.write_bytes(b'unrelated owned replacement')
        self.assertFalse(fresh.files.allow_scan(self.source))
        with self.assertRaises(HTTPException):
            with fresh.files.reader(1):pass
        self.assertEqual(self.attempt()['state'],'review')
    def test_drive_offline_does_not_acknowledge_uncertain_delete(self):
        with self.fixture.connection() as db:op=self.records.operation(db,self.op)
        attempt=self.records.prepare(op,'delete',str(self.bin));self.files.pending.clear();self.bin.unlink()
        with patch('app.recycle_records.Path.is_dir',return_value=False):self.records.reconcile(attempt,True)
        self.assertEqual(self.attempt()['state'],'review');self.assertEqual(self.visible(),1)
    def test_single_item_binds_receipt_and_batch_does_not_reenumerate(self):
        with patch.object(self.bridge,'items',wraps=self.bridge.items) as items:
            preview=self.records.preview([self.op],'restore');self.records.execute(self.op,'restore',preview_token=preview['preview_token'])
            self.assertEqual(items.call_count,1)
    def test_restore_error_after_native_move_is_verified_without_replay(self):
        original=self.bridge.restore
        def late_error(*args):original(*args);raise OSError('owned interrupted response')
        with patch.object(self.bridge,'restore',side_effect=late_error) as restore:
            result=self.records.execute(self.op,'restore');self.assertTrue(result['ok']);self.assertEqual(restore.call_count,1)
        self.assertEqual(self.attempt()['state'],'completed');self.assertEqual(self.fixture.row()['progress'],37)
    def test_deleted_library_cover_becomes_an_owned_cleanup_candidate(self):
        from app import storage_management
        data=self.fixture.root/'owned-cache';thumbs=data/'thumbnails';thumbs.mkdir(parents=True)
        (thumbs/'1.jpg').write_bytes(b'owned thumbnail');(thumbs/'unknown.jpg').write_bytes(b'owned unknown file')
        with self.fixture.connection() as db:
            db.execute('ALTER TABLE media ADD COLUMN thumbnail TEXT');db.execute('CREATE TABLE thumbnail_jobs(media_id INTEGER)')
            db.execute("UPDATE media SET thumbnail='1.jpg'");db.execute('INSERT INTO thumbnail_jobs VALUES(1)')
        self.records.execute(self.op,'delete',True)
        preview=storage_management.plan(data,self.fixture.db)
        self.assertEqual(preview['cleanup']['files'],1);self.assertTrue((thumbs/'unknown.jpg').exists())
    def test_scale_2000_metadata_records_use_two_bin_reads_not_one_per_item(self):
        folder=self.fixture.root/'owned-scale-samples';folder.mkdir();paths=[];ids=[]
        with self.fixture.connection() as db:
            for index in range(2000):
                sample=folder/f'{index}.mp4';sample.write_bytes(b'owned tiny synthetic bytes');paths.append(str(sample))
                source=self.fixture.media/f'indexed-{index}.mp4';op_id=f'{index+1:032x}';ids.append(op_id)
                db.execute("INSERT INTO file_operations(id,media_id,action,source,stamp,state,created_at,old_title) VALUES(?,?,'recycle',?,?,'completed',?,?)",(op_id,index+2,str(source),json.dumps(identity(sample)),time.time()+index,f'scale-{index}'))
        started=time.perf_counter()
        with patch.object(self.bridge,'items',return_value=paths+[str(self.bin)]) as items:
            for page in range(1,5):self.assertEqual(len(self.records.list(page)['items']),30)
            preview=self.records.preview(ids[:500],'restore');self.assertEqual(sum(item['eligible'] for item in preview['records']),500);self.assertEqual(items.call_count,2)
        print(f'Metadata harness: 2000 isolated records, 120 browsed + 500 previewed in {round((time.perf_counter()-started)*1000)} ms; 2 bin snapshot reads, no native mutations.')
        self.assertEqual(self.bridge.deleted,[])


if __name__=='__main__':unittest.main()
