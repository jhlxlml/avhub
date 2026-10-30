"""Collect notices from the actual PyInstaller analysis and installed inputs.

Run immediately after building the backend. This is version/notice delivery,
not a determination that all corresponding-source obligations are satisfied.
"""
import argparse
import ast
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import re
import shutil
import sys
import sysconfig
import tempfile

ROOT=Path(__file__).resolve().parents[1]


def prepare(root=ROOT,*,install=False):
    analysis=root/'build/pyinstaller/AVHubServer/Analysis-00.toc'
    parsed=ast.literal_eval(analysis.read_text(encoding='utf-8'))
    if not isinstance(parsed,tuple) or len(parsed)!=20 or parsed[0]!=[str(root/'run.py')]:raise ValueError('Unexpected backend analysis layout')
    rows=[row for index in (14,15) for row in parsed[index]]
    if any(not isinstance(row,tuple) or len(row)!=3 or not all(isinstance(v,str) for v in row) for row in rows):raise ValueError('Invalid analysis member')
    site=Path(sysconfig.get_paths()['purelib']).resolve()
    inputs=[(row[0].replace('\\','/').split('/')[0].split('.')[0],Path(row[1])) for row in rows if 'site-packages' in row[1]]
    for _,file in inputs:
        if not file.is_file() or not file.resolve().is_relative_to(site) or file.stat().st_mtime_ns>analysis.stat().st_mtime_ns:
            raise ValueError('Python build input changed or unavailable; rebuild backend first')
    lookup=metadata.packages_distributions()
    modules={name for name,_ in inputs}
    if modules-set(lookup):raise ValueError('Unmapped backend distributions: '+', '.join(sorted(modules-set(lookup))))
    names=sorted({name for module in modules for name in lookup[module]}|{'PyInstaller'})
    destination=Path(tempfile.mkdtemp(prefix='backend-notices-review-',dir=root/'build'))
    files=[];packages=[]

    def copy_notice(source,relative):
        if source.is_symlink() or not source.is_file() or source.stat().st_size>8*1024**2:raise ValueError('Invalid notice input')
        content=source.read_bytes()
        if not content.strip():raise ValueError('Empty notice input')
        target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(content)
        files.append({'path':relative.as_posix(),'size':len(content),'sha256':hashlib.sha256(content).hexdigest()})

    for name in names:
        dist=metadata.distribution(name)
        members=[item for item in dist.files or [] if item.parts[0].endswith('.dist-info')]
        notices=[item for item in members if any(word in item.name.lower() for word in ('license','copying','notice','copyright'))]
        if not notices:raise ValueError('Missing distribution notices: '+name)
        package_id=re.sub(r'[^a-zA-Z0-9_.-]','_',name+'-'+dist.version)
        for item in notices:
            source=Path(dist.locate_file(item))
            if not source.resolve().is_relative_to(site):raise ValueError('Notice outside installed package root')
            copy_notice(source,Path(package_id)/Path(*item.parts[1:]))
        for item in members:
            if item.name=='METADATA' and Path(dist.locate_file(item)).stat().st_mtime_ns>analysis.stat().st_mtime_ns:
                raise ValueError('Distribution metadata newer than backend analysis; rebuild backend first')
        packages.append({'name':name,'version':dist.version,'role':'bootloader/build tool' if name=='PyInstaller' else 'analyzed backend dependency',
                         'license':dist.metadata.get('License-Expression') or dist.metadata.get('License') or 'See notice text',
                         'notices':[str(Path(package_id)/Path(*item.parts[1:])).replace('\\','/') for item in notices]})
    copy_notice(Path(sys.base_prefix)/'LICENSE.txt',Path('python/LICENSE.txt'))
    report={'schema':1,'scope':'Actual PyInstaller analysis inputs and bootloader/CPython notices; not full application license/source approval',
            'analysisSha256':hashlib.sha256(analysis.read_bytes()).hexdigest(),'pythonVersion':sys.version.split()[0],
            'packages':packages,'files':files,'distributionReady':False}
    (destination/'inventory.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    (destination/'THIRD-PARTY-NOTICES.txt').write_text('Backend dependency notices\n\n'+'\n'.join(p['name']+' '+p['version']+' -> '+', '.join(p['notices']) for p in packages)+'\nCPython '+report['pythonVersion']+' -> python/LICENSE.txt\n\nNotice inventory, not corresponding-source or legal approval.\n',encoding='utf-8')
    if install:
        target=root/'build/backend-dist/AVHubServer/_internal/licenses/python-distributions'
        if not target.parent.is_dir():raise ValueError('Build backend before installing notices')
        if target.exists():raise ValueError('Notices already installed; rebuild backend before preparing a new set')
        shutil.copytree(destination,target)
    (root/'build/backend-notices-review-latest.json').write_text(json.dumps({'folder':str(destination),'packages':len(packages),'noticeFiles':len(files),'installed':install,'distributionReady':False},indent=2)+'\n',encoding='utf-8')
    return destination


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--install',action='store_true')
    print(prepare(install=parser.parse_args().install))
