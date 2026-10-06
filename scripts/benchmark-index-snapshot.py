"""Read-only snapshot benchmark. Never scans, plays or changes source media."""
import argparse
import json
import os
import sqlite3
import statistics
import sys
import tempfile
import time
import uuid
from contextlib import closing
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--index',type=Path,required=True);args=parser.parse_args()
    source=args.index.resolve(strict=True);build=ROOT/'build';build.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='avhub-index-snapshot-',dir=build) as temporary:
        data=Path(temporary);target=data/'library.db'
        with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as src,closing(sqlite3.connect(target)) as dst:src.backup(dst)
        os.environ['AVHUB_DATA_DIR']=str(data)
        from app import main as m
        with m.read_connection() as db:
            rows=db.execute('SELECT COUNT(*) FROM media').fetchone()[0]
            roots=db.execute('SELECT COUNT(*) FROM roots').fetchone()[0]
            first=db.execute('SELECT id FROM roots ORDER BY id LIMIT 1').fetchone()
        queries={
            'all_first':lambda:m.media(page=1,page_size=48,limit=300),
            'all_last':lambda:m.media(page=max(1,(rows+47)//48),page_size=48,limit=300),
            'favorites':lambda:m.media(page=1,page_size=48,limit=300,favorite=True),
            'resolution':lambda:m.media(page=1,page_size=48,limit=300,sort='resolution_desc'),
            'root_metadata':lambda:m.roots(check_available=False),
        }
        if first:queries['folder_page']=lambda:m.media_folders(first[0],folder='',q='',page=1,page_size=40,focus='')
        results={}
        for name,action in queries.items():
            action();times=[]
            for _ in range(7):
                started=time.perf_counter();value=action();times.append((time.perf_counter()-started)*1000)
            results[name]={'median_ms':round(statistics.median(times),3),'max_ms':round(max(times),3),'payload_bytes':len(json.dumps(value,ensure_ascii=False,default=str).encode())}
        report={'rows':rows,'roots':roots,'results':results,'scope':'Copied SQLite index; source connection read-only. No source video reads, scan, playback, thumbnails or daily-library writes. Warm Python API queries, not browser/seek or cold-disk timings.'}
        output=build/f'index-snapshot-{uuid.uuid4().hex[:8]}.json'
        with output.open('x',encoding='utf-8') as stream:json.dump(report,stream,ensure_ascii=False,indent=2)
        print(json.dumps({**report,'report':str(output)},ensure_ascii=False))
        m.playback.close()

if __name__=='__main__':main()
