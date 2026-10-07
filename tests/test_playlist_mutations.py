import sqlite3
import unittest
from fastapi import HTTPException
from pydantic import ValidationError
from app.playlist_mutations import PlaylistBatchInput, PlaylistCreateInput, PlaylistRestoreInput, batch, create, restore


class PlaylistMutationTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.row_factory=sqlite3.Row
        self.db.executescript('''
            PRAGMA foreign_keys=ON;
            CREATE TABLE media(id INTEGER PRIMARY KEY,missing INTEGER DEFAULT 0,duration REAL DEFAULT 60);
            CREATE TABLE playlists(id INTEGER PRIMARY KEY,name TEXT UNIQUE,created_at REAL,revision INTEGER DEFAULT 0);
            CREATE TABLE playlist_items(playlist_id INTEGER REFERENCES playlists(id),media_id INTEGER REFERENCES media(id),position INTEGER,PRIMARY KEY(playlist_id,media_id));
            INSERT INTO media(id) VALUES(1),(2),(3),(4),(5);
        ''')
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def run_change(self,fn,identity,body):
        with self.db:return fn(self.db,identity,body)

    def make(self,ids):
        with self.db:return create(self.db,PlaylistCreateInput(name='fixture',media_ids=ids))['id']

    def ordered(self,identity):
        return [(row['media_id'],row['position']) for row in self.db.execute('SELECT * FROM playlist_items WHERE playlist_id=? ORDER BY position,media_id',(identity,))]

    def test_creation_and_addition_preserve_selection_order_and_skip_members(self):
        identity=self.make([3,1])
        result=self.run_change(batch,identity,PlaylistBatchInput(action='add',media_ids=[1,5,2],expected_revision=1))
        self.assertEqual(result['added'],2);self.assertEqual(result['existing'],1);self.assertEqual(result['revision'],2)
        self.assertEqual(self.ordered(identity),[(3,1),(1,2),(5,3),(2,4)])
        unchanged=self.run_change(batch,identity,PlaylistBatchInput(action='add',media_ids=[1,3],expected_revision=2))
        self.assertEqual(unchanged['added'],0);self.assertEqual(unchanged['revision'],2)

    def test_invalid_creation_does_not_leave_an_empty_list(self):
        with self.db:self.db.execute('UPDATE media SET missing=1 WHERE id=2')
        with self.assertRaises(HTTPException):
            with self.db:create(self.db,PlaylistCreateInput(name='fixture',media_ids=[1,2]))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM playlists').fetchone()[0],0)

    def test_offline_member_aborts_the_whole_addition(self):
        identity=self.make([1]);before=self.ordered(identity)
        with self.db:self.db.execute('UPDATE media SET missing=1 WHERE id=3')
        with self.assertRaises(HTTPException):self.run_change(batch,identity,PlaylistBatchInput(action='add',media_ids=[2,3,4],expected_revision=1))
        self.assertEqual(self.ordered(identity),before)
        self.assertEqual(self.db.execute('SELECT revision FROM playlists').fetchone()[0],1)

    def test_remove_and_restore_preserve_gaps_ties_and_offline_members(self):
        identity=self.make([1,2,3,4,5])
        with self.db:
            self.db.execute('UPDATE playlist_items SET position=0 WHERE media_id IN (1,2)')
            self.db.execute('UPDATE playlist_items SET position=40 WHERE media_id=5')
            self.db.execute('UPDATE media SET missing=1 WHERE id=3')
        before=self.ordered(identity)
        result=self.run_change(batch,identity,PlaylistBatchInput(action='remove',media_ids=[1,3,5],expected_revision=1))
        self.assertEqual(self.ordered(identity),[(2,0),(4,4)])
        saved=self.run_change(restore,identity,PlaylistRestoreInput(removed=result['removed'],expected_revision=result['revision']))
        self.assertEqual(saved['restored'],3);self.assertEqual(saved['revision'],3);self.assertEqual(self.ordered(identity),before)
        self.assertEqual(self.db.execute('SELECT missing FROM media WHERE id=3').fetchone()[0],1)

    def test_concurrent_add_rejects_undo_without_changing_new_order(self):
        identity=self.make([1,2,3])
        result=self.run_change(batch,identity,PlaylistBatchInput(action='remove',media_ids=[2],expected_revision=1))
        self.run_change(batch,identity,PlaylistBatchInput(action='add',media_ids=[4],expected_revision=2))
        before=self.ordered(identity)
        with self.assertRaises(HTTPException) as error:self.run_change(restore,identity,PlaylistRestoreInput(removed=result['removed'],expected_revision=2))
        self.assertEqual(error.exception.status_code,409);self.assertEqual(self.ordered(identity),before)

    def test_stale_remove_or_missing_members_never_partially_remove(self):
        identity=self.make([1,2]);before=self.ordered(identity)
        for revision,ids in [(0,[1]),(1,[1,3])]:
            with self.assertRaises(HTTPException):self.run_change(batch,identity,PlaylistBatchInput(action='remove',media_ids=ids,expected_revision=revision))
            self.assertEqual(self.ordered(identity),before)

    def test_bounds_duplicate_boolean_and_fractional_ids_are_rejected(self):
        for ids in [[],[1,1],[True],[1.5],list(range(1,502))]:
            with self.assertRaises(ValidationError):PlaylistBatchInput(action='add',media_ids=ids,expected_revision=0)
        with self.assertRaises(ValidationError):PlaylistCreateInput(name='fixture',media_id=1,media_ids=[2])
        with self.assertRaises(ValidationError):PlaylistRestoreInput(removed=[{'media_id':1,'position':0},{'media_id':1,'position':1}],expected_revision=0)


if __name__=='__main__':unittest.main()
