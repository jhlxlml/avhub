import json
import tempfile
import unittest
from pathlib import Path
from fastapi import HTTPException
import test_stability
from app import main as m


class MediaPlaybackMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='avhub-playback-memory-');self.addCleanup(self.temp.cleanup)
        self.source=Path(self.temp.name)/'sample.mkv';self.source.write_bytes(b'owned fixture')
        self.subtitle=self.source.with_suffix('.srt');self.subtitle.write_text('1\n00:00:00,000 --> 00:00:01,000\nOwned\n')
        with m.connection() as db:
            db.execute('DELETE FROM preferences');db.execute('DELETE FROM media')
            db.execute('INSERT INTO media(id,path,name,title,audio_tracks,subtitles,created_at,updated_at) VALUES(1,?,?,?,?,?,0,0)',
                (str(self.source),'sample','sample',json.dumps([{'index':1,'codec':'aac'},{'index':3,'codec':'aac'}]),json.dumps([{'index':2,'codec':'subrip'}])))

    def save(self,changes,source=None,time=100):
        return m.set_media_playback_state(1,m.MediaPlaybackStateInput(source=source or m.get_media_playback_state(1)['source'],changes=changes,updated_at=time))

    def test_choices_are_engine_neutral_portable_and_not_global(self):
        self.save({'audio':3,'subtitle':'embedded:2','delay':.6})
        self.assertEqual({key:value for key,value in m.get_media_playback_state(1).items() if key!='source'}, {'audio':3,'subtitle':'embedded:2','delay':.6})
        self.assertNotIn('playback.1',m.get_preferences()['values'])
        with m.connection() as db:value=json.loads(db.execute("SELECT value FROM preferences WHERE key='playback.1'").fetchone()[0])
        self.assertEqual(m.validate_preference('playback.1',value),value)

    def test_changed_source_rejects_late_writes_and_old_tracks(self):
        state=m.get_media_playback_state(1);self.save({'audio':3})
        self.source.write_bytes(b'replaced owned source bytes')
        self.assertIsNone(m.get_media_playback_state(1)['audio'])
        with self.assertRaises(HTTPException) as error:self.save({'audio':1},state['source'])
        self.assertEqual(error.exception.status_code,409)

    def test_rename_keeps_identity_and_track_memory(self):
        self.subtitle.unlink();self.save({'audio':3})
        renamed=self.source.with_name('renamed.mkv');self.source.rename(renamed)
        with m.connection() as db:db.execute('UPDATE media SET path=? WHERE id=1',(str(renamed),))
        self.assertEqual(m.get_media_playback_state(1)['audio'],3)

    def test_tracks_external_paths_and_nonfinite_delay_are_validated(self):
        for changes in ({'audio':True},{'audio':99},{'subtitle':'embedded:99'},{'subtitle':'C:/not-authorized.srt'},{'delay':float('nan')},{'delay':11},{'unexpected':1}):
            with self.subTest(changes=changes),self.assertRaises(HTTPException):self.save(changes)
        self.save({'subtitle':str(self.subtitle),'delay':-.4})
        self.assertEqual(m.get_media_playback_state(1)['subtitle'],str(self.subtitle))
        self.subtitle.write_text('changed owned subtitle')
        self.assertIsNone(m.get_media_playback_state(1)['subtitle'])

    def test_older_writes_do_not_override_newer_choice(self):
        self.save({'audio':3},time=200);self.save({'audio':1},time=100)
        self.assertEqual(m.get_media_playback_state(1)['audio'],3)

    def test_track_layout_change_and_reviewed_source_do_not_reuse_choices(self):
        self.save({'audio':3})
        with m.connection() as db:db.execute('UPDATE media SET audio_tracks=? WHERE id=1',(json.dumps([{'index':3,'codec':'opus'}]),))
        self.assertIsNone(m.get_media_playback_state(1)['audio'])
        with m.connection() as db:db.execute("UPDATE media SET file_state='review' WHERE id=1")
        with self.assertRaises(HTTPException):self.save({'audio':3})
