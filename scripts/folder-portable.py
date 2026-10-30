"""Build a clean, extract-once Windows app ZIP from electron-builder win-unpacked."""
import argparse
import json
import os
import re
import stat
import tempfile
import zipfile
import hashlib
from pathlib import Path, PurePosixPath

ROOT=Path(__file__).resolve().parent.parent
FORBIDDEN={'archive','.git','node_modules','avhub-data','data','screenshots','hls','thumbnails','covers',
           'native-cache','avhub-data-location.json','.env'}
MEDIA={'.mp4','.mkv','.ts','.avi','.mov','.webm','.m4v','.mts','.m2ts','.wmv','.flv'}
REQUIRED={'AVHub.exe','resources/app.asar','resources/backend/AVHubServer.exe',
          'resources/backend/_internal/bin/ffmpeg.exe','resources/backend/_internal/bin/ffprobe.exe',
          'resources/backend/_internal/app/build-info.json',
          'resources/backend/_internal/sqlite3.dll','resources/backend/_internal/app/sqlite-runtime.json',
          'resources/licenses/AVHub-LICENSE.txt','LICENSE.electron.txt','LICENSES.chromium.html'}

def folder_name(version):
    if not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('Invalid stable version')
    return f'AVHub-folder-portable-{version}-x64'

def allowed(relative,native_members=()):
    if relative.as_posix() in native_members:return True
    parts=relative.parts
    if any(p.casefold() in FORBIDDEN or p.startswith('.') for p in parts):return False
    name=relative.name.casefold()
    return not (relative.suffix.casefold() in MEDIA or re.search(r'\.(db|sqlite\d*|log)(-|\.|$)',name))


def verify_native_ffi(names,read):
    """Only the repository-pinned FFI closure may cross the node_modules ban.

    A manifest inside an input package cannot grant its own files permission.
    The same boundary checks both directory input and archived output.
    """
    prefix='resources/native-render/ffi/'
    actual={name for name in names if name.startswith(prefix)}
    if not actual:
        if any(name.startswith('resources/native-render/') for name in names):raise ValueError('Native render package is missing its FFI closure')
        return set()
    pin=json.loads((ROOT/'ci/render-ffi/runtime-manifest.json').read_text())
    expected={prefix+entry['name']:entry for entry in pin['files']}
    manifest=prefix+'runtime-manifest.json'
    if actual!=set(expected)|{manifest}:raise ValueError('Native FFI closure has missing or unexpected files')
    if json.loads(read(manifest,65536))!=pin:raise ValueError('Native FFI manifest differs from repository pin')
    for name,entry in expected.items():
        content=read(name,entry['size']+1)
        if len(content)!=entry['size'] or hashlib.sha256(content).hexdigest()!=entry['sha256']:
            raise ValueError('Native FFI file identity mismatch: '+name)
    return actual|{parent.as_posix() for name in actual for parent in PurePosixPath(name).parents}


def verify_desktop_mpv(names,read):
    """Check the source-built independent runtime in directory and ZIP output."""
    prefix='resources/mpv/'
    if prefix+'runtime.json' not in names:return
    manifest=json.loads(read(prefix+'runtime.json',65536))
    if manifest.get('schema')!=1 or not isinstance(manifest.get('dependencies'),list):
        raise ValueError('Invalid independent MPV inventory')
    entries=[{'name':'mpv.exe','sha256':manifest.get('exeSha256')},
             {'name':'LICENSE.GPL','sha256':manifest.get('licenseSha256')},*manifest['dependencies']]
    seen=set()
    for item in entries:
        name=item.get('name');digest=item.get('sha256');size=item.get('size')
        if (not isinstance(name,str) or not re.fullmatch('[A-Za-z0-9_+.-]+',name) or name.casefold() in seen
            or not isinstance(digest,str) or not re.fullmatch('[a-f0-9]{64}',digest)
            or (size is not None and (type(size) is not int or not 0<size<=512*1024**2))):
            raise ValueError('Invalid independent MPV member')
        seen.add(name.casefold())
        if prefix+name not in names:raise ValueError('Independent MPV member missing: '+name)
        content=read(prefix+name,(size if size is not None else 512*1024**2)+1)
        if (size is not None and len(content)!=size) or hashlib.sha256(content).hexdigest()!=digest:
            raise ValueError('Independent MPV member changed: '+name)


