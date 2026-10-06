"""Prepare pinned CI tools and validate release metadata; never packages or publishes."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parent.parent
def digest(path):
    with path.open('rb') as file:return hashlib.file_digest(file,'sha256').hexdigest()
def validate_release(tag):
    package=json.loads((ROOT/'package.json').read_text())
    version=package['version']
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)',version):raise ValueError('A stable semantic version is required')
    if tag!='v'+version:raise ValueError('Release tag must match package.json version')
    lock=json.loads((ROOT/'package-lock.json').read_text())
    if lock['version']!=version or lock['packages']['']['version']!=version:raise ValueError('Package lock version mismatch')
    notes=ROOT/'docs'/f'RELEASE-{version}.md'
    if not notes.is_file() or not notes.read_text(encoding='utf-8').strip():raise ValueError('Version-specific release notes are required')
    return version
def prepare(verify_only=False):
    manifest=json.loads((ROOT/'ci/ffmpeg.json').read_text())
    url=manifest['url'];expected=manifest['sha256']
    if not url.startswith('https://www.gyan.dev/ffmpeg/builds/packages/') or not re.fullmatch('[a-f0-9]{64}',expected):raise ValueError('Invalid pinned FFmpeg manifest')
    archive=ROOT/'build/downloads'/Path(url).name
    if not archive.exists():
        if verify_only:raise ValueError('Pinned archive is not present')
        archive.parent.mkdir(parents=True,exist_ok=True)
        temporary=archive.with_suffix('.download')
        with urlopen(url,timeout=60) as source,temporary.open('xb') as target:shutil.copyfileobj(source,target)
        if digest(temporary)!=expected:raise ValueError('FFmpeg download hash mismatch; nothing will be executed')
        temporary.rename(archive)
    if digest(archive)!=expected:raise ValueError('FFmpeg archive hash mismatch')
    if manifest['version'] not in (ROOT/'bin/FFmpeg-BUILD-INFO.txt').read_text(encoding='utf-8'):raise ValueError('Tracked FFmpeg redistribution information does not match')
    with zipfile.ZipFile(archive) as package:
        for name in ('ffmpeg.exe','ffprobe.exe'):
            member=manifest['prefix']+'bin/'+name;info=package.getinfo(member)
            if info.file_size>512*1024**2:raise ValueError('Unexpected FFmpeg binary size')
            with package.open(member) as file:expected_binary=hashlib.file_digest(file,'sha256').hexdigest()
            target=ROOT/'bin'/name
            if target.exists():
                if target.is_symlink() or digest(target)!=expected_binary:raise ValueError('Existing binary differs; refusing to overwrite')
            elif verify_only:raise ValueError('Pinned executable is not present')
            else:
                with package.open(member) as file,target.open('xb') as output:shutil.copyfileobj(file,output)
    if not verify_only:
        for name in ('ffmpeg.exe','ffprobe.exe'):subprocess.run([str(ROOT/'bin'/name),'-version'],check=True,capture_output=True,timeout=15)
    return manifest['version']
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verify-only',action='store_true');parser.add_argument('--release-tag');args=parser.parse_args()
    if args.release_tag:validate_release(args.release_tag)
    print(json.dumps({'ffmpeg':prepare(args.verify_only),'release_tag':args.release_tag}))
if __name__=='__main__':main()
