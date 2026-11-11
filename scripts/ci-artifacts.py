"""Generate/verify an exact release-file manifest, not a whole build directory."""
import hashlib
import json
import os
import subprocess
import runpy
import zipfile
from pathlib import Path
from native_source_delivery import verify_native_bundle
ROOT=Path(__file__).resolve().parent.parent
def digest(file):
    with file.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def names(version):
    return (f'AVHub-portable-{version}-x64.exe',f'AVHub-folder-portable-{version}-x64.zip',f'AVHub-source-materials-{version}.zip')
def checksums(records):
    return ''.join(f"{item['sha256']}  {item['filename']}\n" for item in records)
def verify(directory,version,commit):
    info=json.loads((directory/'release-build.json').read_text(encoding='utf-8'))
    if info.get('schema')!=2 or info.get('version')!=version or info.get('commit')!=commit:raise ValueError('Artifact version/source mismatch')
    if not isinstance(info.get('build_id'),str) or not info['build_id']:raise ValueError('Missing build identity')
    records=info.get('artifacts',[])
    if not isinstance(records,list) or tuple(item.get('filename') for item in records)!=names(version):raise ValueError('Exact EXE, folder ZIP and corresponding source manifest required')
    for item in records:
        file=directory/item['filename']
        if file.is_symlink() or not file.is_file() or file.stat().st_size!=item.get('bytes') or digest(file)!=item.get('sha256'):raise ValueError('Artifact digest/size mismatch')
    if (directory/'SHA256SUMS.txt').read_text(encoding='utf-8')!=checksums(records):raise ValueError('Checksum file mismatch')
    runpy.run_path(str(ROOT/'scripts/folder-portable.py'))['verify'](directory/names(version)[1],version,info.get('build_id'))
    with zipfile.ZipFile(directory/names(version)[2]) as sources:
        index=json.loads(sources.read('DELIVERY-INDEX.json'))
        if (sources.testzip() is not None or index.get('applicationBuild',{}).get('version')!=version
            or index.get('applicationBuild',{}).get('build_id')!=info['build_id']
            or index.get('controlledCliSourceArchives',0)<11):
            raise ValueError('Corresponding source bundle does not match this application build')
        # Source manifest bytes must describe the actual folder-portable runtime,
        # not merely another internally consistent source ZIP.
        with zipfile.ZipFile(directory/names(version)[1]) as portable:
            prefix=portable.namelist()[0].split('/')[0]+'/'
            verify_native_bundle(sources,index,portable.read(prefix+'resources/native-render/runtime.json'),
                                 portable.read(prefix+'resources/mpv/runtime.json'))
    return info
def main():
    version=json.loads((ROOT/'package.json').read_text())['version']
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    if os.environ.get('GITHUB_SHA',commit)!=commit:raise ValueError('Workflow source mismatch')
    directory=ROOT/'dist/electron';file=directory/f'AVHub-portable-{version}-x64.exe'
    if not file.is_file() or file.is_symlink() or not 1024**2<file.stat().st_size<2*1024**3:raise ValueError('Portable EXE missing or invalid size')
    with file.open('rb') as stream:
        if stream.read(2)!=b'MZ':raise ValueError('Not a Windows executable')
    build=json.loads((ROOT/'app/build-info.json').read_text())
    if build['version']!=version:raise ValueError('Build metadata version mismatch')
    records=[]
    for name in names(version):
        target=directory/name
        if not target.is_file() or target.is_symlink() or not 1024**2<target.stat().st_size<2*1024**3:raise ValueError('Release asset missing or invalid size')
        records.append({'filename':name,'bytes':target.stat().st_size,'sha256':digest(target)})
    info={'schema':2,'version':version,'commit':commit,'build_id':build['build_id'],'artifacts':records}
    (directory/'SHA256SUMS.txt').write_text(checksums(records),encoding='utf-8')
    (directory/'release-build.json').write_text(json.dumps(info,indent=2),encoding='utf-8')
    verify(directory,version,commit);print(json.dumps(info))
if __name__=='__main__':main()
