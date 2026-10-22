"""Read-only gate: a stable tag needs a successful full candidate at the exact SHA."""
import argparse
import json
import os
import re
from urllib.request import Request,urlopen

REPOSITORY='jhlxlml/avhub'
REQUIRED_STEPS=('Package only tags or explicit manual runs','Actual portable EXE acceptance',
                'Actual extracted folder ZIP acceptance','Checksums and source manifest',
                'Save verified release files')


def verified_candidate(get,sha):
    if not re.fullmatch('[a-f0-9]{40}',sha):raise ValueError('An exact source SHA is required')
    candidates=[]
    for page in range(1,6):
        runs=get(f'/actions/workflows/windows.yml/runs?event=workflow_dispatch&head_sha={sha}&status=success&per_page=100&page={page}')['workflow_runs']
        candidates.extend(run for run in runs if run.get('head_sha')==sha and
            run.get('event')=='workflow_dispatch' and run.get('status')=='completed' and
            run.get('conclusion')=='success' and run.get('head_repository',{}).get('full_name')==REPOSITORY)
        if len(runs)<100:break
    for run in candidates:
        run_id=run['id'];jobs=[];artifacts=[]
        for page in range(1,11):
            items=get(f'/actions/runs/{run_id}/jobs?filter=latest&per_page=100&page={page}')['jobs']
            jobs.extend(items)
            if len(items)<100:break
        verify=next((job for job in jobs if job.get('name')=='verify' and job.get('conclusion')=='success'),None)
        if not verify:continue
        steps={step['name']:step.get('conclusion') for step in verify.get('steps',[])}
        if any(steps.get(name)!='success' for name in REQUIRED_STEPS):continue
        for page in range(1,11):
            items=get(f'/actions/runs/{run_id}/artifacts?per_page=100&page={page}')['artifacts']
            artifacts.extend(items)
            if len(items)<100:break
        files=[item for item in artifacts if item.get('name')=='windows-portable-'+sha and not item.get('expired',True) and item.get('size_in_bytes',0)>0]
        if len(files)==1:return {'sha':sha,'candidate_run':run_id,'artifact':files[0]['id']}
    raise RuntimeError('No successful full Windows candidate with retained artifacts for this exact commit. Run Windows desktop CI and release manually with mpv_validation=false; do not move or publish the stable tag first.')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--sha',default=os.environ.get('GITHUB_SHA',''));args=parser.parse_args()
    if os.environ.get('GITHUB_REPOSITORY',REPOSITORY)!=REPOSITORY:raise SystemExit('Unexpected release repository')
    token=os.environ.get('GITHUB_TOKEN')
    def get(route):
        headers={'Accept':'application/vnd.github+json','User-Agent':'AVHub-candidate-gate'}
        if token:headers['Authorization']='Bearer '+token
        request=Request('https://api.github.com/repos/'+REPOSITORY+route,headers=headers)
        try:
            with urlopen(request,timeout=30) as response:return json.load(response)
        except Exception:
            raise RuntimeError('Cannot verify the candidate through GitHub API; release gate remains closed, no automatic write retry') from None
    print(json.dumps(verified_candidate(get,args.sha)))


if __name__=='__main__':main()
