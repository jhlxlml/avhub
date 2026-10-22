"""Isolated metadata batching experiment. NOT the product scanner or playback acceptance."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


class BatchWriter:
    """Experimental SQL workload on the real schema; no production entry point.

    Uses production transaction/gate/enqueue helpers, but intentionally does not
    claim to run scan_file, FFprobe, identity review or a directory traversal.
    """
    def __init__(self,module,service):self.app=module;self.service=service

    def prepare(self,path,metadata,root_id=1):
        path=Path(path).resolve();stamp=path.stat()
        return {'path':path,'stat':stamp,'identity':self.app.media_identity.encoded(stamp),
            'root_id':root_id,'metadata':metadata,'title':self.app.parse_title(path)}

    def write(self,db,item):
        m=self.app;path=item['path'];stamp=item['stat'];meta=item['metadata'];now=time.time()
        if m.media_identity.encoded(path.stat())!=item['identity']:raise ValueError('Owned source changed')
        old=db.execute('SELECT id,file_state FROM media WHERE path=?',(str(path),)).fetchone()
        if old and old['file_state']!='normal':raise ValueError('Owned source is not normal')
        color={**meta.get('video_color',{}),'source_size':stamp.st_size,'source_modified':stamp.st_mtime}
        technical=(item['root_id'],path.name,path.suffix.lower(),stamp.st_size,stamp.st_mtime,
            meta['duration'],meta['width'],meta['height'],meta['video_codec'],
            json.dumps(meta['audio_tracks']),json.dumps(meta['subtitles']),json.dumps(color))
        if old:
            media_id=old['id']
            db.execute('''UPDATE media SET root_id=?,name=?,ext=?,size=?,modified=?,duration=?,width=?,height=?,
                video_codec=?,audio_tracks=?,subtitles=?,video_color=?,missing=0,updated_at=? WHERE id=?''',
                (*technical,now,media_id))
        else:
            media_id=m.next_media_id(db);title,kind,season,episode=item['title']
            db.execute('''INSERT INTO media(id,path,root_id,name,title,kind,season,episode,ext,size,modified,
                duration,width,height,video_codec,audio_tracks,subtitles,video_color,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (media_id,str(path),technical[0],technical[1],title,kind,season,episode,*technical[2:],now,now))
        db.execute('UPDATE media SET source_identity=? WHERE id=?',(item['identity'],media_id))
        m.series_library.assign(db,media_id)
        self.service.jobs.schedule_in(db,media_id)
        return media_id

    def commit(self,items,cancelled=None):
        if not isinstance(items,(list,tuple)) or not 1<=len(items)<=8:raise ValueError('Owned batch must contain 1..8 records')
        m=self.app;ids=[]
        def check():
            if cancelled is not None and cancelled.is_set():raise m.ScanCancelled()
        check()
        with m.database_timing.scope('scan-media'),self.service.scan_write(m.connection) as db:
            check()
            for item in items:
                check();ids.append(self.write(db,item))
            check()
        # No in-memory completion acknowledgement before the real commit.
        return ids


def summary(values):
    values=sorted(values)
    return {'count':len(values),'median_ms':values[len(values)//2],
        'p95_ms':values[min(len(values)-1,int(len(values)*.95))],'max_ms':values[-1]} if values else None


def metadata():
    return {'duration':120,'width':1920,'height':1080,'video_codec':'h264',
        'audio_tracks':[{'index':1,'codec_name':'aac','language':'und','channels':2}],
        'subtitles':[],'video_color':{'dynamic_range':'SDR','bit_depth':8,'color_space':'bt709'}}


@contextmanager
def isolated_library(m,profile,source):
    from app.db_timing import DatabaseTiming
    from app.db_write_gate import SavePriorityLock
    profile.mkdir();m.DATA=profile;m.DB=profile/'library.db';m.THUMBS=profile/'thumbnails'
    m.THUMBS.mkdir();m.DB_LOCK=SavePriorityLock();m.database_timing=DatabaseTiming();m.bootstrap()
    with m.connection() as db:
        db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)',(str(source),))
        db.execute('''INSERT INTO media(id,path,name,title,duration,created_at,updated_at)
            VALUES(1,?,'owned-save-target.mp4','Owned save target',120,0,0)''',(str(source/'owned-save-target.mp4'),))
        assert db.execute('PRAGMA synchronous').fetchone()[0]==2
        assert db.execute('PRAGMA wal_autocheckpoint').fetchone()[0]==1000
    m.db_anchor.start(m.DB)
    try:yield
    finally:m.db_anchor.close()


def measure(m,profile,source,paths,batch_size):
    from app.scan_jobs import ThumbnailService
    with isolated_library(m,profile,source):
        service=ThumbnailService(m.thumbnail_connection,m.process_thumbnail,m.read_connection,
            scope=lambda:m.database_timing.current_scope())
        writer=BatchWriter(m,service);state=threading.Condition();done=threading.Event()
        processed=0;saves=[];errors=[];batches=[];targets=[len(paths)*i//25 for i in range(1,25)]
        def save_loop():
            try:
                for number,target in enumerate(targets,1):
                    with state:
                        state.wait_for(lambda:processed>=target or done.is_set())
                        if processed<target:return
                    during_scan=not done.is_set();began=time.perf_counter()
                    result=m.save_progress(1,m.ProgressInput(progress=number,updated_at=number+1000000))
                    elapsed=(time.perf_counter()-began)*1000
                    assert result['progress']==number
                    saves.append({'request':number,'target':target,'during_scan':during_scan,
                        'elapsed_ms':elapsed,'progress':result['progress']})
            except BaseException as error:errors.append(type(error).__name__)
        saver=threading.Thread(target=save_loop,name='avhub-batch-save-harness');saver.start()
        began=time.perf_counter();scan_end=began
        try:
            for offset in range(0,len(paths),batch_size):
                preparing=time.perf_counter()
                prepared=[writer.prepare(path,metadata()) for path in paths[offset:offset+batch_size]]
                ready=time.perf_counter();ids=writer.commit(prepared)
                committed=time.perf_counter()
                batches.append({'size':len(ids),'prepare_ms':(ready-preparing)*1000,
                    'ready_to_commit_ms':(committed-ready)*1000})
                with state:processed+=len(ids);state.notify_all()
                scan_end=committed
        finally:
            done.set()
            with state:state.notify_all()
            saver.join(15)
            if saver.is_alive():raise RuntimeError('Owned saver did not stop')
        finished=time.perf_counter();assert not errors,errors;assert len(saves)==24
        with m.read_connection() as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            assert db.execute('SELECT COUNT(*) FROM media').fetchone()[0]==len(paths)+1
            assert db.execute("SELECT COUNT(*) FROM thumbnail_jobs WHERE state='pending'").fetchone()[0]==len(paths)
            assert db.execute('SELECT progress FROM media WHERE id=1').fetchone()[0]==24
        timing=m.database_timing.report();group=timing['operation_lifetime']['groups']['serialized:scan-media']
        assert group['count']==len(batches);assert group['changed_rows']==len(paths)*4
        began_close=time.perf_counter();m.db_anchor.close();close_ms=(time.perf_counter()-began_close)*1000
        wal=profile/'library.db-wal';assert not wal.exists() or wal.stat().st_size==0
        return {'batch_size':batch_size,'scan_ms':(scan_end-began)*1000,'all_work_ms':(finished-began)*1000,
            'committed_records':processed,'transactions':len(batches),'changed_rows':group['changed_rows'],
            'saves_during_scan':sum(s['during_scan'] for s in saves),'save_summary':summary([s['elapsed_ms'] for s in saves]),
            'batch_summary':summary([b['ready_to_commit_ms'] for b in batches]),'batches':batches,'saves':saves,
            'database_timing':timing,'publication_gate':service.gate.report(),'write_queue':m.DB_LOCK.status(),
            'anchor_close_ms':close_ms,'completed':True}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--videos',type=int,default=1200);args=parser.parse_args()
    if not 384<=args.videos<=2400:parser.error('videos must be between 384 and 2400')
    artifact=ROOT/'build'/f'scan-batches-{time.time_ns()}';artifact.mkdir(parents=True)
    report={'completed':False,'source_unchanged':False,'runs':[],'limitations':[
        'Synthetic metadata/owned placeholder files, NOT video decoding, FFprobe, directory traversal or Electron acceptance.',
        'Uses the real application schema, FULL connections, WAL anchor, save-priority gate, series assign and durable thumbnail enqueue.',
        'Experimental SQL workload is not scan_file. No product defaults, API, batching settings or playback paths changed.',
        '24 real save_progress calls per run use committed-count targets; thread scheduling and request timing differ. No artificial response delays.',
        'Batch fill excludes real probe latency; no claim about full application import or first-cover latency.',
        'Balanced fixed order 1/4/8/8/4/1, not randomized cold-cache or physical I/O attribution.',
    ]}
    try:
        with tempfile.TemporaryDirectory(prefix='avhub-scan-batch-experiment-') as temporary:
            owned=Path(temporary);source=owned/'sources';source.mkdir();initial=owned/'initial';initial.mkdir()
            # Must be set before importing app.main: never open the daily library.
            os.environ['AVHUB_DATA_DIR']=str(initial)
            from app import main as m
            assert m.DATA.resolve()==initial.resolve()
            report['sqlite']=m.sqlite3.sqlite_version
            paths=[source/f'Owned metadata {i:05}.mp4' for i in range(args.videos)]
            for path in paths:path.write_bytes(b'owned placeholder, not a playable video')
            def signature():
                return [(path.name,path.stat().st_size,path.stat().st_mtime_ns,
                    hashlib.sha256(path.read_bytes()).hexdigest()) for path in paths]
            before=signature()
            for index,size in enumerate([1,4,8,8,4,1]):
                result=measure(m,owned/f'run-{index}',source,paths,size);report['runs'].append(result)
                print(json.dumps({key:result[key] for key in ('batch_size','scan_ms','all_work_ms','transactions','save_summary','saves_during_scan')}),flush=True)
            assert signature()==before;report['source_unchanged']=True;report['completed']=True
    finally:
        (artifact/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
        print('Batch experiment evidence:',artifact/'report.json',flush=True)


if __name__=='__main__':main()
