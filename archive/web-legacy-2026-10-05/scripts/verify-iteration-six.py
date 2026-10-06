"""Read-only source verification, real index query timings and one AV1 cover retry."""
import argparse
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
import threading
import time
import uuid
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

PROJECT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(PROJECT))
spec=importlib.util.spec_from_file_location('scan_benchmark',PROJECT/'scripts'/'benchmark-scan.py')
benchmark=importlib.util.module_from_spec(spec);spec.loader.exec_module(benchmark)
inventory=benchmark.inventory


def stats(values):
    values=sorted(values)
    return {'count':len(values),'p50_ms':round(values[len(values)//2],3),
            'p95_ms':round(values[min(len(values)-1,int(len(values)*.95))],3),'max_ms':round(values[-1],3)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True);parser.add_argument('--index',type=Path,required=True)
    parser.add_argument('--probe-samples',type=int,default=0,help='Re-probe selected sources into the copied DB only, twice for read strategy comparison')
    args=parser.parse_args();root=args.source.resolve(strict=True);index=args.index.resolve(strict=True)
    if not index.is_relative_to((PROJECT/'build'/'scan-benchmarks').resolve()):parser.error('Use only an isolated benchmark DB')
    folder=PROJECT/'build'/'iteration-six'/uuid.uuid4().hex
    if folder.resolve().is_relative_to(root):parser.error('Output cannot be in source')
    before,summary=inventory(root)
    os.environ['AVHUB_DATA_DIR']=str(folder/'data')
    from app import main as m
    with sqlite3.connect(index.as_uri()+'?mode=ro',uri=True) as source,sqlite3.connect(m.DB) as target:source.backup(target)
    m.bootstrap()
    with m.connection() as db:
        rows=[dict(row) for row in db.execute('SELECT id,path FROM media')]
        for row in rows:
            if not Path(row['path']).resolve().is_relative_to(root):raise ValueError('Unexpected source outside authorized root')
        db.execute('DELETE FROM thumbnail_jobs')
    for image in (index.parent/'thumbnails').glob('*.jpg'):shutil.copyfile(image,m.THUMBS/image.name)
    report={'build':m.BUILD,'inventory':summary,'index_count':len(rows),'scope':'Copied 1982-video index; no full FFprobe re-scan; query-only timing, not browser frame rate'}
    real_read=m.read_connection

    def controlled(read_factory):
        entered=threading.Event()
        def writer():
            with m.connection():entered.set();time.sleep(.4)
        thread=threading.Thread(target=writer);thread.start();entered.wait(2)
        began=time.perf_counter()
        with patch.object(m,'read_connection',read_factory):m.media(page=1,page_size=48)
        elapsed=(time.perf_counter()-began)*1000;thread.join(2);return round(elapsed,3)

    def background(read_factory):
        stop=threading.Event();values=[]
        def writer():
            while not stop.is_set():
                with m.connection() as db:db.execute('UPDATE media SET updated_at=updated_at WHERE id IN (?,?)',(rows[0]['id'],rows[-1]['id']))
                stop.wait(.002)
        thread=threading.Thread(target=writer);thread.start()
        try:
            with patch.object(m,'read_connection',read_factory):
                for i in range(120):
                    began=time.perf_counter();m.media(page=1+i%10,page_size=48,sort='name' if i%2 else 'recent');values.append((time.perf_counter()-began)*1000)
        finally:stop.set();thread.join(5)
        return stats(values)

    def probing(read_factory):
        count=min(max(0,args.probe_samples),len(rows))
        selected=[rows[round(i*(len(rows)-1)/max(1,count-1))] for i in range(count)]
        with m.connection() as db:
            db.executemany('UPDATE media SET modified=NULL WHERE id=?',[(row['id'],) for row in selected])
            records=[dict(db.execute('SELECT id,path,root_id FROM media WHERE id=?',(row['id'],)).fetchone()) for row in selected]
        values=[];began=time.perf_counter()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(m.scan_file,row['root_id'],Path(row['path']),thumbnails=m.thumbnail_service) for row in records]
            with patch.object(m,'read_connection',read_factory):
                while not all(future.done() for future in futures):
                    point=time.perf_counter();m.media(page=1,page_size=48);values.append((time.perf_counter()-point)*1000);time.sleep(.02)
            for future in futures:future.result()
        return {'sources_probed':len(records),'seconds':round(time.perf_counter()-began,3),'queries':stats(values)},values

    try:
        report['controlled_mutex_ms']={'serialized':controlled(m.connection),'wal_read':controlled(real_read),'writer_hold_ms':400}
        report['queries_with_small_background_transactions']={'serialized':background(m.connection),'wal_read':background(real_read)}
        if args.probe_samples:
            observed={'serialized':[],'wal_read':[]};samples={'serialized':[],'wal_read':[]}
            for name,factory in [('serialized',m.connection),('wal_read',real_read),('wal_read',real_read),('serialized',m.connection)]:
                result,values=probing(factory);observed[name].append(result);samples[name].extend(values)
            report['queries_during_real_probes']={name:{'runs':runs,'queries':stats(samples[name])} for name,runs in observed.items()}
            report['probe_order']=['serialized','wal_read','wal_read','serialized']
        began=time.perf_counter();m.scanner.start(None,lambda manager:m.run_scan(m.roots(False),manager));m.scanner.thread.join(15)
        report['incremental_metadata']={'seconds':round(time.perf_counter()-began,3),'job':m.scanner.snapshot(),'thumbnail_status':m.thumbnail_service.snapshot()}
        if m.scanner.busy():raise RuntimeError('Incremental metadata did not complete')
        began=time.perf_counter();m.scanner.start(None,lambda manager:m.run_scan(m.roots(False),manager));m.scanner.thread.join(15)
        report['unchanged_incremental']={'seconds':round(time.perf_counter()-began,3),'processed':m.scanner.snapshot()['processed'],'updated':m.scanner.snapshot()['updated']}
        # Do not print private filenames. Reproduce the previous failure on its original ID.
        sample=next((row for row in rows if row['id']==294),None)
        if sample:
            attempts=[]
            for point in [None,0,120]:
                m.retry_thumbnail(sample['id'],m.ThumbnailRetry(frame_time=point))
                key,_=m.thumbnail_service.jobs.next();began=time.perf_counter()
                success,error=m.process_thumbnail(key,threading.Event(),m.thumbnail_service.gate)
                m.thumbnail_service.jobs.finish(key,success,error)
                attempts.append({'frame_time':point,'success':success,'seconds':round(time.perf_counter()-began,3),'error':error})
            report['previous_failed_av1']={'media_id':294,'attempts':attempts}
        report['database_timing']=m.database_timing.report()
    finally:
        m.scanner.close();m.thumbnail_service.close();m.playback.close()
        after,_=inventory(root)
        report['source_check']={'added':sum(p not in before for p in after),'removed':sum(p not in after for p in before),
            'size_or_mtime_changed':sum(after[p]!=value for p,value in before.items() if p in after)}
        (folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({**{k:v for k,v in report.items() if k not in ['database_timing','incremental_metadata']},
            'incremental_seconds':report.get('incremental_metadata',{}).get('seconds'),'report':str(folder/'report.json')},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
