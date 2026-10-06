"""Reproducible isolated library benchmark; never opens the user's database."""
import argparse
import json
import os
import platform
import sqlite3
import statistics
import sys
import tempfile
import time
import tracemalloc
import uuid
from datetime import datetime
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rows', type=int, default=100000)
    parser.add_argument('--roots', type=int, default=10000)
    parser.add_argument('--repeats', type=int, default=7)
    parser.add_argument('--label', default='current')
    args = parser.parse_args()
    if not 100 <= args.rows <= 1000000 or not 1 <= args.roots <= 100000 or not 3 <= args.repeats <= 30:
        parser.error('rows 100..1000000, roots 1..100000, repeats 3..30')
    report = {'label':args.label, 'rows':args.rows, 'roots':args.roots, 'repeats':args.repeats,
              'python':platform.python_version(), 'sqlite':sqlite3.sqlite_version,
              'scope':'warm local Python API queries and JSON payloads; synthetic metadata, no disk scan or browser timing'}
    with tempfile.TemporaryDirectory(prefix='avhub-library-benchmark-') as temporary:
        folder = Path(temporary)
        os.environ['AVHUB_DATA_DIR'] = str(folder / 'data')
        from app import main as m
        began=time.perf_counter()
        try:
            with m.connection() as db:
                db.executemany('INSERT INTO roots(id,path,added_at) VALUES(?,?,0)',
                    ((i,str(folder / f'root-{i:05}')) for i in range(1,args.roots+1)))
                hot=min(10000,args.rows//4)
                def seed():
                    for i in range(1,args.rows+1):
                        root=1 if i<=hot else (2+(i%max(1,args.roots-1)) if args.roots>1 else 1)
                        path=folder/f'root-{root:05}'/(f'sub-{i:05}' if i<=hot else 'Videos')/f'film-{i:06}.mp4'
                        episode=i%4==0
                        yield (i,str(path),root,path.name,f'剧集 {i//40:05}' if episode else f'影片 {i:06}',
                            'episode' if episode else 'movie',i%3+1,i%10+1,'.mp4',120+i%8000,
                            int(i%7==0),int(i%5==0),i%100,100 if i%3==0 else None,
                            args.rows-i, json.dumps(['剧情','rare-tag' if i==args.rows-1 else '离线'],ensure_ascii=False))
                db.executemany('''INSERT INTO media(id,path,root_id,name,title,kind,season,episode,ext,duration,
                    favorite,watched,progress,last_played,created_at,tags,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)''',seed())
                db.execute("INSERT INTO playlists(id,name,created_at) VALUES(1,'large benchmark',0)")
                db.executemany('INSERT INTO playlist_items(playlist_id,media_id,position) VALUES(1,?,?)',
                    ((i,i) for i in range(1,min(args.rows,10000)+1)))
                db.execute('ANALYZE')
            report['seed_seconds']=round(time.perf_counter()-began,3)
            began=time.perf_counter()
            with m.connection() as db:m.series_library.backfill(db)
            report['series_initial_backfill_ms']=round((time.perf_counter()-began)*1000,2)
            with m.connection() as db:first_group=db.execute('SELECT id FROM series_groups ORDER BY id LIMIT 1').fetchone()[0]
            def media(**extra):
                return m.media(page=1,page_size=48,limit=300,**extra)
            cases={
                'recent_first':lambda:media(),
                'recent_deep':lambda:m.media(page=max(1,args.rows//48-2),page_size=48,limit=300),
                'favorite_recent':lambda:media(favorite=True),
                'episode_recent':lambda:media(view='series'),
                'name_first':lambda:media(sort='name'),
                'resolution_desc':lambda:media(sort='resolution_desc'),
                'resolution_asc':lambda:media(sort='resolution_asc'),
                'size_desc':lambda:media(sort='size_desc'),
                'size_asc':lambda:media(sort='size_asc'),
                'root_size_desc':lambda:media(sort='size_desc',root_id=min(args.roots,9000)),
                'substring_search':lambda:media(q='影片 099'),
                'tag_search':lambda:media(q='rare-tag'),
                'hot_root':lambda:media(root_id=1),
                'folder_page':lambda:m.media_folders(1,page=2,page_size=60),
                'sibling_queue':lambda:m.media_siblings(args.rows,page=None,page_size=40),
                'playlist_current':lambda:m.playlist_queue(1,media_id=min(args.rows,9999),page=None,page_size=40),
                'progress_write':lambda:m.save_progress(args.rows,m.ProgressInput(progress=30,updated_at=time.time()*1000)),
                'series_groups':lambda:m.grouped_series(page=1,page_size=48),
                'series_season':lambda:m.series_detail(first_group,page=1,page_size=48),
                'batch_100':lambda:m.batch_media(m.BulkInput(media_ids=list(range(1,101)),add_tags=['benchmark'],favorite=True)),
            }
            measurements={}
            for name, action in cases.items():
                action()  # Warm-up outside timing.
                values=[]; payload=None
                for _ in range(args.repeats):
                    start=time.perf_counter();payload=action();values.append((time.perf_counter()-start)*1000)
                tracemalloc.start(); action(); _,peak=tracemalloc.get_traced_memory();tracemalloc.stop()
                values.sort()
                item={'p50_ms':round(statistics.median(values),2), 'p95_ms':round(values[min(len(values)-1,int(len(values)*.95))],2),
                      'response_bytes':len(json.dumps(payload,ensure_ascii=False).encode()), 'query_python_peak_bytes':peak}
                measurements[name]=item
                print(json.dumps({name:item}),flush=True)
            report['measurements']=measurements
            with m.connection() as db:
                report['database_bytes']=db.execute('PRAGMA page_count').fetchone()[0]*db.execute('PRAGMA page_size').fetchone()[0]
                report['plans']={name:[row[3] for row in db.execute('EXPLAIN QUERY PLAN '+sql)] for name,sql in {
                    'recent':"SELECT * FROM media WHERE missing=0 ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48",
                    'favorite':"SELECT * FROM media WHERE missing=0 AND favorite=1 ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48",
                    'episodes':"SELECT * FROM media WHERE missing=0 AND kind='episode' ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48",
                    'series_unassigned':"SELECT id,root_id,title,name FROM media INDEXED BY media_series_unassigned WHERE kind='episode' AND series_id IS NULL",
                    'series_detail':"SELECT * FROM media INDEXED BY media_series_order WHERE series_id=1 AND kind='episode' LIMIT 48",
                    'playlist_neighbor':"SELECT m.* FROM playlist_items i JOIN media m ON m.id=i.media_id WHERE i.playlist_id=1 AND m.missing=0 AND (i.position,i.media_id)>(9999,9999) ORDER BY i.position,i.media_id LIMIT 1",
                }.items()}
        finally:m.playback.close();m.scanner.close()
    output=PROJECT/'build'/'library-benchmarks';output.mkdir(parents=True,exist_ok=True)
    target=output/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.json')
    with target.open('x',encoding='utf-8') as file:json.dump(report,file,ensure_ascii=False,indent=2)
    print(json.dumps({'report':str(target),'label':args.label}),flush=True)


if __name__=='__main__':main()
