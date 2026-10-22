"""Owned synthetic FULL/WAL lifecycle comparison; never opens a user library."""
import argparse
import json
import sqlite3
import tempfile
import time
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.db_lifecycle import WalAnchor


def measure(folder, name, count, anchored):
    target=folder/(name+'.db')
    with sqlite3.connect(target) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE media(id INTEGER PRIMARY KEY,title TEXT,progress REAL,updated_at INTEGER)')
        db.executemany('INSERT INTO media VALUES(?,?,0,0)',((i,'Owned sample '+str(i)+' x'*40) for i in range(1,2001)))
        db.execute('CREATE INDEX progress_order ON media(updated_at DESC,id)')
    db.close()
    keeper=WalAnchor() if anchored else None
    if keeper:
        keeper.start(target);assert keeper.status()['connected']
        assert not keeper.connection.in_transaction
    rows=[]
    try:
        for index in range(count):
            began=time.perf_counter()
            if keeper:keeper.ensure(target)
            db=sqlite3.connect(target)
            sync=db.execute('PRAGMA synchronous').fetchone()[0]
            assert sync==2, 'Benchmark must preserve SQLite FULL durability'
            db.execute('UPDATE media SET progress=?,updated_at=? WHERE id=?',(index*.25,index,index%2000+1))
            body=time.perf_counter();db.commit();committed=time.perf_counter()
            wal=target.with_name(target.name+'-wal');wal_after_commit=wal.stat().st_size if wal.exists() else 0
            db.close();closed=time.perf_counter()
            rows.append({'commit_ms':(committed-body)*1000,'close_ms':(closed-committed)*1000,
                'total_ms':(closed-began)*1000,'wal_after_commit':wal_after_commit,'wal_after_close':wal.stat().st_size if wal.exists() else 0})
    finally:
        began=time.perf_counter()
        if keeper:keeper.close()
        keeper_close_ms=(time.perf_counter()-began)*1000
    check=sqlite3.connect(target)
    try:
        assert check.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert check.execute('SELECT MAX(updated_at) FROM media').fetchone()[0]==count-1
    finally:check.close()
    summary={}
    for key in ('commit_ms','close_ms','total_ms'):
        values=sorted(row[key] for row in rows)
        summary[key]={'median':values[len(values)//2],'p95':values[min(len(values)-1,int(len(values)*.95))],'max':values[-1]}
    return {'anchored':anchored,'implementation':'WalAnchor' if anchored else 'short-connections','count':count,'synchronous':'FULL','keeper_close_ms':keeper_close_ms,'summary':summary,
        'wal_removed_after_close':sum(row['wal_after_close']==0 for row in rows),'samples':rows}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--rounds',type=int,default=200);args=parser.parse_args()
    if not 50<=args.rounds<=1000:parser.error('rounds must be between 50 and 1000')
    # Keep evidence in build, where it can be examined after the source DBs are
    # automatically cleaned. Both databases and their WAL files are owned here.
    root=Path(__file__).resolve().parents[1];artifact=root/'build'/f'sqlite-lifecycle-{time.time_ns()}'
    artifact.mkdir(parents=True)
    report={'sqlite':sqlite3.sqlite_version,'runs':[],'limitations':[
        'Synthetic 2000-row database and sequential writes, not the real library or a long-tail reproduction.',
        'FULL durability and default auto-checkpoint retained in both variants; tests the production WalAnchor implementation.',
        'WAL removal is observed, not a physical I/O/fsync counter. Run order can affect OS cache and storage latency.',
    ]}
    with tempfile.TemporaryDirectory(prefix='avhub-sqlite-lifecycle-') as temporary:
        for index,anchored in enumerate([False,True,True,False]):
            report['runs'].append(measure(Path(temporary),str(index),args.rounds,anchored))
    (artifact/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    for run in report['runs']:print(json.dumps({key:value for key,value in run.items() if key!='samples'}))
    print('Lifecycle evidence:',artifact/'report.json')


if __name__=='__main__':main()
