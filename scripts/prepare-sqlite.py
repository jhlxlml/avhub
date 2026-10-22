"""Fetch verified official SQLite into the project only. No installation or packaging."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
from urllib.request import urlopen
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from app.sqlite_runtime import manifest,runtime_path,validate_binary


def prepare(verify_only=False):
    info=manifest();target=runtime_path(info)
    if target.exists():validate_binary(target,info);return target
    if verify_only:raise RuntimeError('Pinned SQLite is missing; run npm run prepare:sqlite')
    downloads=ROOT/'build'/'downloads'
    if not downloads.resolve().is_relative_to(ROOT):raise RuntimeError('Download directory escapes project')
    downloads.mkdir(parents=True,exist_ok=True);archive=downloads/Path(info['url']).name
    if archive.is_symlink():raise RuntimeError('Refusing linked SQLite archive')
    if not archive.exists():
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-download-',dir=downloads) as owned:
            temporary=Path(owned)/'download.zip'
            with urlopen(info['url'],timeout=30) as source,temporary.open('xb') as output:
                if source.geturl()!=info['url']:raise RuntimeError('Unexpected SQLite download redirect')
                total=0
                while block:=source.read(128*1024):
                    total+=len(block)
                    if total>8*1024**2:raise RuntimeError('SQLite download exceeds expected bound')
                    output.write(block)
            if hashlib.sha3_256(temporary.read_bytes()).hexdigest()!=info['archive_sha3_256']:
                raise RuntimeError('SQLite archive hash mismatch; nothing will be loaded')
            temporary.rename(archive)  # Windows refuses a concurrent overwrite.
    if archive.stat().st_size>8*1024**2 or hashlib.sha3_256(archive.read_bytes()).hexdigest()!=info['archive_sha3_256']:
        raise RuntimeError('SQLite archive hash mismatch; nothing will be loaded')
    target.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        if sorted(package.namelist())!=['sqlite3.def','sqlite3.dll']:raise RuntimeError('Unexpected SQLite ZIP contents')
        if package.getinfo('sqlite3.dll').file_size!=info['dll_bytes']:raise RuntimeError('Unexpected SQLite DLL size')
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-extract-',dir=target.parent) as owned:
            temporary=Path(owned)/'sqlite3.dll'
            with package.open('sqlite3.dll') as source,temporary.open('xb') as output:shutil.copyfileobj(source,output)
            validate_binary(temporary,info);temporary.rename(target)
    return target


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verify-only',action='store_true');args=parser.parse_args()
    print(json.dumps({'sqlite':manifest()['version'],'file':str(prepare(args.verify_only))}))


if __name__=='__main__':main()