def verify_notices(names,read):
    """Delivery consistency, not license interpretation or binary provenance.

    Both the unpacked directory and final ZIP must contain every notice named
    by their backend/frontend build inventories, with the recorded bytes.
    """
    backend='resources/backend/_internal/licenses/python-distributions/'
    frontend='resources/backend/_internal/app/static/'
    for name in ['resources/backend/_internal/licenses/'+name for name in
                 ('FFmpeg-LICENSE.txt','FFmpeg-BUILD-INFO.txt','SQLite-LICENSE.txt','SQLite-BUILD-INFO.txt')]+[frontend+'third-party-ui-licenses.txt']:
        if name not in names or not read(name,1024).strip():raise ValueError('Missing runtime notice: '+name)
    def index(name):
        if name not in names:raise ValueError('Missing runtime notice inventory: '+name)
        value=json.loads(read(name,1024**2))
        if not isinstance(value,dict) or value.get('schema')!=1:raise ValueError('Invalid runtime notice inventory')
        return value
    cli_index='resources/backend/_internal/licenses/FFmpeg-RUNTIME.json'
    if cli_index in names:
        cli=index(cli_index)
        required={'ffmpeg.exe','ffprobe.exe','FFmpeg-LICENSE.txt','FFmpeg-BUILD-INFO.txt','FFmpeg-THIRD-PARTY-NOTICES.txt'}
        if cli.get('kind')!='avhub-controlled-ffmpeg-runtime' or {item['path'] for item in cli['files']}!=required or len(cli['files'])!=len(required):
            raise ValueError('Invalid controlled FFmpeg inventory')
        for item in cli['files']:
            name='resources/backend/_internal/'+('bin/' if item['path'].endswith('.exe') else 'licenses/')+item['path']
            if name not in names or not 0<item['size']<=512*1024**2:raise ValueError('Missing controlled FFmpeg member')
            content=read(name,item['size']+1)
            if len(content)!=item['size'] or hashlib.sha256(content).hexdigest()!=item['sha256']:
                raise ValueError('Controlled FFmpeg member changed: '+name)
    back=index(backend+'inventory.json');front=index(frontend+'third-party/frontend-notices.json')
    if not isinstance(back.get('files'),list) or not back['files'] or not isinstance(back.get('packages'),list) or not back['packages']:
        raise ValueError('Empty backend notice inventory')
    if not isinstance(front.get('packages'),list) or not front['packages']:raise ValueError('Empty frontend notice inventory')
    expected=[]
    for item in back['files']:
        if not isinstance(item,dict) or type(item.get('size')) is not int or not 0<item['size']<=8*1024**2:raise ValueError('Invalid backend notice member')
        expected.append((backend,item.get('path'),item.get('sha256'),item['size']))
    for package in front['packages']:
        if not isinstance(package,dict) or not isinstance(package.get('notices'),list) or not package['notices']:raise ValueError('Invalid frontend notice package')
        for item in package['notices']:
            if not isinstance(item,dict) or not isinstance(item.get('path'),str) or not item['path'].startswith('third-party/npm/'):raise ValueError('Invalid frontend notice member')
            expected.append((frontend,item['path'],item.get('sha256'),None))
    for prefix,relative,digest,size in expected:
        if not isinstance(relative,str) or not relative or '\\' in relative or ':' in relative or PurePosixPath(relative).is_absolute() or any(part in ('.','..') or part.startswith('.') for part in relative.split('/')):
            raise ValueError('Unsafe runtime notice member')
        if not isinstance(digest,str) or not re.fullmatch('[0-9a-f]{64}',digest):raise ValueError('Invalid runtime notice hash')
        name=prefix+relative
        if name not in names:raise ValueError('Runtime notice file missing: '+name)
        content=read(name,size+1 if size is not None else 8*1024**2+1)
        if not content.strip() or (size is not None and len(content)!=size) or hashlib.sha256(content).hexdigest()!=digest:
            raise ValueError('Runtime notice identity mismatch: '+name)

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
            if key in seen or stat.S_ISLNK(item.external_attr>>16):raise ValueError('Duplicate or linked ZIP entry')
            seen.add(key);total+=item.file_size
            if total>4*1024**3 or len(seen)>30000:raise ValueError('ZIP exceeds limits')
            members[str(relative)]=item
        def read_native(name,limit):
            with archive.open(members[name]) as stream:return stream.read(limit)
        native=verify_native_ffi(members,read_native)
        verify_notices(members,read_native)
        verify_desktop_mpv(members,read_native)
        if any(not allowed(PurePosixPath(name),native) for name in members):raise ValueError('Private ZIP entry')
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
    files=[];directories=[]
    for file in sorted(source.rglob('*')):
        relative=file.relative_to(source)
        if file.is_symlink() or (hasattr(file,'is_junction') and file.is_junction()):raise ValueError('Runtime links refused')
        if file.is_file():files.append((file,relative))
        else:directories.append(relative)
    members={relative.as_posix():file for file,relative in files}
    def read_native(name,limit):
        with members[name].open('rb') as stream:return stream.read(limit)
    native=verify_native_ffi(members,read_native)
    verify_notices(members,read_native)
    verify_desktop_mpv(members,read_native)
    for relative in [*(relative for _,relative in files),*directories]:
        if not allowed(relative,native):raise ValueError(f'Private/source content in runtime: {relative}')
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
    parser=argparse.ArgumentParser();parser.add_argument('--extract-to',type=Path)
    parser.add_argument('--verify-backend-notices',action='store_true',help='Check current backend staging before Electron packaging')
    parser.add_argument('--backend-directory',type=Path,default=ROOT/'build/backend-dist/AVHubServer')
    parser.add_argument('--directory',type=Path,default=ROOT/'dist/electron',help='Explicit candidate artifact directory; defaults to the release output')
    args=parser.parse_args()
    if args.verify_backend_notices:
        internal=args.backend_directory/'_internal'
        members={'resources/backend/_internal/'+file.relative_to(internal).as_posix():file for file in internal.rglob('*') if file.is_file()}
        def read_notice(name,limit):
            with members[name].open('rb') as stream:return stream.read(limit)
        verify_notices(members,read_notice);print('Backend/frontend notice delivery verified');return
    version=json.loads((ROOT/'package.json').read_text())['version'];directory=args.directory.resolve()
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
