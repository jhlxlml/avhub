"""Explicit, pinned, offline-cache-first preparation; no runtime overwrites."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import time
from urllib.request import urlopen
import zipfile

ROOT = Path(__file__).resolve().parent.parent
LIMIT = 256 * 1024**2


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def manifest(root):
    value = json.loads((root / 'electron/mpv-runtime.json').read_text(encoding='utf-8'))
    asset = value.get('asset', '')
    if value.get('schema') != 1 or not re.fullmatch(r'mpv-[\w.-]+\.zip', asset, flags=re.ASCII):
        raise ValueError('Invalid MPV manifest')
    tag = value.get('releaseTag', 'git-release')
    if not isinstance(tag, str) or not re.fullmatch(r'git-release|v\d+\.\d+\.\d+', tag, flags=re.ASCII):
        raise ValueError('Invalid MPV release tag')
    if value.get('url') != f'https://github.com/mpv-player/mpv/releases/download/{tag}/{asset}':
        raise ValueError('Unexpected MPV download source')
    for key in ('archiveSha256', 'exeSha256', 'licenseSha256'):
        if not re.fullmatch('[a-f0-9]{64}', value.get(key, '')):
            raise ValueError('Invalid MPV digest')
    return value


def owned_directory(directory, root):
    if not directory.absolute().is_relative_to(root.resolve()):
        raise ValueError('MPV preparation path escapes workspace')
    cursor = directory
    while cursor != root:
        if cursor.is_symlink() or cursor.exists() and cursor.resolve() != cursor.absolute():
            raise ValueError('MPV preparation path contains a link')
        cursor = cursor.parent


def regular(file):
    return file.is_file() and not file.is_symlink() and file.resolve() == file.absolute()


def download(url, destination, expected, offline, opener=urlopen):
    if destination.exists():
        if not regular(destination) or destination.stat().st_size > LIMIT or digest(destination) != expected:
            raise ValueError('Cached MPV archive checksum mismatch; existing file preserved')
        return
    if offline:
        raise ValueError('Pinned MPV archive is not cached; offline preparation cannot download')
    if shutil.disk_usage(destination.parent).free < 768 * 1024**2:
        raise ValueError('Insufficient free space for MPV preparation')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='mpv-download-', suffix='.part', dir=destination.parent, delete=False) as target:
            temporary = Path(target.name)
            deadline = time.monotonic() + 300
            with opener(url, timeout=60) as source:
                if source.geturl().split(':', 1)[0] != 'https':
                    raise ValueError('MPV download redirected away from HTTPS')
                length = source.headers.get('Content-Length')
                if length and int(length) > LIMIT:
                    raise ValueError('MPV archive is too large')
                total = 0
                while chunk := source.read(1024**2):
                    total += len(chunk)
                    if total > LIMIT or time.monotonic() > deadline:
                        raise ValueError('MPV download exceeds size or time budget')
                    target.write(chunk)
        if digest(temporary) != expected:
            raise ValueError('MPV download checksum mismatch; installed runtime preserved')
        os.link(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def install_archive(archive, target, cache, expected, sizes=None, strict_binaries=False):
    """Install only verified members. Callers validate all names and directories."""
    with zipfile.ZipFile(archive) as package:
        files = package.infolist()
        for name, checksum in expected.items():
            matches = [entry for entry in files if entry.filename == name]
            if len(matches) != 1:
                raise ValueError('Pinned archive member is missing or duplicated: ' + name)
            entry = matches[0]
            limit = 4 * 1024**2 if name == 'LICENSE.GPL' else 512 * 1024**2
            if entry.is_dir() or stat.S_ISLNK(entry.external_attr >> 16) or not 0 < entry.file_size <= limit:
                raise ValueError('Unsafe MPV archive member: ' + name)
            if sizes is not None and entry.file_size != sizes[name]:
                raise ValueError('MPV archive member size mismatch: ' + name)
            with package.open(entry) as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != checksum:
                    raise ValueError('MPV archive member checksum mismatch: ' + name)
        if strict_binaries and target.exists():
            actual = {file.name.casefold() for file in target.iterdir() if file.suffix.lower() in ('.exe', '.dll')}
            if actual - {name.casefold() for name in expected}:
                raise ValueError('Unexpected binary in candidate directory; existing files preserved')
        # Preflight every target before installing even one missing file.
        for name, checksum in expected.items():
            file = target / name
            if file.exists() or file.is_symlink():
                if not regular(file) or digest(file) != checksum:
                    raise ValueError('Existing MPV runtime differs; refusing to overwrite: ' + name)
        required = sum(package.getinfo(name).file_size for name in expected if not (target / name).exists())
        if required and shutil.disk_usage(cache).free < required + 64 * 1024**2:
            raise ValueError('Insufficient free space to stage MPV runtime')
        target.mkdir(parents=True, exist_ok=True)
        installed = []
        try:
            for name in expected:
                file = target / name
                if file.exists():
                    continue
                with tempfile.NamedTemporaryFile(prefix='mpv-stage-', dir=cache, delete=False) as stream:
                    temporary = Path(stream.name)
                    try:
                        with package.open(name) as source:
                            shutil.copyfileobj(source, stream)
                    except BaseException:
                        stream.close(); temporary.unlink(missing_ok=True); raise
                try:
                    if digest(temporary) != expected[name]:
                        raise ValueError('Staged MPV file checksum mismatch')
                    # Atomic publication cannot overwrite a concurrent target.
                    identity = temporary.stat()
                    os.link(temporary, file)
                    installed.append((file, identity.st_dev, identity.st_ino))
                finally:
                    temporary.unlink(missing_ok=True)
        except BaseException:
            for file, device, inode in installed:
                if regular(file):
                    current = file.stat()
                    if (current.st_dev, current.st_ino) == (device, inode) and digest(file) == expected[file.name]:
                        file.unlink()
            raise


def cached_archive(value, cache, offline, opener):
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / (value['archiveSha256'] + '.zip')
    legacy = cache / 'runtime.zip'
    if not archive.exists() and regular(legacy) and legacy.stat().st_size <= LIMIT and digest(legacy) == value['archiveSha256']:
        archive = legacy
    download(value['url'], archive, value['archiveSha256'], offline, opener)
    return archive


def prepare(root=ROOT, offline=False, opener=urlopen):
    root = Path(root).resolve()
    value = manifest(root)
    cache, target = root / 'build/mpv-download', root / 'bin/mpv'
    for directory in (cache, target):
        owned_directory(directory, root)
    archive = cached_archive(value, cache, offline, opener)
    expected = {'mpv.exe': value['exeSha256'], 'LICENSE.GPL': value['licenseSha256']}
    install_archive(archive, target, cache, expected)
    return {'prepared': True, 'offline': offline, 'archiveVerified': True, 'files': list(expected), 'existingFilesPreserved': True}


def prepare_candidate(root=ROOT, offline=False, opener=urlopen):
    root = Path(root).resolve()
    value = json.loads((root / 'ci/mpv-stable-candidate.json').read_text(encoding='utf-8'))
    if value.get('schema') != 1 or value.get('status') != 'candidate-only' or value.get('distributionReady') is not False:
        raise ValueError('Candidate must remain isolated from production distribution')
    tag, asset = value.get('releaseTag', ''), value.get('asset', '')
    if not re.fullmatch(r'v\d+\.\d+\.\d+', tag, flags=re.ASCII) or not re.fullmatch(r'mpv-[\w.-]+\.zip', asset, flags=re.ASCII):
        raise ValueError('Invalid fixed candidate release')
    if value.get('url') != f'https://github.com/mpv-player/mpv/releases/download/{tag}/{asset}':
        raise ValueError('Unexpected candidate source')
    if not re.fullmatch('[a-f0-9]{40}', value.get('sourceCommit', '')):
        raise ValueError('Candidate requires a full source commit')
    inner = value.get('innerArchive', {})
    if not re.fullmatch(r'mpv-[\w.-]+\.zip', inner.get('name', ''), flags=re.ASCII):
        raise ValueError('Invalid nested candidate archive name')
    for checksum in (value.get('archiveSha256', ''), inner.get('sha256', '')):
        if not re.fullmatch('[a-f0-9]{64}', checksum):
            raise ValueError('Invalid candidate archive digest')
    files = value.get('files', [])
    if not isinstance(files, list) or not 1 <= len(files) <= 128:
        raise ValueError('Invalid candidate file catalog')
    expected, sizes = {}, {}
    for file in files:
        name, size, checksum = file.get('name', ''), file.get('size'), file.get('sha256', '')
        if not re.fullmatch(r'[a-zA-Z0-9_+.-]+\.(exe|dll)', name) or name.casefold() in {key.casefold() for key in expected}:
            raise ValueError('Invalid or duplicate candidate binary name')
        if type(size) is not int or not 0 < size <= 512 * 1024**2 or not re.fullmatch('[a-f0-9]{64}', checksum):
            raise ValueError('Invalid candidate file size or digest')
        expected[name], sizes[name] = checksum, size
    if 'mpv.exe' not in expected or sum(sizes.values()) > 1024**3:
        raise ValueError('Candidate runtime missing or exceeds capacity')
    cache = root / 'build/mpv-stable-candidate'
    unpacked, target = cache / 'unpacked', cache / 'verified-runtime'
    for directory in (cache, unpacked, target):
        owned_directory(directory, root)
    archive = cached_archive(value, cache, offline, opener)
    # Read one fixed inner ZIP rather than recursively extracting arbitrary files.
    install_archive(archive, unpacked, cache, {inner['name']: inner['sha256']})
    install_archive(unpacked / inner['name'], target, cache, expected, sizes, strict_binaries=True)
    return {'prepared': True, 'candidate': tag, 'offline': offline, 'files': list(expected),
            'archiveVerified': True, 'installedAsDefault': False, 'distributionReady': False,
            'runtimeDirectory': target.relative_to(root).as_posix()}


def prepare_sources(root=ROOT, offline=False, opener=urlopen):
    root = Path(root).resolve()
    value = json.loads((root / 'ci/mpv-candidate-sources.json').read_text(encoding='utf-8'))
    candidate = json.loads((root / 'ci/mpv-stable-candidate.json').read_text(encoding='utf-8'))
    if value.get('schema') != 1 or value.get('runtimeArchiveSha256') != candidate.get('archiveSha256'):
        raise ValueError('Source catalog does not match candidate runtime')
    repositories = {'mpv': 'mpv-player/mpv', 'ffmpeg': 'FFmpeg/FFmpeg'}
    entries = value.get('archives', [])
    if not isinstance(entries, list) or not entries or len(entries) > len(repositories):
        raise ValueError('Invalid source catalog')
    seen = set()
    for entry in entries:
        component, revision = entry.get('component'), entry.get('revision', '')
        if component not in repositories or component in seen or not re.fullmatch('[a-f0-9]{40}', revision):
            raise ValueError('Invalid or duplicate source component')
        seen.add(component)
        if entry.get('url') != f'https://codeload.github.com/{repositories[component]}/zip/{revision}' or entry.get('name') != f'{component}-{revision}.zip':
            raise ValueError('Unexpected corresponding source URL or name')
        if not re.fullmatch('[a-f0-9]{64}', entry.get('sha256', '')) or type(entry.get('size')) is not int or not 0 < entry['size'] <= LIMIT:
            raise ValueError('Invalid source archive size or digest')
        if component == 'mpv' and revision != candidate.get('sourceCommit'):
            raise ValueError('MPV source revision differs from candidate')
    cache = root / 'build/mpv-candidate-sources'
    owned_directory(cache, root);cache.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        archive = cache / entry['name']
        download(entry['url'], archive, entry['sha256'], offline, opener)
        if archive.stat().st_size != entry['size']:
            raise ValueError('Source archive size mismatch')
        prefix = ('mpv' if entry['component'] == 'mpv' else 'FFmpeg') + '-' + entry['revision'] + '/'
        with zipfile.ZipFile(archive) as package:
            if not package.infolist() or any(not member.filename.startswith(prefix) for member in package.infolist()):
                raise ValueError('Source archive does not match expected repository revision')
    return {'prepared': True, 'offline': offline, 'archivesVerified': len(entries),
            'distributionReady': False, 'status': 'partial-unreviewed', 'executedSource': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--candidate', action='store_true')
    group.add_argument('--sources', action='store_true')
    args = parser.parse_args()
    action = prepare_sources if args.sources else prepare_candidate if args.candidate else prepare
    print(json.dumps(action(offline=args.offline)))


if __name__ == '__main__':
    main()
