"""Owned synthetic old-schema fixture; never opens a real user library."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3

ROOT=Path(__file__).resolve().parents[2]


def seed(database,media):
    database=Path(database).resolve();media=Path(media).resolve();build=(ROOT/'build').resolve()
    if not database.is_relative_to(build) or not media.is_relative_to(build):
        raise ValueError('Legacy acceptance fixture must stay in the project build directory')
    if database.exists():raise ValueError('Never replace an existing database')
    database.parent.mkdir(parents=True,exist_ok=True);media.mkdir(parents=True,exist_ok=True)
    with closing(sqlite3.connect(database)) as db,db:
        # Before progress timestamps, color metadata, watched overrides,
        # playlist revisions, search/ordering and background job migrations.
        db.executescript('''
        CREATE TABLE roots(id INTEGER PRIMARY KEY,path TEXT UNIQUE NOT NULL,added_at REAL NOT NULL);
        CREATE TABLE media(
          id INTEGER PRIMARY KEY,path TEXT UNIQUE NOT NULL,root_id INTEGER,name TEXT NOT NULL,
          title TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'video',season INTEGER,episode INTEGER,
          ext TEXT,size INTEGER,modified REAL,duration REAL,width INTEGER,height INTEGER,
          video_codec TEXT,audio_tracks TEXT DEFAULT '[]',subtitles TEXT DEFAULT '[]',
          thumbnail TEXT,favorite INTEGER NOT NULL DEFAULT 0,rating INTEGER,tags TEXT DEFAULT '[]',
          progress REAL NOT NULL DEFAULT 0,watched INTEGER NOT NULL DEFAULT 0,last_played REAL,
          created_at REAL NOT NULL,updated_at REAL NOT NULL,missing INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE playlists(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL,created_at REAL NOT NULL);
        CREATE TABLE playlist_items(playlist_id INTEGER NOT NULL,media_id INTEGER NOT NULL,
          position INTEGER NOT NULL,PRIMARY KEY(playlist_id,media_id));
        CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at REAL NOT NULL DEFAULT 0);
        ''')
        db.execute('INSERT INTO roots VALUES(77,?,1)',(str(media),))
        db.execute('''INSERT INTO media(id,path,root_id,name,title,ext,duration,favorite,rating,tags,
          progress,created_at,updated_at,missing) VALUES(1001,?,77,'legacy.mp4','Legacy preserved title',
          '.mp4',120,1,4,?,42,1,1,1)''',(str(media/'legacy.mp4'),json.dumps(['legacy'])))
        db.execute("INSERT INTO playlists VALUES(91,'Legacy preserved playlist',1)")
        db.execute('INSERT INTO playlist_items VALUES(91,1001,0)')
        db.execute('INSERT INTO preferences VALUES(?,?,1)',('hoverPreview','false'))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('database',type=Path);parser.add_argument('media',type=Path)
    args=parser.parse_args();seed(args.database,args.media)
