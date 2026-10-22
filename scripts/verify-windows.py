"""Replay the workflow's source verification commands locally, never package/publish.

The workflow is the single command inventory. Tool installation, tag gates,
packaging and uploads stay in their explicit CI workflows.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import yaml

ROOT=Path(__file__).resolve().parents[1]
EXCLUDED={'Validate release tag before downloading tools','Require successful exact-commit release candidate',
          'Prepare pinned FFmpeg','Prepare and verify pinned private SQLite','Install locked/tested dependencies',
          'Install and verify pinned Electron runtime','Package only tags or explicit manual runs',
          'Actual portable EXE acceptance','Actual extracted folder ZIP acceptance','Checksums and source manifest'}


def plan(workflow):
    result=[]
    for step in workflow['jobs']['verify']['steps']:
        if 'run' not in step or step.get('name') in EXCLUDED:continue
        if 'if' in step:raise ValueError('New conditional verification step needs an explicit local replay decision')
        if '${{' in step['run']:raise ValueError('Cannot locally execute unexpanded workflow expressions')
        result.append((step['name'],step['run']))
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',action='store_true',help='Run source verification; without this flag only list commands')
    selection=parser.add_mutually_exclusive_group()
    selection.add_argument('--step',help='Run/list exactly one named verification step')
    selection.add_argument('--from-step',help='Run/list this verification step and every later source verification step')
    args=parser.parse_args()
    workflow=yaml.load((ROOT/'.github/workflows/windows.yml').read_text(encoding='utf-8'),Loader=yaml.BaseLoader)
    commands=plan(workflow)
    if args.step:
        commands=[item for item in commands if item[0]==args.step]
        if not commands:parser.error('Unknown source verification step; packaging/publishing cannot be replayed')
    if args.from_step:
        index=next((i for i,item in enumerate(commands) if item[0]==args.from_step),None)
        if index is None:parser.error('Unknown source verification start step')
        commands=commands[index:]
    if not args.execute:
        for name,command in commands:print(f'[{name}]\n{command}\n')
        return
    if os.name!='nt':raise SystemExit('Real Windows desktop verification requires Windows')
    powershell=shutil.which('pwsh') or shutil.which('powershell')
    if not powershell:raise SystemExit('PowerShell is required')
    # This mirrors deterministic hosted test behavior, not real update API testing.
    env={**os.environ,'CI':'true','PYTHONUTF8':'1'}
    for name,command in commands:
        print(f'[{name}]',flush=True)
        subprocess.run([powershell,'-NoProfile','-NonInteractive','-Command',
                        "$ErrorActionPreference = 'Stop'\n"+command+'\nexit $LASTEXITCODE'],
                       cwd=ROOT,env=env,check=True)


if __name__=='__main__':main()
