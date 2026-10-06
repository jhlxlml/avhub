"""Repeated real image cancellation; each subprocess owns an isolated index."""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

PROJECT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--index',required=True)
parser.add_argument('--repeat',type=int,default=10);args=parser.parse_args()
if not 1<=args.repeat<=100:parser.error('repeat must be 1..100')
folder=PROJECT/'build'/f'stability-seven-{time.time_ns()}';folder.mkdir(parents=True)
report={'runs':[],'requested':args.repeat}
try:
    for number in range(args.repeat):
        result=subprocess.run([sys.executable,'scripts/verify-scan-resume.py','--source',args.source,'--index',args.index],cwd=PROJECT,
            capture_output=True,text=True,encoding='utf-8',timeout=90,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        lines=result.stdout.strip().splitlines();record=json.loads(lines[-1]) if lines else {'error':'no report','stderr':result.stderr[-2000:]}
        record['exit_code']=result.returncode;report['runs'].append(record)
        print(json.dumps({'run':number+1,'exit_code':result.returncode,'cancel_ms':record.get('cancel_ms'),'resume_ms':record.get('resume_ms')}),flush=True)
        if result.returncode:raise RuntimeError('Cancellation failed; retained original report/stack')
finally:
    report['passed']=len(report['runs'])==args.repeat and all(row['exit_code']==0 and row.get('source_unchanged') for row in report['runs'])
    destination=folder/'report.json';destination.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'passed':report['passed'],'report':str(destination)}),flush=True)
