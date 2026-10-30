"""Extract private Autotools for the controlled CLI build; never install packages."""
import hashlib
import json
import platform
import runpy
import shutil
import subprocess
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def prepare():
    if platform.system() != 'Linux':
        raise SystemExit('Run in the existing Ubuntu WSL environment')
    folder = ROOT / 'build/controlled-cli-tools'
    cache, tree = folder / 'packages', folder / 'root'
    cache.mkdir(parents=True, exist_ok=True)
    tree.mkdir(exist_ok=True)
    metadata = runpy.run_path(str(ROOT / 'scripts/prepare-native-cross-tools.py'))['package_metadata']
    versions = {'autoconf': '2.71-3', 'automake': '1:1.16.5-1.3ubuntu1', 'autotools-dev': '20220109.1',
                'libtool': '2.4.7-7build1', 'm4': '1.4.19-4build1'}
    lock = ROOT / 'ci/controlled-cli-autotools.json'
    records = json.loads(lock.read_text(encoding='utf-8'))['packages'] if lock.exists() else [metadata(name, version) for name, version in versions.items()]
    if [(item['package'], item['version']) for item in records] != list(versions.items()):
        raise ValueError('Autotools lock differs from the fixed versions')
    report = {'schema': 1, 'packages': records, 'systemPackagesInstalled': False,
              'hostClosureVerified': False, 'relocatedScripts': []}
    (folder / 'inputs.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    for item in records:
        target = cache / Path(item['filename']).name
        if not target.exists():
            if lock.exists():
                filename = item['filename']
                if not filename.startswith('pool/') or '..' in Path(filename).parts:
                    raise ValueError('Invalid official package path')
                with urlopen('https://archive.ubuntu.com/ubuntu/' + filename, timeout=60) as response, target.open('xb') as stream:
                    shutil.copyfileobj(response, stream)
            else:
                subprocess.run(['apt-get', '-o', 'Acquire::Retries=0', '-o',
                                'Acquire::http::Timeout=30', 'download', item['package'] + '=' + item['version']],
                               cwd=cache, check=True, timeout=60)
            matches = [p for p in cache.glob(item['package'] + '_*.deb')
                       if hashlib.sha256(p.read_bytes()).hexdigest() == item['sha256']]
            if not target.exists() and len(matches) == 1:
                matches[0].rename(target)
        if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Pinned tool package missing or changed: ' + item['package'])
        subprocess.run(['dpkg-deb', '--extract', str(target), str(tree)], check=True, timeout=30)
    # Debian scripts embed /usr/share and helper paths. Relocate only private copies;
    # retain original package hashes and each changed script hash in the receipt.
    settings = [tree / 'usr/share/autoconf/autom4te.cfg',
                tree / 'usr/share/automake-1.16/Automake/Config.pm']
    for file in sorted([*(tree / 'usr/bin').iterdir(), *settings]):
        if not file.is_file() or file.is_symlink() or (file not in settings and file.read_bytes()[:2] != b'#!'):
            continue
        original = file.read_bytes()
        content = original.replace(b'/usr/share/', str(tree / 'usr/share').encode() + b'/')
        for helper in ('autom4te', 'autoconf', 'autoheader', 'automake', 'aclocal', 'm4'):
            content = content.replace(('/usr/bin/' + helper).encode(), str(tree / 'usr/bin' / helper).encode())
        if content != original:
            file.write_bytes(content)
            report['relocatedScripts'].append({'path': file.relative_to(folder).as_posix(),
                'originalSha256': hashlib.sha256(original).hexdigest(),
                'sha256': hashlib.sha256(content).hexdigest()})
    (folder / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'folder': str(folder), 'packages': len(records), 'installedSystemPackages': False}))


if __name__ == '__main__':
    prepare()
