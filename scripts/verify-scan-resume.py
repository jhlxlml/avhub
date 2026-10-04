"""Cancel real image decoding, then resume the persisted jobs in an isolated index."""
import argparse
import faulthandler
import json
import os
import sqlite3
import sys
import threading
import time
import uuid
from pathlib import Path

PROJECT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(PROJECT))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True);parser.add_argument('--index',type=Path,required=True)
    args=parser.parse_args();root=args.source.resolve(strict=True);index=args.index.resolve(strict=True)
    if not index.is_relative_to((PROJECT/'build'/'scan-benchmarks').resolve()):parser.error('Use a benchmark index, not the daily library')
    folder=PROJECT/'build'/'scan-resume-verification'/uuid.uuid4().hex
    if folder.resolve().is_relative_to(root):parser.error('Output cannot be inside source')
    os.environ['AVHUB_DATA_DIR']=str(folder/'data')
    from app import main as m
    from app.scan_jobs import ThumbnailJobs,ThumbnailService
    records=[];originals={}
    with sqlite3.connect(index.as_uri()+'?mode=ro',uri=True) as db:
        db.row_factory=sqlite3.Row
        for codec in ['av1','vp9','h264']:
            row=db.execute('SELECT * FROM media WHERE video_codec=? AND duration>5 ORDER BY width*height DESC,id LIMIT 1',(codec,)).fetchone()
            if row:records.append(dict(row))
    with m.connection() as db:
        db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)',(str(root),))
        for record in records:
            source=Path(record['path']).resolve(strict=True)
            if not source.is_relative_to(root):raise ValueError('Source outside approved directory')
            stat=source.stat();originals[source]=(stat.st_size,stat.st_mtime_ns)
            record.update(thumbnail=None,custom_cover=None,root_id=1)
            columns=list(record)
            db.execute('INSERT INTO media('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',[record[key] for key in columns])
    jobs=ThumbnailJobs(m.connection,[1]);entered=threading.Event()
    for row in records:jobs.schedule(row['path'],row['id'])
    original_popen=m.subprocess.Popen
    def started_process(*args,**kwargs):
        process=original_popen(*args,**kwargs);entered.set();return process
    m.subprocess.Popen=started_process
    def image(key,cancelled,gate):
        return m.process_thumbnail(key,cancelled,gate)
    service=ThumbnailService(m.connection,image,m.read_connection)
    report={'samples':len(records),'source':'explicit authorized root, sample names omitted','build':m.BUILD}
    try:
        service.start()
        if not entered.wait(5):raise RuntimeError('No image worker')
        time.sleep(.05);began=time.perf_counter();service.pause();service.close()
        if service.thread.is_alive():
            with (folder/'stuck-threads.txt').open('w',encoding='utf-8') as log:faulthandler.dump_traceback(file=log)
            raise RuntimeError('Cancellation did not finish; see stuck-threads.txt')
        report.update(cancel_ms=round((time.perf_counter()-began)*1000),cancel_state=service.snapshot(),pending_after_cancel=jobs.count())
        if not jobs.count():raise RuntimeError('No persisted job to resume')
        service=ThumbnailService(m.connection,image,m.read_connection);service.start()
        if not service.snapshot()['paused']:raise RuntimeError('Pause was not durable')
        began=time.perf_counter();service.pause(False)
        while jobs.count() and time.perf_counter()-began<60:time.sleep(.05)
        report.update(resume_ms=round((time.perf_counter()-began)*1000),resume_state=service.snapshot(),
            pending_after_resume=jobs.count(),errors=service.snapshot()['failed'])
        report['valid_images']=sum(m.valid_thumbnail(m.THUMBS/f"{row['id']}.jpg") for row in records)
        if report['pending_after_resume'] or report['valid_images']!=len(records):raise RuntimeError('Image recovery incomplete')
    finally:
        service.close();m.playback.close()
        m.subprocess.Popen=original_popen
        report['source_unchanged']=all((path.stat().st_size,path.stat().st_mtime_ns)==value for path,value in originals.items())
        (folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps({**report,'report':str(folder/'report.json')}),flush=True)


if __name__=='__main__':main()
