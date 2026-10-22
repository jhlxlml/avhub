"""Owned serialized FULL/WAL experiment. No production checkpoint policy changes."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.db_lifecycle import WalAnchor


def summary(values):
    values=sorted(values)
    return {'median_ms':values[len(values)//2],'p95_ms':values[min(len(values)-1,int(len(values)*.95))],'max_ms':values[-1]} if values else None


def measure(folder,name,count,plan=None):
    target=folder/(name+'.db');wal=target.with_name(target.name+'-wal')
    with closing(sqlite3.connect(target)) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''CREATE TABLE media(id INTEGER PRIMARY KEY,title TEXT,root_id INTEGER,modified REAL,metadata TEXT);
            CREATE INDEX media_title ON media(title,id);CREATE INDEX media_root ON media(root_id,id);
            CREATE INDEX media_date ON media(modified,id);
            CREATE TABLE progress(id INTEGER PRIMARY KEY,value REAL);INSERT INTO progress VALUES(1,0);''')
        db.commit()
    anchor=WalAnchor();anchor.start(target);assert anchor.status()['connected']
    rows=[];resets=[];previous=None;maximum=0;payload=json.dumps({'owned_metadata':'x'*1800})
    try:
        for index in range(count):
            with closing(sqlite3.connect(target)) as db:
                assert db.execute('PRAGMA synchronous').fetchone()[0]==2
                default=db.execute('PRAGMA wal_autocheckpoint').fetchone()[0];assert default==1000
                if plan is not None:db.execute('PRAGMA wal_autocheckpoint=0')  # This disposable benchmark DB ONLY.
                db.execute('INSERT INTO media VALUES(?,?,?,?,?)',(index+1,f'Owned {index:05}',index%60,index,payload))
                if index%40==0:db.execute('UPDATE progress SET value=? WHERE id=1',(index,))
                began=time.perf_counter();db.commit();commit_ms=(time.perf_counter()-began)*1000
                began=time.perf_counter();checkpoint=None
                if plan is not None and index in plan:
                    checkpoint=tuple(db.execute('PRAGMA wal_checkpoint(PASSIVE)').fetchone())
                checkpoint_ms=(time.perf_counter()-began)*1000 if checkpoint is not None else 0
                # Header generation changes indicate WAL reuse, NOT a direct
                # duration measurement of SQLite's internal auto-checkpoint.
                with wal.open('rb') as handle:generation=handle.read(32)[16:24]
                if previous is not None and generation!=previous:resets.append(index)
                previous=generation;size=wal.stat().st_size;maximum=max(maximum,size)
                rows.append({'index':index,'commit_ms':commit_ms,'checkpoint_ms':checkpoint_ms,
                    'checkpoint':checkpoint,'wal_bytes':size})
        began=time.perf_counter();anchor.close();close_ms=(time.perf_counter()-began)*1000
        with closing(sqlite3.connect(target)) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            assert db.execute('SELECT COUNT(*) FROM media').fetchone()[0]==count
            assert db.execute('SELECT value FROM progress WHERE id=1').fetchone()[0]==((count-1)//40)*40
        return {'mode':'default' if plan is None else 'split-serialized','count':count,'resets':resets,
            'checkpoint_plan':sorted(plan) if plan is not None else None,'wal_max_observed':maximum,
            'anchor_close_ms':close_ms,'summary':{'commit':summary([r['commit_ms'] for r in rows]),
                'explicit_checkpoint':summary([r['checkpoint_ms'] for r in rows if r['checkpoint'] is not None])},'samples':rows}
    finally:anchor.close()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--writes',type=int,default=1000);args=parser.parse_args()
    if not 500<=args.writes<=3000:parser.error('writes must be between 500 and 3000')
    root=Path(__file__).resolve().parents[1];artifact=root/'build'/f'sqlite-checkpoint-{time.time_ns()}'
    artifact.mkdir(parents=True)
    report={'sqlite':sqlite3.sqlite_version,'completed':False,'runs':[],'limitations':[
        'Synthetic isolated metadata workload, not Electron or real-media acceptance. All commits stay FULL.',
        'All writes and checkpoints are serialized: no concurrent checkpoint experiment on an unpatched SQLite.',
        'Split mode disables auto-checkpoint only on its owned temporary DB and measures explicit PASSIVE checkpoints.',
        'The split schedule is inferred from baseline WAL generation reuse; it does not measure internal auto-checkpoint time by subtraction.',
        'Cache/order/system I/O can affect tails. No claim that every slow commit is a checkpoint or physical fsync.',
    ]}
    try:
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-checkpoint-') as temporary:
            folder=Path(temporary)
            baseline=measure(folder,'default-0',args.writes);report['runs'].append(baseline)
            plan={index-1 for index in baseline['resets']};assert plan,'Workload must cross a WAL reset'
            for name in ['split-1','split-2']:
                report['runs'].append(measure(folder,name,args.writes,plan))
            report['runs'].append(measure(folder,'default-3',args.writes));report['completed']=True
    finally:
        (artifact/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    for run in report['runs']:print(json.dumps({k:v for k,v in run.items() if k!='samples'}))
    print('Checkpoint evidence:',artifact/'report.json')


if __name__=='__main__':main()
