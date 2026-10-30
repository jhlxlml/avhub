"""Rebuild the backend from the already verified application source replay.

Uses existing Python/build tools and pinned binary inputs. This does not rebuild
SQLite, the independent FFmpeg CLI, libmpv or their toolchains from source.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

from backend_replay_verification import verify

ROOT=Path(__file__).resolve().parents[1]


def main():
    replay=Path(json.loads((ROOT/'build/application-build-replay-latest.json').read_text())['folder'])
    if not replay.resolve().is_relative_to((ROOT/'build').resolve()) or replay.is_symlink():raise ValueError('Owned replay directory required')
    prior=json.loads((replay/'replay-report.json').read_text())
    if not prior['passed']:raise ValueError('Frontend/Electron replay must pass first')
    if (replay/'build/backend-dist').exists():raise ValueError('Replay backend already exists; preserve this evidence and start a new replay')
    inventory=json.loads((Path(prior['source'])/'source-review-inventory.json').read_text())
    # Replayed builds intentionally rewrite generated build-info.json only; all
    # source input members remain the frozen, verified copies.
    for item in inventory['files']:
        file=replay/item['path']
        if hashlib.file_digest(file.open('rb'),'sha256').hexdigest()!=item['sha256']:raise ValueError('Replay source changed: '+item['path'])
    report={'kind':'frozen-application-backend-build-replay','source':prior['source'],'replay':str(replay),'passed':False,
            'frozenSourceMembersVerified':len(inventory['files']),
            'usesExistingPythonToolchain':True,'pinnedBinaryInputsReused':[],'nativeRuntimeRebuilt':False,'cleanEnvironment':False}
    try:
        manifest=json.loads((replay/'app/sqlite-runtime.json').read_text())
        sqlite=ROOT/'bin/sqlite'/manifest['version']/'sqlite3.dll'
        digest=hashlib.file_digest(sqlite.open('rb'),'sha256').hexdigest()
        if digest!=manifest['dll_sha256']:raise ValueError('Pinned SQLite input changed')
        private=replay/'bin/sqlite'/manifest['version']/'sqlite3.dll';private.parent.mkdir(parents=True);shutil.copyfile(sqlite,private)
        report['pinnedBinaryInputsReused'].append({'name':'sqlite3.dll','sha256':digest})
        for name in ('ffmpeg.exe','ffprobe.exe'):
            report['pinnedBinaryInputsReused'].append({'name':name,'sha256':hashlib.file_digest((ROOT/'bin'/name).open('rb'),'sha256').hexdigest()})
        build=replay/'build';build.mkdir(exist_ok=True)
        args=[sys.executable,'scripts/python-runtime.py','-m','PyInstaller','--noconfirm','--clean','--onedir','--console','--name','AVHubServer',
              '--distpath',str(build/'backend-dist'),'--workpath',str(build/'pyinstaller'),'--specpath',str(build/'spec'),
              '--runtime-hook',str(replay/'scripts/pyi-sqlite-runtime.py')]
        for source,target in [(replay/'app/static','app/static'),(replay/'app/build-info.json','app'),(replay/'app/sqlite-runtime.json','app'),
                              *((replay/'bin'/name,'licenses') for name in ('SQLite-LICENSE.txt','SQLite-BUILD-INFO.txt','FFmpeg-LICENSE.txt','FFmpeg-BUILD-INFO.txt'))]:
            args+=['--add-data',str(source)+';'+target]
        for source,target in [(private,'.'),(ROOT/'bin/ffmpeg.exe','bin'),(ROOT/'bin/ffprobe.exe','bin')]:args+=['--add-binary',str(source)+';'+target]
        for name in ('fastapi','starlette','uvicorn','pydantic'):args+=['--collect-all',name]
        args+=['run.py']
        with (build/'backend-replay-build.log').open('w',encoding='utf-8') as log:subprocess.run(args,cwd=replay,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=180)
        for command in [['scripts/verify-bundled-sqlite.py'],['scripts/python-runtime.py','scripts/prepare-backend-notices.py','--install'],['scripts/folder-portable.py','--verify-backend-notices']]:
            subprocess.run([sys.executable,*command],cwd=replay,check=True,timeout=30)
        verification=verify(replay,prior['buildId'],report['pinnedBinaryInputsReused'])
        report['verificationReceipt']=verification['receipt']
        if not verification['passed']:raise ValueError(verification.get('error','Backend executable verification failed'))
        report['passed']=True
    finally:
        (replay/'backend-replay-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'passed':report['passed'],'report':str(replay/'backend-replay-report.json')}))


if __name__=='__main__':main()
