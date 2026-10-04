"""Read-only real-directory scan benchmark, with a new isolated index/cache."""
import argparse
import ctypes
import json
import os
import statistics
import sys
import threading
import time
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path

PROJECT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(PROJECT))


def inventory(root):
    """Never follow links/reparse directories into an unapproved source tree."""
    files={};errors=[];folders=0;skipped=0
    def failed(error):errors.append(type(error).__name__)
    for directory,dirs,names in os.walk(root,onerror=failed,followlinks=False):
        folders+=1
        safe=[]
        for name in dirs:
            path=Path(directory)/name
            try:
                if path.is_symlink() or getattr(path.lstat(),'st_file_attributes',0) & 0x400:skipped+=1;continue
                safe.append(name)
            except OSError as exc:errors.append(type(exc).__name__)
        dirs[:]=safe
        for name in names:
            path=Path(directory)/name
            try:
                stat=path.lstat()
                if getattr(stat,'st_file_attributes',0)&0x400:skipped+=1;continue
                files[str(path)]=(stat.st_size,stat.st_mtime_ns)
            except OSError as exc:errors.append(type(exc).__name__)
    return files,{'folders':folders,'files':len(files),'skipped_links':skipped,'errors':errors}


def memory():
    if os.name!='nt':return None
    class Counters(ctypes.Structure):
        _fields_=[('cb',ctypes.c_ulong),('PageFaultCount',ctypes.c_ulong)]+[(name,ctypes.c_size_t) for name in
            ['PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage',
             'QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage']]
    info=Counters();info.cb=ctypes.sizeof(info)
    kernel=ctypes.WinDLL('kernel32');kernel.GetCurrentProcess.restype=ctypes.c_void_p
    get=ctypes.WinDLL('psapi').GetProcessMemoryInfo
    get.argtypes=[ctypes.c_void_p,ctypes.POINTER(Counters),ctypes.c_ulong]
    return int(info.PeakWorkingSetSize) if get(kernel.GetCurrentProcess(),ctypes.byref(info),info.cb) else None


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--label',default='current')
    parser.add_argument('--max-seconds',type=int,default=1800)
    parser.add_argument('--cancel-after',type=float,default=1)
    args=parser.parse_args()
    root=args.source.resolve(strict=True)
    if not root.is_dir() or args.max_seconds<10 or args.cancel_after<0:parser.error('Invalid directory/duration')
    destination=PROJECT/'build'/'scan-benchmarks'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8])
    if destination.resolve().is_relative_to(root):parser.error('Benchmark output must not be inside the source directory')
    before,summary=inventory(root)
    destination.mkdir(parents=True)
    os.environ['AVHUB_DATA_DIR']=str(destination/'data')
    from app import main as m
    report={'label':args.label,'source':str(root),'build':m.BUILD,'scope':'real read-only directory, isolated DB/cache; Python queries, not browser decode',
        'inventory':summary,'video_count':sum(Path(p).suffix.lower() in m.VIDEO_EXTENSIONS for p in before),
        'video_bytes':sum(size for p,(size,_) in before.items() if Path(p).suffix.lower() in m.VIDEO_EXTENSIONS),
        'extensions':dict(Counter(Path(p).suffix.lower() for p in before if Path(p).suffix.lower() in m.VIDEO_EXTENSIONS)), 'runs':[]}
    print(json.dumps({key:report[key] for key in ['video_count','video_bytes','extensions','inventory']},ensure_ascii=False),flush=True)
    lock=threading.Lock();timings={'probe':[],'thumbnail':[]}
    for name in timings:
        original=getattr(m,name)
        def wrapped(*a,_name=name,_function=original,**kw):
            began=time.perf_counter()
            try:return _function(*a,**kw)
            finally:
                with lock:timings[_name].append((time.perf_counter()-began)*1000)
        setattr(m,name,wrapped)
    with m.connection() as db:db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)',(str(root),))
    entry={'id':1,'path':str(root)}
    m.thumbnail_service.start()

    def scan(label,cancel_after=None):
        with lock:
            for values in timings.values():values.clear()
        start=time.perf_counter();next_log=0;latencies=[];first_index=None;metadata_complete=None;points=[]
        m.scanner.start(1,lambda manager:m.run_scan([entry],manager))
        cancellation=None
        while m.scanner.busy():
            elapsed=time.perf_counter()-start
            if cancellation is None and ((cancel_after is not None and elapsed>=cancel_after) or elapsed>args.max_seconds):
                cancellation=time.perf_counter();m.scanner.cancel(preserve=True)
            began=time.perf_counter()
            page=m.media(page=1,page_size=48)
            latencies.append((time.perf_counter()-began)*1000)
            if page['total'] and first_index is None:first_index=elapsed
            snap=m.scanner.snapshot()
            if snap['discovery_done'] and metadata_complete is None:metadata_complete=elapsed
            if elapsed>=next_log:
                point={'run':label,'seconds':round(elapsed,1),'indexed':page['total'],
                    **{key:snap.get(key) for key in ['state','total','processed','updated','thumbnails_pending','error_count']}}
                points.append(point);print(json.dumps(point,ensure_ascii=False),flush=True)
                next_log=elapsed+10
            time.sleep(.25)
        snap=m.scanner.snapshot()
        def stats(values):
            values=sorted(values)
            return {'calls':len(values),'total_ms':round(sum(values),2),'p50_ms':round(statistics.median(values),2),
                'p95_ms':round(values[min(len(values)-1,int(len(values)*.95))],2),'max_ms':round(max(values),2)} if values else {'calls':0}
        record={'name':label,'seconds':round(time.perf_counter()-start,3),'first_index_seconds':first_index,
            'metadata_complete_seconds':metadata_complete or (time.perf_counter()-start if snap['state']=='completed' else None),'progress':points,
            'cancel_seconds':round(time.perf_counter()-cancellation,3) if cancellation else None,
            'state':snap['state'],'total':snap['total'],'processed':snap['processed'],'updated':snap['updated'],
            'error_count':snap['error_count'],'errors':snap['errors'],'queries':stats(latencies),'process_peak_rss_bytes':memory()}
        with lock:record['stages']={name:stats(values) for name,values in timings.items()}
        report['runs'].append(record)
        print(json.dumps({'completed':label,**{key:record[key] for key in ['seconds','state','processed','updated','error_count','queries','stages']}},ensure_ascii=False),flush=True)
        return snap['state']=='completed'

    try:
        if scan('first'):
            began=time.perf_counter()
            while m.thumbnail_service.snapshot()['pending'] and time.perf_counter()-began<args.max_seconds:time.sleep(.5)
            report['background_thumbnails']={'drain_seconds':round(time.perf_counter()-began,3),**m.thumbnail_service.snapshot()}
            report['database_timing']=m.database_timing.report()
            scan('incremental')
            if args.cancel_after:
                scan('cancel',args.cancel_after)
                scan('resume')
        with m.connection() as db:
            report['indexed']=db.execute('SELECT COUNT(*) FROM media').fetchone()[0]
            report['technical']=[dict(row) for row in db.execute('SELECT ext,video_codec,COUNT(*) AS count,MAX(height) AS max_height FROM media GROUP BY ext,video_codec')]
        report['thumbnail_files']=len(list(m.THUMBS.glob('*.jpg')))
        report['database_bytes']=m.DB.stat().st_size
    finally:
        m.scanner.close();m.thumbnail_service.close();m.playback.close()
        after,after_summary=inventory(root)
        report['source_check']={'added':sum(p not in before for p in after),'removed':sum(p not in after for p in before),
            'size_or_mtime_changed':sum(after[p]!=value for p,value in before.items() if p in after),
            'after_inventory':after_summary,'verification':'metadata of ALL files, not full-file hashes; outside applications may independently change downloads'}
        (destination/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'report':str(destination/'report.json'),'source_check':report['source_check']},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
