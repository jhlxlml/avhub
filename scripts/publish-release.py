"""Explicit release publisher. Uses Git credential manager without logging credentials."""
import argparse
import hashlib
import json
import os
import subprocess
import runpy
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError

ROOT=Path(__file__).resolve().parent.parent
REPO='jhlxlml/avhub'
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--probe',action='store_true');parser.add_argument('--publish',action='store_true');parser.add_argument('--ci',action='store_true');args=parser.parse_args()
    if args.probe==args.publish:parser.error('Choose --probe or --publish')
    remote=subprocess.check_output(['git','remote','get-url','origin'],cwd=ROOT,text=True).strip()
    if remote.removesuffix('.git')!='https://github.com/jhlxlml/avhub':raise SystemExit('Unexpected repository remote')
    env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GCM_INTERACTIVE':'never'}
    if args.ci:
        if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REPOSITORY')!=REPO or os.environ.get('GITHUB_EVENT_NAME')!='push':raise SystemExit('CI publishing is restricted to the original repository tag-push workflow')
        token=os.environ.get('GITHUB_TOKEN')
    else:
        credential=subprocess.run(['git','credential','fill'],cwd=ROOT,env=env,input='protocol=https\nhost=github.com\npath=jhlxlml/avhub.git\n\n',text=True,capture_output=True,timeout=30)
        fields=dict(line.split('=',1) for line in credential.stdout.splitlines() if '=' in line)
        token=fields.get('password') if credential.returncode==0 else None
    if not token:raise SystemExit('GitHub publishing credential unavailable')
    def call(route,method='GET',payload=None,file=None):
        endpoint=route if route.startswith('https://uploads.github.com/') else 'https://api.github.com/repos/'+REPO+route
        if not (endpoint.startswith('https://api.github.com/repos/'+REPO+'/') or endpoint.startswith('https://uploads.github.com/repos/'+REPO+'/')):raise ValueError('Unexpected release endpoint')
        data=file.read_bytes() if file else json.dumps(payload).encode() if payload is not None else None
        request=Request(endpoint,data=data,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'AVHub-release-publisher','Content-Type':'application/octet-stream' if file else 'application/json'})
        try:
            with urlopen(request,timeout=300) as response:
                body=response.read()
                return json.loads(body) if body else None
        except HTTPError as error:
            raise SystemExit(f'GitHub API returned HTTP {error.code}; no credentials were logged') from None
    repository=call('/releases?per_page=5')
    if args.probe:print(json.dumps({'authenticated':True,'recent_tags':[r['tag_name'] for r in repository]}));return
    if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip():raise SystemExit('Commit source changes before publishing')
    version=json.loads((ROOT/'package.json').read_text())['version'];tag='v'+version
    artifact=ROOT/'dist'/'electron'/f'AVHub-portable-{version}-x64.exe'
    notes=ROOT/'docs'/f'RELEASE-{version}.md'
    if not artifact.is_file() or not notes.is_file():raise SystemExit('Release artifacts or notes missing')
    sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    if args.ci:
        if os.environ.get('GITHUB_REF')!='refs/tags/'+tag or os.environ.get('GITHUB_SHA')!=sha:raise SystemExit('Tag/workflow/source mismatch')
        runpy.run_path(str(ROOT/'scripts/ci-prepare.py'))['validate_release'](tag)
        runpy.run_path(str(ROOT/'scripts/ci-artifacts.py'))['verify'](artifact.parent,version,sha)
    else:
        remote_sha=subprocess.check_output(['git','ls-remote','origin','refs/heads/main'],cwd=ROOT,text=True).split()[0]
        if remote_sha!=sha:raise SystemExit('Push the committed release source before publishing')
    existing=next((r for r in repository if r['tag_name']==tag),None)
    body=notes.read_text(encoding='utf-8')+(f'\n<!-- avhub-ci-release:{sha} -->' if args.ci else '')
    if existing:
        if not args.ci or not existing.get('draft') or existing.get('body')!=body or existing.get('target_commitish')!=sha:raise SystemExit('Existing release is not an owned CI draft; refusing to overwrite')
        release=existing
    else:release=call('/releases','POST',{'tag_name':tag,'target_commitish':sha,'name':'AVHub '+version,'body':body,'draft':True,'prerelease':False})
    digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
    checksum=artifact.with_name('SHA256SUMS.txt');checksum.write_text(f'{digest}  {artifact.name}\n',encoding='utf-8')
    files=(artifact,checksum,artifact.parent/'release-build.json') if args.ci else (artifact,checksum)
    if any(a['name'] not in {f.name for f in files} for a in release.get('assets',[])):raise SystemExit('Unexpected assets in CI draft; refusing to publish')
    for file in files:
        previous=next((a for a in release.get('assets',[]) if a['name']==file.name),None)
        if previous:
            file_digest=hashlib.sha256(file.read_bytes()).hexdigest()
            if previous.get('state')=='uploaded' and previous.get('size')==file.stat().st_size and previous.get('digest')=='sha256:'+file_digest:continue
            call('/releases/assets/'+str(previous['id']),'DELETE')
        uploaded=call(f'https://uploads.github.com/repos/{REPO}/releases/{release["id"]}/assets?name={file.name}','POST',file=file)
        if uploaded.get('state')!='uploaded' or uploaded.get('size')!=file.stat().st_size:raise SystemExit('Upload validation failed; release remains draft')
        if file==artifact and uploaded.get('digest') not in (None,'sha256:'+digest):raise SystemExit('Remote digest mismatch; release remains draft')
    published=call('/releases/'+str(release['id']),'PATCH',{'draft':False,'make_latest':'true'})
    print(json.dumps({'url':published['html_url'],'tag':tag,'commit':sha,'sha256':digest,'bytes':artifact.stat().st_size}))
if __name__=='__main__':main()
