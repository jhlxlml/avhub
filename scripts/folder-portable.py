"""Build a clean, extract-once Windows app ZIP from electron-builder win-unpacked."""
import argparse
import json
import os
import re
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT=Path(__file__).resolve().parent.parent
FORBIDDEN={'archive','.git','node_modules','avhub-data','data','screenshots','hls','thumbnails','covers',
           'native-cache','avhub-data-location.json','.env'}
MEDIA={'.mp4','.mkv','.ts','.avi','.mov','.webm','.m4v','.mts','.m2ts','.wmv','.flv'}
REQUIRED={'AVHub.exe','resources/app.asar','resources/backend/AVHubServer.exe',
          'resources/backend/_internal/bin/ffmpeg.exe','resources/backend/_internal/bin/ffprobe.exe',
          'resources/backend/_internal/app/build-info.json'}

def folder_name(version):
    if not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('Invalid stable version')
    return f'AVHub-folder-portable-{version}-x64'

def allowed(relative):
    parts=relative.parts
    if any(p.casefold() in FORBIDDEN or p.startswith('.') for p in parts):return False
    name=relative.name.casefold()
    return not (relative.suffix.casefold() in MEDIA or re.search(r'\.(db|sqlite\d*|log)(-|\.|$)',name))

def verify(file,version,build_id=None):
    prefix=folder_name(version)
    if file.is_symlink():raise ValueError('ZIP cannot be a link')
    with zipfile.ZipFile(file) as archive:
        seen=set();members={};total=0
        for item in archive.infolist():
            path=PurePosixPath(item.filename)
            if '\\' in item.filename or ':' in item.filename or path.is_absolute() or '..' in path.parts or len(path.parts)<2 or path.parts[0]!=prefix:
                raise ValueError('Unsafe ZIP entry')
            relative=PurePosixPath(*path.parts[1:]);key=str(relative).casefold()
            if key in seen or not allowed(relative) or stat.S_ISLNK(item.external_attr>>16):raise ValueError('Duplicate, linked or private ZIP entry')
            seen.add(key);total+=item.file_size
            if total>4*1024**3 or len(seen)>30000:raise ValueError('ZIP exceeds limits')
            members[str(relative)]=item
        if not REQUIRED.issubset(members):raise ValueError('ZIP runtime files missing')
        metadata=members['resources/backend/_internal/app/build-info.json']
        if metadata.file_size>65536:raise ValueError('Invalid build metadata')
        build=json.loads(archive.read(metadata))
        if build.get('version')!=version or (build_id is not None and build.get('build_id')!=build_id):raise ValueError('ZIP build identity mismatch')
        for name in ('AVHub.exe','resources/backend/AVHubServer.exe','resources/backend/_internal/bin/ffmpeg.exe','resources/backend/_internal/bin/ffprobe.exe'):
            with archive.open(members[name]) as stream:
                if stream.read(2)!=b'MZ':raise ValueError('ZIP Windows runtime invalid')
        if archive.testzip() is not None:raise ValueError('ZIP CRC mismatch')
    return prefix

def create(source,target,version,build_id):
    prefix=folder_name(version);source=Path(source);target=Path(target)
    if source.is_symlink() or not source.is_dir():raise ValueError('Missing clean win-unpacked directory')
    files=[]
    for file in sorted(source.rglob('*')):
        relative=file.relative_to(source)
        if file.is_symlink() or (hasattr(file,'is_junction') and file.is_junction()):raise ValueError('Runtime links refused')
        if not allowed(relative):raise ValueError(f'Private/source content in runtime: {relative}')
        if file.is_file():files.append((file,relative))
    if not REQUIRED.issubset({p.as_posix() for _,p in files}):raise ValueError('Runtime dependencies missing')
    if target.is_symlink():raise ValueError('ZIP destination cannot be a link')
    if target.exists():verify(target,version)  # Never replace an unrelated file.
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix='avhub-folder-',suffix='.zip',dir=target.parent,delete=False) as file:temporary=Path(file.name)
    try:
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for file,relative in files:archive.write(file,f'{prefix}/{relative.as_posix()}')
        verify(temporary,version,build_id)
        os.replace(temporary,target)
    finally:temporary.unlink(missing_ok=True)
    return target

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--extract-to',type=Path);args=parser.parse_args()
    version=json.loads((ROOT/'package.json').read_text())['version'];directory=ROOT/'dist/electron'
    target=directory/(folder_name(version)+'.zip')
    build=json.loads((ROOT/'app/build-info.json').read_text())
    if args.extract_to:
        prefix=verify(target,version,build['build_id'])
        if args.extract_to.exists() and any(args.extract_to.iterdir()):raise ValueError('Extraction target must be empty')
        args.extract_to.mkdir(parents=True,exist_ok=True)
        if args.extract_to.is_symlink():raise ValueError('Extraction target cannot be a link')
        with zipfile.ZipFile(target) as archive:archive.extractall(args.extract_to)
        print(args.extract_to/prefix)
    else:print(create(directory/'win-unpacked',target,version,build['build_id']))

if __name__=='__main__':main()
