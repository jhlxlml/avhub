"""Generate/verify an exact release-file manifest, not a whole build directory."""
import hashlib
import json
import os
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def digest(file):
    with file.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def verify(directory,version,commit):
    file=directory/f'AVHub-portable-{version}-x64.exe'
    info=json.loads((directory/'release-build.json').read_text(encoding='utf-8'))
    if info.get('version')!=version or info.get('commit')!=commit or info.get('filename')!=file.name:raise ValueError('Artifact version/source mismatch')
    if file.is_symlink() or not file.is_file() or file.stat().st_size!=info.get('bytes') or digest(file)!=info.get('sha256'):raise ValueError('Artifact digest/size mismatch')
    expected=f"{info['sha256']}  {file.name}\n"
    if (directory/'SHA256SUMS.txt').read_text(encoding='utf-8')!=expected:raise ValueError('Checksum file mismatch')
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
    info={'version':version,'commit':commit,'build_id':build['build_id'],'filename':file.name,'bytes':file.stat().st_size,'sha256':digest(file)}
    (directory/'SHA256SUMS.txt').write_text(f"{info['sha256']}  {file.name}\n",encoding='utf-8')
    (directory/'release-build.json').write_text(json.dumps(info,indent=2),encoding='utf-8')
    verify(directory,version,commit);print(json.dumps(info))
if __name__=='__main__':main()
