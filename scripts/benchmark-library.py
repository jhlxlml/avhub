"""Reproducible isolated library benchmark; never opens the user's database."""
import argparse
import json
import os
import platform
import sqlite3
import statistics
import subprocess
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
    parser.add_argument('--layout-details',action='store_true',help='Inspect an owned consistent snapshot using the pinned engine')
    parser.add_argument('--fractional-values',action='store_true',help='Additional fixture using fractional timestamps/duration/progress, not integer-heavy baseline')
    parser.add_argument('--search-count-mode',choices=['bounded','legacy'],default='bounded',help='Isolated harness comparison with the previous count + page query')
    parser.add_argument('--sqlite-memory',action='store_true',help='Measure SQLite allocator highwater separately from timings; pinned runtime only')
    args = parser.parse_args()
    if not 100 <= args.rows <= 1000000 or not 1 <= args.roots <= 100000 or not 3 <= args.repeats <= 30:
        parser.error('rows 100..1000000, roots 1..100000, repeats 3..30')
    report = {'label':args.label, 'rows':args.rows, 'roots':args.roots, 'repeats':args.repeats,
              'fractional_values':args.fractional_values,
              'search_count_mode':args.search_count_mode,
              'python':platform.python_version(), 'sqlite':sqlite3.sqlite_version,
              'scope':'warm local Python API queries and JSON payloads; synthetic metadata, no disk scan or browser timing'}
    with tempfile.TemporaryDirectory(prefix='avhub-library-benchmark-') as temporary:
        folder = Path(temporary)
        os.environ['AVHUB_DATA_DIR'] = str(folder / 'data')
        from app import main as m
        if args.search_count_mode=='legacy':
            # Test-process-only old query shape, never a production preference.
            def legacy_count(db,sql,params):
                row=db.execute(sql.replace('SELECT *','SELECT COUNT(*),id',1),params).fetchone()
                return row[0],[row[1]] if row[0]==1 else None
            m.media_search.count_and_ids=legacy_count
        memory=None
        if args.sqlite_memory:
            import ctypes
            from app import sqlite_runtime
            if not sqlite_runtime.status().get('verified'):parser.error('--sqlite-memory requires the pinned Python runtime entry')
            engine=ctypes.CDLL(str(sqlite_runtime.runtime_path(sqlite_runtime.manifest())),winmode=0x1100)
            native_status=engine.sqlite3_status64
            native_status.argtypes=[ctypes.c_int,ctypes.POINTER(ctypes.c_int64),ctypes.POINTER(ctypes.c_int64),ctypes.c_int]
            native_status.restype=ctypes.c_int
            report['sqlite_memory_scope']='sqlite3_status64 SQLITE_STATUS_MEMORY_USED (0); separate untimed call, global SQLite allocator highwater, not process RSS or Python memory'
            def memory(reset=False):
                current=ctypes.c_int64();peak=ctypes.c_int64()
                if native_status(0,ctypes.byref(current),ctypes.byref(peak),int(reset))!=0:
                    raise RuntimeError('SQLite memory status is unavailable')
                return current.value,peak.value
        def layout_phase(db,name):
            if args.layout_details:
                report.setdefault('layout_phases',[]).append({'phase':name,**{key:db.execute('PRAGMA '+key).fetchone()[0]
                    for key in ('page_count','freelist_count','page_size')}})
        began=time.perf_counter()
        try:
            with m.connection() as db:
                layout_phase(db,'bootstrap')
                db.executemany('INSERT INTO roots(id,path,added_at) VALUES(?,?,0)',
                    ((i,str(folder / f'root-{i:05}')) for i in range(1,args.roots+1)))
                if args.fractional_values:db.execute('UPDATE roots SET added_at=1700000000.125+id*.001')
                hot=min(10000,args.rows//4)
                def seed():
                    for i in range(1,args.rows+1):
                        root=1 if i<=hot else (2+(i%max(1,args.roots-1)) if args.roots>1 else 1)
                        path=folder/f'root-{root:05}'/(f'sub-{i:05}' if i<=hot else 'Videos')/f'film-{i:06}.mp4'
                        episode=i%4==0
                        yield (i,str(path),root,path.name,f'剧集 {i//40:05}' if episode else f'影片 {i:06}',
                            'episode' if episode else 'movie',i%3+1,i%10+1,'.mp4',120+i%8000+(.25 if args.fractional_values else 0),
                            int(i%7==0),int(i%5==0),i%100+(.125 if args.fractional_values and i%100 else 0),
                            (1700000100.375 if args.fractional_values else 100) if i%3==0 else None,
                            args.rows-i+(1700000000.125 if args.fractional_values else 0),
                            json.dumps(['剧情','rare-tag' if i==args.rows-1 else '离线'],ensure_ascii=False),
                            1700000000.125 if args.fractional_values else 0)
                db.executemany('''INSERT INTO media(id,path,root_id,name,title,kind,season,episode,ext,duration,
                    favorite,watched,progress,last_played,created_at,tags,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',seed())
                layout_phase(db,'inserted-media-uncommitted')
                db.execute("INSERT INTO playlists(id,name,created_at) VALUES(1,'large benchmark',0)")
                if args.fractional_values:db.execute('UPDATE playlists SET created_at=1700000000.125')
                db.executemany('INSERT INTO playlist_items(playlist_id,media_id,position) VALUES(1,?,?)',
                    ((i,i) for i in range(1,min(args.rows,10000)+1)))
                db.execute('ANALYZE')
                layout_phase(db,'analyzed-uncommitted')
            report['seed_seconds']=round(time.perf_counter()-began,3)
            began=time.perf_counter()
            with m.connection() as db:
                m.series_library.backfill(db);layout_phase(db,'series-backfill-uncommitted')
            report['series_initial_backfill_ms']=round((time.perf_counter()-began)*1000,2)
            with m.connection() as db:first_group=db.execute('SELECT id FROM series_groups ORDER BY id LIMIT 1').fetchone()[0]
            def media(**extra):
                return m.media(**{'page':1,'page_size':48,'limit':300,**extra})
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
                'small_search':lambda:media(q='影片 09999'),
                'medium_search':lambda:media(q='影片 0999'),
                'large_search':lambda:media(q='影片 09'),
                'large_search_deep':lambda:media(q='影片 09',page=min(100,max(1,args.rows//4800))),
                'substring_name':lambda:media(q='影片 099',sort='name'),
                'substring_size':lambda:media(q='影片 099',sort='size_desc'),
                'tag_search':lambda:media(q='rare-tag'),
                'empty_search':lambda:media(q='not-a-matching-title'),
                'single_name_search':lambda:media(q=f'film-{args.rows:06}'),
                'broad_search':lambda:media(q='影片'),
                'broad_tag_search':lambda:media(q='离线'),
                'broad_tag_deep':lambda:media(q='离线',page=max(1,args.rows//96)),
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
                if isinstance(payload,dict) and 'items' in payload and 'total' in payload:
                    item['total']=payload['total']
                    if all('id' in row for row in payload['items']):
                        item['page_ids']=[row['id'] for row in payload['items']]
                if memory:
                    base,_=memory(True);action();end,high=memory()
                    item['sqlite_allocator_bytes']={'base':base,'peak':high,'extra_peak':max(0,high-base),'end':end}
                measurements[name]=item
                print(json.dumps({name:{key:value for key,value in item.items() if key!='page_ids'}}),flush=True)
            report['measurements']=measurements
            with m.connection() as db:
                report['database_bytes']=db.execute('PRAGMA page_count').fetchone()[0]*db.execute('PRAGMA page_size').fetchone()[0]
                # Allocation includes free pages; do not call this live data
                # size or silently VACUUM the benchmark/user database.
                report['database_pages']={key:db.execute('PRAGMA '+key).fetchone()[0]
                    for key in ('page_count','freelist_count','page_size','auto_vacuum')}
                report['plans']={name:[row[3] for row in db.execute('EXPLAIN QUERY PLAN '+sql)] for name,sql in {
                    'recent':"SELECT * FROM media WHERE missing=0 ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48",
                    'favorite':"SELECT * FROM media WHERE missing=0 AND favorite=1 ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48",
                    'episodes':"SELECT * FROM media WHERE missing=0 AND kind='episode' ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48",
                    'series_unassigned':"SELECT id,root_id,title,name FROM media INDEXED BY media_series_unassigned WHERE kind='episode' AND series_id IS NULL",
                    'series_detail':"SELECT * FROM media INDEXED BY media_series_order WHERE series_id=1 AND kind='episode' LIMIT 48",
                    'playlist_neighbor':"SELECT m.* FROM playlist_items i JOIN media m ON m.id=i.media_id WHERE i.playlist_id=1 AND m.missing=0 AND (i.position,i.media_id)>(9999,9999) ORDER BY i.position,i.media_id LIMIT 1",
                    'search_count':"SELECT COUNT(*),id FROM media NOT INDEXED WHERE missing=0 AND (title LIKE '%rare-tag%' ESCAPE '\\' OR name LIKE '%rare-tag%' ESCAPE '\\' OR tags LIKE '%rare-tag%' ESCAPE '\\')",
                    'search_single_lookup':"SELECT * FROM media WHERE id=99999",
                    'search_small_page':"SELECT * FROM media NOT INDEXED WHERE missing=0 AND (title LIKE '%影片 09999%' OR name LIKE '%影片 09999%' OR tags LIKE '%影片 09999%') ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48",
                    'search_broad_page':"SELECT * FROM media WHERE missing=0 AND (title LIKE '%影片%' OR name LIKE '%影片%' OR tags LIKE '%影片%') ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48",
                    'search_bounded_ids':"SELECT id FROM media NOT INDEXED WHERE missing=0 AND (title LIKE '%影片 099%' OR name LIKE '%影片 099%' OR tags LIKE '%影片 099%') ORDER BY id ASC LIMIT 1024",
                    'search_remaining_count':"SELECT COUNT(*) FROM media NOT INDEXED WHERE missing=0 AND (title LIKE '%影片%' OR name LIKE '%影片%' OR tags LIKE '%影片%') AND id>1365",
                    'search_bounded_page':"SELECT * FROM media NOT INDEXED WHERE id IN (99990,99991,99993) ORDER BY COALESCE(last_played,0) DESC,created_at DESC,id DESC LIMIT 48",
                }.items()}
                if args.layout_details:
                    # This entire directory/database is generated by this run.
                    # backup(), not raw-copying a live WAL or opening user data.
                    from contextlib import closing
                    with closing(sqlite3.connect(folder/'layout-snapshot.db')) as snapshot:db.backup(snapshot)
            if args.layout_details:
                result=subprocess.run([sys.executable,str(PROJECT/'scripts/inspect-sqlite-pages.py'),str(folder/'layout-snapshot.db')],
                    cwd=PROJECT,capture_output=True,encoding='utf-8',timeout=60,env={**os.environ,'PYTHONUTF8':'1'})
                if result.returncode:raise RuntimeError(result.stderr)
                report['page_layout']=json.loads(result.stdout)
        finally:m.playback.close();m.scanner.close()
    output=PROJECT/'build'/'library-benchmarks';output.mkdir(parents=True,exist_ok=True)
    target=output/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.json')
    with target.open('x',encoding='utf-8') as file:json.dump(report,file,ensure_ascii=False,indent=2)
    print(json.dumps({'report':str(target),'label':args.label}),flush=True)


if __name__=='__main__':main()
