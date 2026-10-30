"""Run an owned rebuilt backend; keep verification separate from compilation."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
from urllib.error import URLError,HTTPError
from urllib.request import Request,urlopen


def verify(replay,expected_build,binary_inputs,*,bundle=None,frontend=None):
    folder=Path(tempfile.mkdtemp(prefix='backend-executable-verification-',dir=replay/'build'))
    bundle=bundle or replay/'build/backend-dist/AVHubServer';frontend=frontend or replay/'app/static';process=None
    report={'kind':'actual-replayed-backend-executable-verification','passed':False,'compiledInThisVerification':False,'receipt':str(folder/'report.json')}
    try:
        with socket.socket() as listener:listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
        token=secrets.token_hex(24);env={**os.environ,'AVHUB_DATA_DIR':str(folder/'data'),'AVHUB_SESSION_TOKEN':token}
        with (folder/'service.log').open('w',encoding='utf-8') as log:
            process=subprocess.Popen([str(bundle/'AVHubServer.exe'),'--port',str(port)],cwd=bundle,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
            deadline=time.monotonic()+20;health=None
            while time.monotonic()<deadline and process.poll() is None:
                try:
                    with urlopen('http://127.0.0.1:'+str(port)+'/api/health',timeout=1) as response:health=json.load(response)
                except URLError:time.sleep(.1);continue
                break
            if not health or health.get('build_id')!=expected_build or not health.get('frozen') or health['sqlite_runtime'].get('verified') is not True:raise ValueError('Replayed executable health failed')
            report['health']=health
            url='http://127.0.0.1:'+str(port)+'/third-party/frontend-notices.json'
            try:
                with urlopen(url,timeout=3):raise ValueError('Unauthenticated static notice request was accepted')
            except HTTPError as error:
                if error.code!=403:raise
                report['unauthenticatedNoticeRejected']=True
            # Current app intentionally mounts /assets only; arbitrary frontend
            # paths return the SPA entry. Notices are delivered as disk files,
            # so do not mistake that HTML response for a changed JSON notice.
            delivered=bundle/'_internal/app/static/third-party/frontend-notices.json'
            if delivered.read_bytes()!=(frontend/'third-party/frontend-notices.json').read_bytes():raise ValueError('Bundled static notices differ')
            report['frontendNoticeFilesMatch']=True
            with urlopen(Request('http://127.0.0.1:'+str(port)+'/',headers={'X-AVHub-Token':token}),timeout=3) as response:content=response.read(1024**2)
            if content!=(frontend/'index.html').read_bytes():raise ValueError('Replayed frontend entry differs')
            report['frontendEntryResponseMatches']=True
            request=Request('http://127.0.0.1:'+str(port)+'/api/shutdown',data=b'{}',headers={'X-AVHub-Token':token,'Content-Type':'application/json'},method='POST')
            with urlopen(request,timeout=8) as response:report['shutdownReply']=json.load(response)
            report['exitCode']=process.wait(timeout=10)
            if report['exitCode']!=0:raise ValueError('Replayed backend did not exit normally')
        for item in binary_inputs:
            target=bundle/'_internal'/('sqlite3.dll' if item['name']=='sqlite3.dll' else 'bin/'+item['name'])
            if hashlib.file_digest(target.open('rb'),'sha256').hexdigest()!=item['sha256']:raise ValueError('Bundled binary input changed')
        report['executableSha256']=hashlib.file_digest((bundle/'AVHubServer.exe').open('rb'),'sha256').hexdigest();report['passed']=True
    except Exception as error:report['error']=str(error)
    finally:
        if process is not None and process.poll() is None:process.kill();process.wait();report['forcedTermination']=True
        (folder/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report


if __name__=='__main__':
    root=Path(__file__).resolve().parents[1];replay=Path(json.loads((root/'build/application-build-replay-latest.json').read_text())['folder'])
    if not replay.resolve().is_relative_to((root/'build').resolve()):raise ValueError('Owned replay required')
    prior=json.loads((replay/'backend-replay-report.json').read_text());source=json.loads((replay/'replay-report.json').read_text())
    result=verify(replay,source['buildId'],prior['pinnedBinaryInputsReused']);print(json.dumps({'passed':result['passed'],'report':result['receipt']}))
    raise SystemExit(0 if result['passed'] else 1)
