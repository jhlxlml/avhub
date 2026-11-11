"""Actual pinned-SQLite I/O on owned schemas; legacy mode is a labelled reference."""
import ast
import inspect
import json
import os
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

root=Path(__file__).resolve().parents[1]
if sys.version_info<(3,12):raise SystemExit('This explicit-transaction benchmark requires Python 3.12+ (desktop: 3.13)')
directory=Path(tempfile.mkdtemp(prefix='bootstrap-benchmark-',dir=root/'build'))
os.environ['AVHUB_DATA_DIR']=str(directory/'profile')
from app import main as m

# Same real bootstrap SQL/installers; remove only explicit transaction mode to
# reproduce its prior legacy executescript transaction behavior. Not an old EXE.
tree=ast.parse(inspect.getsource(m.bootstrap))
body=next(node for node in tree.body[0].body if isinstance(node,ast.With)).body
body[:]=[node for node in body if not(isinstance(node,ast.If) and any(isinstance(child,ast.Assign) and any(isinstance(target,ast.Attribute) and target.attr=='autocommit' for target in child.targets) for child in node.body))]
namespace=dict(vars(m));exec(compile(tree,'<legacy-bootstrap-reference>','exec'),namespace)
reference=namespace['bootstrap']
report={'kind':'actual-bootstrap-io','scope':'Generated empty schemas, alternating modes; legacy reference differs only in transaction handling. Not a cold-disk or prior-EXE claim.','rows':[],'passed':False}
for iteration in range(6):
    for label in (['legacy-reference','atomic'] if iteration%2==0 else ['atomic','legacy-reference']):
        target=directory/f'{label}-{iteration}.db'
        with closing(sqlite3.connect(target)) as keep:
            keep.execute('PRAGMA journal_mode=WAL').fetchone()
            keep.execute('SELECT COUNT(*) FROM sqlite_schema').fetchone()
            with patch.object(m,'DB',target):
                started=time.perf_counter();(reference if label=='legacy-reference' else m.bootstrap)();elapsed=(time.perf_counter()-started)*1000
            wal=Path(str(target)+'-wal').read_bytes();assert len(wal)>=32
            page_size=int.from_bytes(wal[8:12],'big');frame_size=24+page_size
            assert (len(wal)-32)%frame_size==0
            commits=sum(int.from_bytes(wal[offset+4:offset+8],'big')>0 for offset in range(32,len(wal),frame_size))
            assert keep.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            schema=keep.execute('SELECT type,name,sql FROM sqlite_schema ORDER BY name').fetchall()
            report['rows'].append({'iteration':iteration,'mode':label,'ms':elapsed,'walBytes':len(wal),'commits':commits,'schema':schema})
            if label=='atomic':assert commits==1
for iteration in range(6):
    pair=[r for r in report['rows'] if r['iteration']==iteration]
    assert pair[0]['schema']==pair[1]['schema']
report['passed']=True
(directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(directory/'report.json')
