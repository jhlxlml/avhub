import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from starlette.requests import Request
from fastapi import HTTPException
import test_stability
from app import main as m


class PortableStateTests(unittest.TestCase):
    def setUp(self):
        with m.connection() as db:
            db.execute('DELETE FROM preferences');db.execute('DELETE FROM playlist_items');db.execute('DELETE FROM playlists');db.execute('DELETE FROM media')
            db.execute("INSERT INTO media(id,path,name,title,duration,progress,created_at,updated_at) VALUES(1,'fixture.mp4','fixture','fixture',120,30,0,0)")

    def test_validated_preferences_are_portable_and_reads_are_bounded(self):
        m.set_preferences(m.PreferencesInput(values={'audio':{'volume':.35,'muted':True},'queueMode':'random','subtitle.1':{'id':'embedded:2','delay':.5}}))
        with m.connection() as db:
            db.executemany('INSERT INTO preferences VALUES(?,?,0)',[(f'subtitle.{i}',json.dumps({'id':'','delay':0})) for i in range(2,10002)])
        self.assertEqual(set(m.get_preferences()['values']),{'audio','queueMode'})
        self.assertEqual(m.get_subtitle_preference(1)['value']['delay'],.5)
        self.assertIsNone(m.get_subtitle_preference(20000)['value'])

    def test_native_preparation_defaults_off_and_only_accepts_durable_booleans(self):
        self.assertFalse(m.native_prepare_enabled())
        for invalid in ('true',1,None,{},[]):
            with self.assertRaises(HTTPException):m.set_preferences(m.PreferencesInput(values={'nativePrepare':invalid}))
        for value in (True,False):
            m.set_preferences(m.PreferencesInput(values={'nativePrepare':value}))
            self.assertEqual(m.get_preferences()['values']['nativePrepare'],value)
            self.assertEqual(m.native_prepare_enabled(),value)
        with m.connection() as db:db.execute("UPDATE preferences SET value='1' WHERE key='nativePrepare'")
        self.assertFalse(m.native_prepare_enabled())

    def test_disabling_native_preparation_cancels_only_after_committed_setting(self):
        with patch.object(m.native_prepare,'cancel_pending') as cancel:
            m.set_preferences(m.PreferencesInput(values={'nativePrepare':True},updated_at=2000));cancel.assert_not_called()
            m.set_preferences(m.PreferencesInput(values={'nativePrepare':False},updated_at=1000));cancel.assert_not_called()
            m.set_preferences(m.PreferencesInput(values={'nativePrepare':False},updated_at=3000));cancel.assert_called_once()

    def test_older_writes_and_legacy_import_cannot_replace_new_settings(self):
        m.set_preferences(m.PreferencesInput(values={'playbackSpeed':1.5},updated_at=2000))
        m.set_preferences(m.PreferencesInput(values={'playbackSpeed':.5,'queueOpen':True},updated_at=1000))
        m.set_preferences(m.PreferencesInput(values={'playbackSpeed':2},import_only_missing=True))
        self.assertEqual(m.get_preferences()['values'],{'playbackSpeed':1.5,'queueOpen':True})

    def test_appearance_preferences_are_validated_and_read_after_reopening(self):
        for theme in ('dark','light'):
            for size in ('compact','standard','comfortable','large'):
                value={'theme':theme,'coverSize':size}
                m.set_preferences(m.PreferencesInput(values={'appearance':value}))
                self.assertEqual(m.get_preferences()['values']['appearance'],value)
                with m.connection() as db:
                    self.assertEqual(json.loads(db.execute("SELECT value FROM preferences WHERE key='appearance'").fetchone()[0]),value)

    def test_invalid_appearance_batch_is_atomic(self):
        for value in (None,True,'light',{}, {'theme':'system','coverSize':'standard'},
                      {'theme':'light','coverSize':'huge'}, {'theme':'light','coverSize':190},
                      {'theme':'light','coverSize':'standard','path':'C:/bad'}):
            with self.assertRaises(HTTPException):
                m.set_preferences(m.PreferencesInput(values={'hoverPreview':True,'appearance':value}))
            self.assertEqual(m.get_preferences()['values'],{})

    def test_appearance_is_included_in_database_backup(self):
        value={'theme':'light','coverSize':'large'}
        m.set_preferences(m.PreferencesInput(values={'appearance':value}))
        response=m.create_backup()
        try:
            db=sqlite3.connect(response.path)
            try:
                self.assertEqual(json.loads(db.execute("SELECT value FROM preferences WHERE key='appearance'").fetchone()[0]),value)
            finally:db.close()
        finally:response.background.func(*response.background.args,**response.background.kwargs)

    def test_invalid_batch_is_atomic_and_arbitrary_settings_are_rejected(self):
        for value in ({'queueOpen':True,'filePath':'C:/bad'}, {'audio':{'volume':2,'muted':False}}, {'subtitle.1':{'id':'uploaded','delay':float('nan')}}):
            with self.assertRaises(HTTPException):m.set_preferences(m.PreferencesInput(values=value))
            self.assertEqual(m.get_preferences()['values'],{})

    def test_backup_includes_preferences_and_old_backups_migrate(self):
        m.set_preferences(m.PreferencesInput(values={'hoverPreview':True,'autoNext':False}))
        response=m.create_backup()
        try:
            db=sqlite3.connect(response.path)
            self.assertEqual(dict(db.execute('SELECT key,value FROM preferences')),{'hoverPreview':'true','autoNext':'false'})
            db.close()
            contents=Path(response.path).read_bytes()
            m.set_preferences(m.PreferencesInput(values={'hoverPreview':False,'autoNext':True}))
            async def receive():return {'type':'http.request','body':contents,'more_body':False}
            request=Request({'type':'http','method':'POST','path':'/api/backup/restore','headers':[]},receive=receive)
            asyncio.run(m.restore_backup(request))
            self.assertEqual(m.get_preferences()['values'],{'hoverPreview':True,'autoNext':False})
        finally:response.background.func(*response.background.args,**response.background.kwargs)
        with m.connection() as db:db.execute('DROP TABLE preferences')
        m.bootstrap()
        self.assertEqual(m.get_preferences()['values'],{})

    def test_malformed_restored_preferences_are_not_exposed_to_the_ui(self):
        with m.connection() as db:
            db.executemany('INSERT INTO preferences VALUES(?,?,0)',[('queueMode','broken'),('audio','{}'),('subtitle.1','{"id":"x","delay":99}')])
        self.assertEqual(m.get_preferences()['values'],{})
        self.assertIsNone(m.get_subtitle_preference(1)['value'])

    def test_manual_watched_does_not_forge_progress_or_get_overwritten(self):
        marked=m.set_watched(1,m.WatchedInput(watched=True))
        self.assertEqual(marked['progress'],30);self.assertIsNone(marked['last_played'])
        self.assertTrue(m.save_progress(1,m.ProgressInput(progress=5,watched=False,updated_at=2000))['watched'])
        self.assertTrue(m.clear_history(1)['watched'])
        m.set_watched(1,m.WatchedInput(watched=False))
        self.assertFalse(m.save_progress(1,m.ProgressInput(progress=119,watched=True,updated_at=10**15))['watched'])
        self.assertTrue(m.automatic_watched(1)['watched'])
        with self.assertRaises(HTTPException):m.set_watched(99,m.WatchedInput(watched=True))

    def test_random_uses_whole_playlist_and_skips_current_and_offline(self):
        with m.connection() as db:
            db.execute("INSERT INTO playlists VALUES(1,'large',0,0)")
            db.executemany("INSERT INTO media(id,path,name,title,missing,created_at,updated_at) VALUES(?,?,?,'video',?,0,0)",
                           [(i,f'{i}.mp4',str(i),int(i==2)) for i in range(2,1001)])
            db.executemany('INSERT INTO playlist_items VALUES(1,?,?)',[(i,i) for i in range(1,1001)])
        with patch.object(m.random,'randrange',return_value=997):
            result=m.random_next(1,1)
        self.assertEqual(result['next']['id'],1000);self.assertEqual(result['candidates'],998)
        with self.assertRaises(HTTPException):m.random_next(1,2)

    def test_random_directory_scope_is_exact_and_returns_none_if_alone(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with m.connection() as db:
                db.execute('UPDATE media SET path=? WHERE id=1',(str(root/'one.mp4'),))
                db.executemany("INSERT INTO media(id,path,name,title,created_at,updated_at) VALUES(?,?,?,'video',0,0)",
                               [(2,str(root/'two.mp4'),'two'),(3,str(root/'nested'/'three.mp4'),'three')])
            self.assertEqual(m.random_next(1)['next']['id'],2)
            with m.connection() as db:db.execute('UPDATE media SET missing=1 WHERE id=2')
            self.assertIsNone(m.random_next(1)['next'])

    def test_native_actions_reject_cross_origin_missing_and_non_video(self):
        self.assertNotIn('/api/media/{media_id}/native/{action}',{route.path for route in m.app.routes})
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'file.exe';source.write_bytes(b'not video')
            with m.connection() as db:db.execute('UPDATE media SET path=? WHERE id=1',(str(source),))
            with self.assertRaises(HTTPException):m.native_media_path(1)
