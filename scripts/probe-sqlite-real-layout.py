"""Minimal old/new REAL record comparison; generated single-leaf databases only."""
import argparse
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def varint(data,offset):
    value=0
    for n in range(9):
        byte=data[offset+n]
        if n==8:return (value<<8)|byte,offset+n+1
        value=(value<<7)|(byte&127)
        if byte<128:return value,offset+n+1
    raise ValueError('Invalid owned record varint')


def worker(engine,target,layout='plain'):
    target=Path(target).resolve()
    if not target.parent.name.startswith('avhub-sqlite-real-') or target.name!='real-layout.db' or target.exists():
        raise ValueError('Only a newly owned fixture is accepted')
    if engine=='private':
        from app.sqlite_runtime import initialize
        initialize()
    import sqlite3
    from contextlib import closing
    with closing(sqlite3.connect(target)) as db:
        db.execute('CREATE TABLE sample(id INTEGER PRIMARY KEY,value REAL,label TEXT'+(' UNIQUE' if layout=='unique' else '')+')')
        if layout=='index':db.execute('CREATE INDEX sample_label ON sample(label)')
        if layout=='real_index':db.execute('CREATE INDEX sample_value ON sample(value)')
        db.executemany('INSERT INTO sample VALUES(?,?,?)',[
            (1,0,'integer-zero'),(2,0.0,'float-zero'),(3,100,'integer-hundred'),
            (4,100.0,'float-hundred'),(5,.125,'fraction'),(6,1700000000.25,'fractional-epoch')])
        db.commit()
        rows=[{'id':r[0],'value':r[1],'type':r[2],'label':r[3]} for r in db.execute('SELECT id,value,typeof(value),label FROM sample ORDER BY id')]
        page=db.execute("SELECT rootpage FROM sqlite_schema WHERE name='sample'").fetchone()[0]
        size=db.execute('PRAGMA page_size').fetchone()[0]
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    with target.open('rb') as file:file.seek((page-1)*size);data=file.read(size)
    base=100 if page==1 else 0
    assert data[base]==13,'The tiny fixture must remain a single table leaf'
    for n in range(struct.unpack_from('>H',data,base+3)[0]):
        offset=struct.unpack_from('>H',data,base+8+n*2)[0]
        payload,offset=varint(data,offset);identity,offset=varint(data,offset)
        header,start=varint(data,offset);types=[]
        while start<offset+header:
            value,start=varint(data,start);types.append(value)
        row=next(row for row in rows if row['id']==identity)
        row.update(serial_type=types[1],record_payload=payload)
    return {'sqlite':sqlite3.sqlite_version,'layout':layout,'rows':rows}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--worker',choices=['host','private']);parser.add_argument('--target');parser.add_argument('--layout',choices=['plain','unique','index','real_index'],default='plain');args=parser.parse_args()
    if args.worker:
        print(json.dumps(worker(args.worker,args.target,args.layout)));return
    results=[]
    for engine in ['host','private']:
        for layout in ['plain','unique','index','real_index']:
            with tempfile.TemporaryDirectory(prefix='avhub-sqlite-real-') as owned:
                result=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--worker',engine,'--target',str(Path(owned)/'real-layout.db'),'--layout',layout],
                    cwd=ROOT,capture_output=True,encoding='utf-8',timeout=20)
                if result.returncode:raise RuntimeError(result.stderr)
                results.append(json.loads(result.stdout))
    artifact=ROOT/'build'/f'sqlite-real-layout-{time.time_ns()}.json'
    artifact.parent.mkdir(parents=True,exist_ok=True)
    with artifact.open('x',encoding='utf-8') as file:json.dump(results,file,indent=2)
    print(json.dumps(results));print('Evidence:',artifact)


if __name__=='__main__':main()
