"""Freeze a local working-tree application-source review snapshot.

Not a release commit, corresponding-source certification or publication.
Generated runtimes, native dependency source archives and personal media stay
outside this application-only snapshot; pair with the native review dossier.
"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]


def stage(root=ROOT):
    names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode('utf-8').split('\0')
    root_files={'LICENSE','.gitignore','package.json','package-lock.json','run.py','README.md','README.en.md',
                'requirements.txt','requirements-build.txt','vite.config.ts','vite.config.js','playwright.config.ts'}
    source_roots={'app','frontend','electron','scripts','tests','ci','third_party','.github'}
    extensions={'.py','.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs','.cs','.c','.cpp','.h','.hpp','.patch','.diff',
                '.json','.css','.html','.ps1','.sh','.cmd','.bat','.toml','.ini','.md','.txt','.yml','.yaml','.xml','.def','.cmake'}
    blocked={'node_modules','dist','static','__pycache__','.git','AVHub-data','data','screenshots','test-results'}
    records=[]
    for name in sorted(set(filter(None,names))):
        relative=Path(name)
        root_config=len(relative.parts)==1 and (relative.name in root_files or relative.match('tsconfig*.json'))
        notice=name in {'bin/FFmpeg-LICENSE.txt','bin/FFmpeg-BUILD-INFO.txt','bin/SQLite-LICENSE.txt','bin/SQLite-BUILD-INFO.txt'}
        source=len(relative.parts)>1 and relative.parts[0] in source_roots and not (set(relative.parts)&blocked)
        source_asset=(name.startswith(('frontend/public/','electron/assets/')) and relative.suffix.lower() in {'.svg','.png','.ico','.woff','.woff2','.ttf','.otf'}) or name=='tests/fixtures/native-hdr-pq.png'
        if not root_config and not notice and not (source and (relative.suffix in extensions or relative.name.startswith(('LICENSE','COPYING','Copyright')) or source_asset)):
            continue
        file=root/relative
        if not file.exists():continue  # A working-tree deletion is not copied from HEAD.
        if file.is_symlink() or not file.is_file() or not file.resolve().is_relative_to(root.resolve()):raise ValueError('Source must be an owned regular file: '+name)
        if file.stat().st_size>16*1024**2:raise ValueError('Unexpected source member size: '+name)
        with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        records.append({'path':relative.as_posix(),'size':file.stat().st_size,'sha256':digest})
    if not {'LICENSE','package.json','package-lock.json','run.py'}.issubset({item['path'] for item in records}):raise ValueError('Application sources incomplete')
    total=sum(item['size'] for item in records)
    if total>256*1024**2 or shutil.disk_usage(root/'build').free<total+256*1024**2:raise ValueError('Source review capacity exceeded')
    destination=Path(tempfile.mkdtemp(prefix='application-source-review-',dir=root/'build'))
    for item in records:
        target=destination/item['path'];target.parent.mkdir(parents=True,exist_ok=True)
        with (root/item['path']).open('rb') as source,target.open('xb') as output:shutil.copyfileobj(source,output)
        with target.open('rb') as stream:
            if hashlib.file_digest(stream,'sha256').hexdigest()!=item['sha256']:raise ValueError('Source changed while copying')
    identity=json.loads((root/'app/build-info.json').read_text(encoding='utf-8'))
    report={'schema':1,'scope':'Application working-tree source review, not a tagged-release or dependency-source delivery approval',
            'buildIdentityReference':identity,
            'gitHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
            'workingTreeContent':True,'files':records,'totalBytes':total,'releaseCommitSnapshot':False,'distributionReady':False,
            'excluded':['archive','build','dist','node_modules','user media and data','generated app/static','root user planning documents'],
            'remaining':['Final authorized release-commit snapshot','Native dependency and other third-party corresponding-source/license review','Rebuild/package identity and broader external playback acceptance']}
    (destination/'source-review-inventory.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    (root/'build/application-source-review-latest.json').write_text(json.dumps({'folder':str(destination),'files':len(records),'totalBytes':total,'distributionReady':False},indent=2)+'\n',encoding='utf-8')
    return destination


if __name__=='__main__':print(stage())
