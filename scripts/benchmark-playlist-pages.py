"""Synthetic in-memory playlist comparison; no user database or media access.

Run through scripts/python-runtime.py. The baseline is an explicit local Git
revision; results are not disk I/O, real-library or desktop latency guarantees.
"""
import argparse
import json
from pathlib import Path
import sqlite3
import statistics
import subprocess
import time
from app.playlist_pages import page_query


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline',default='HEAD')
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    sha=subprocess.check_output(['git','rev-parse','--verify',args.baseline+'^{commit}'],cwd=root).decode().strip()
    namespace={'__package__':'app','__name__':'app.playlist_benchmark_baseline'}
    exec(subprocess.check_output(['git','show',sha+':app/playlist_pages.py'],cwd=root).decode('utf-8'),namespace)
    db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
    try:
        db.executescript('''CREATE TABLE playlists(id INTEGER PRIMARY KEY,name TEXT,revision INTEGER);
            CREATE TABLE media(id INTEGER PRIMARY KEY,title TEXT,name TEXT,duration REAL,missing INTEGER);
            CREATE TABLE playlist_items(playlist_id INTEGER,media_id INTEGER,position INTEGER);
            CREATE INDEX playlist_order ON playlist_items(playlist_id,position,media_id);
            INSERT INTO playlists VALUES(1,'synthetic',0);''')
        db.executemany('INSERT INTO media VALUES(?,?,?,?,?)',[(i,f'clip {i}',f'clip {i}',60,0) for i in range(1,20001)])
        db.executemany('INSERT INTO playlist_items VALUES(1,?,?)',[(i,i) for i in range(1,20001)])
        report={'fixture':'in-memory-20000-members','sqlite':sqlite3.sqlite_version,'baseline':sha,'results':[]}
        for q,page in [('',1),('',300),('clip',1),('clip',300),('19999',1)]:
            samples={'before':[],'after':[]};counts={};results={}
            for repeat in range(6):
                methods=[('before',namespace['page_query']),('after',page_query)]
                if repeat%2:methods.reverse()
                for label,query in methods:
                    started=time.perf_counter();results[label]=query(db,1,dict,page=page,size=40,q=q)
                    if repeat:samples[label].append((time.perf_counter()-started)*1000)
            if results['before']!=results['after']:raise AssertionError('Playlist semantics changed')
            for label,query in [('before',namespace['page_query']),('after',page_query)]:
                statements=[];db.set_trace_callback(statements.append)
                query(db,1,dict,page=page,size=40,q=q);db.set_trace_callback(None)
                counts[label]=len(statements)
            report['results'].append({'search':q,'page':page,'median_ms':{label:round(statistics.median(values),3) for label,values in samples.items()},'statements':counts})
        print(json.dumps(report,indent=2))
    finally:db.close()


if __name__=='__main__':main()
