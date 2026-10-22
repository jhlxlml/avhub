"""Explicit release publisher. Uses Git credential manager without logging credentials."""
import argparse
import hashlib
import json
import os
import subprocess
import runpy
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError

ROOT=Path(__file__).resolve().parent.parent
REPO='jhlxlml/avhub'

def release_body(notes,version,sha,ci):
    downloads=(f'\n\n## 下载 / Downloads\n\n'
               f'- `AVHub-folder-portable-{version}-x64.zip`：推荐日常使用。完整解压到可写目录后运行 `AVHub.exe`，不要只复制 EXE 或直接在压缩包内启动。Extract the whole folder, then run AVHub.exe.\n'
               f'- `AVHub-portable-{version}-x64.exe`：单文件便携版，每次启动先解压。Single-file portable app; extracts on launch.\n'
               '两个版本均无需另装 Python、Node.js 或 FFmpeg；保留 AVHub-data 和 avhub-data-location.json。校验两个下载文件请使用 SHA256SUMS.txt。Both formats bundle their runtimes; preserve your data and verify SHA256SUMS.txt.\n')
    return notes+downloads+f'\n<!-- avhub-{"ci" if ci else "manual"}-release:{sha} -->'

def reusable_draft(release,body,sha,ci,resume,tag):
    marker=f'<!-- avhub-{"ci" if ci else "manual"}-release:{sha} -->'
    return bool((ci or resume) and release.get('draft') is True and release.get('body')==body
                and marker in body and release.get('target_commitish')==sha
                and release.get('tag_name')==tag and release.get('prerelease') is False)

def verified_asset(asset,file):
    return (asset.get('state')=='uploaded' and asset.get('size')==file.stat().st_size
            and asset.get('digest')=='sha256:'+hashlib.sha256(file.read_bytes()).hexdigest())

def check_draft(release,body,sha,ci,resume,files,tag):
    if not reusable_draft(release,body,sha,ci,resume,tag):raise SystemExit('Release is not the same owned stable draft; refusing to overwrite a published or different release')
    names={file.name for file in files}
    assets=release.get('assets',[])
    if len({item['name'] for item in assets})!=len(assets) or any(a['name'] not in names for a in assets):raise SystemExit('Unexpected or duplicate assets in owned draft; refusing to publish')
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--probe',action='store_true');parser.add_argument('--publish',action='store_true');parser.add_argument('--ci',action='store_true');parser.add_argument('--resume',action='store_true',help='Resume only this source/notes-matched manual draft');args=parser.parse_args()
    if args.probe==args.publish:parser.error('Choose --probe or --publish')
    if args.resume and (args.probe or args.ci):parser.error('--resume is only for explicit manual --publish')
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
        except (URLError,TimeoutError,ConnectionError):
            raise SystemExit('Release request result not confirmed; inspect the draft/release before retrying. No automatic write retry. Manual drafts can use --publish --resume.') from None
    repository=call('/releases?per_page=100&page=1')
    if args.probe:print(json.dumps({'authenticated':True,'recent_tags':[r['tag_name'] for r in repository]}));return
    if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip():raise SystemExit('Commit source changes before publishing')
    version=json.loads((ROOT/'package.json').read_text())['version'];tag='v'+version
    artifact=ROOT/'dist'/'electron'/f'AVHub-portable-{version}-x64.exe'
    notes=ROOT/'docs'/f'RELEASE-{version}.md'
    if not artifact.is_file() or not notes.is_file():raise SystemExit('Release artifacts or notes missing')
    sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    runpy.run_path(str(ROOT/'scripts/ci-prepare.py'))['validate_release'](tag)
    if args.ci:
        if os.environ.get('GITHUB_REF')!='refs/tags/'+tag or os.environ.get('GITHUB_SHA')!=sha:raise SystemExit('Tag/workflow/source mismatch')
        runpy.run_path(str(ROOT/'scripts/ci-artifacts.py'))['verify'](artifact.parent,version,sha)
    else:
        remote_sha=subprocess.check_output(['git','ls-remote','origin','refs/heads/main'],cwd=ROOT,text=True).split()[0]
        if remote_sha!=sha:raise SystemExit('Push the committed release source before publishing')
        refs=dict((parts[1],parts[0]) for line in subprocess.check_output(['git','ls-remote','origin','refs/tags/'+tag,'refs/tags/'+tag+'^{}'],cwd=ROOT,text=True).splitlines() if len(parts:=line.split())==2)
        if refs.get('refs/tags/'+tag+'^{}',refs.get('refs/tags/'+tag))!=sha:raise SystemExit('Remote stable tag/source mismatch')
        runpy.run_path(str(ROOT/'scripts/ci-artifacts.py'))['verify'](artifact.parent,version,sha)
    # Look beyond the first page before deciding that no draft exists.
    page=1
    while not any(r['tag_name']==tag for r in repository) and len(repository)==page*100:
        if page>=10:raise SystemExit('Release lookup limit reached; inspect existing drafts before publishing')
        page+=1;repository+=call(f'/releases?per_page=100&page={page}')
    existing=next((r for r in repository if r['tag_name']==tag),None)
    body=release_body(notes.read_text(encoding='utf-8'),version,sha,args.ci)
    if existing:
        if not reusable_draft(existing,body,sha,args.ci,args.resume,tag):raise SystemExit('Existing release is not the same owned draft; manual continuation requires --publish --resume; published releases are never replaced')
        release=existing
    else:release=call('/releases','POST',{'tag_name':tag,'target_commitish':sha,'name':'AVHub '+version,'body':body,'draft':True,'prerelease':False})
    digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
    checksum=artifact.with_name('SHA256SUMS.txt')
    files=(artifact,artifact.parent/f'AVHub-folder-portable-{version}-x64.zip',checksum,artifact.parent/'release-build.json')
    if any(not file.is_file() or file.is_symlink() for file in files):raise SystemExit('Required EXE/ZIP release files missing')
    check_draft(release,body,sha,args.ci,True,files,tag)
    for file in files:
        release=call('/releases/'+str(release['id']))
        check_draft(release,body,sha,args.ci,True,files,tag)
        previous=next((a for a in release.get('assets',[]) if a['name']==file.name),None)
        if previous:
            if verified_asset(previous,file):continue
            call('/releases/assets/'+str(previous['id']),'DELETE')
        uploaded=call(f'https://uploads.github.com/repos/{REPO}/releases/{release["id"]}/assets?name={file.name}','POST',file=file)
        if not verified_asset(uploaded,file):raise SystemExit('Remote upload size/digest validation failed; release remains draft')
    runpy.run_path(str(ROOT/'scripts/ci-artifacts.py'))['verify'](artifact.parent,version,sha)
    if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip():raise SystemExit('Source changed during upload; inspect the draft before publishing')
    final=call('/releases/'+str(release['id']))
    check_draft(final,body,sha,args.ci,True,files,tag)
    remote_assets={item['name']:item for item in final.get('assets',[])}
    if any(file.name not in remote_assets or not verified_asset(remote_assets[file.name],file) for file in files):raise SystemExit('Final remote asset verification failed; release remains draft')
    published=call('/releases/'+str(release['id']),'PATCH',{'draft':False,'make_latest':'true'})
    if published.get('draft') is not False or published.get('tag_name')!=tag:raise SystemExit('Publication result not confirmed; inspect GitHub before retrying')
    print(json.dumps({'url':published['html_url'],'tag':tag,'commit':sha,'sha256':digest,'bytes':artifact.stat().st_size}))
if __name__=='__main__':main()
