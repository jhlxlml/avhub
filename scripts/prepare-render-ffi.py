"""Pinned minimal Koffi runtime for the isolated M2 prototype; no install scripts."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def prepare(offline=False):
    manifest = json.loads((ROOT / 'ci/render-ffi/runtime-manifest.json').read_text())
    assert manifest['version'] == '3.3.4' and manifest['platform'] == 'win32-x64'
    folder = ROOT / 'build/libmpv-render-spike/ffi'
    names = set()
    for item in manifest['files']:
        name = PurePosixPath(item['name'])
        assert not name.is_absolute() and '..' not in name.parts and '\\' not in item['name'] and ':' not in item['name']
        assert item['name'] not in names and item['name'].startswith(('node_modules/koffi/', 'node_modules/@koromix/koffi-win32-x64/'))
        names.add(item['name'])
    def owned(path):
        assert path.absolute().is_relative_to(ROOT)
        for p in [path, *path.parents]:
            if p == ROOT:
                break
            assert not p.is_symlink() and not p.is_junction(), 'Redirected preparation path'
        return path
    owned(folder)
    for item in manifest['files']:
        target = owned(folder / item['name'])
        if target.exists():
            data = target.read_bytes()
            assert len(data) == item['size'] and hashlib.sha256(data).hexdigest() == item['sha256'], 'Changed FFI runtime'
            continue
        assert not offline, 'Missing FFI runtime: ' + item['name']
        archive = next(a for a in manifest['archives'] if item['name'].startswith(a['prefix'] + '/'))
        # Registry, exact archive identities; never run package install hooks.
        assert archive['url'].startswith('https://registry.npmjs.org/')
        with urlopen(archive['url'], timeout=30) as response:
            payload = response.read(20 * 1024**2 + 1)
        assert len(payload) <= 20 * 1024**2
        assert 'sha512-' + base64.b64encode(hashlib.sha512(payload).digest()).decode() == archive['integrity']
        with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as bundle:
            for entry in manifest['files']:
                if not entry['name'].startswith(archive['prefix'] + '/'):
                    continue
                output = owned(folder / entry['name'])
                member = bundle.getmember('package/' + entry['name'][len(archive['prefix']) + 1:])
                assert member.isfile() and member.size == entry['size']
                data = bundle.extractfile(member).read()
                assert hashlib.sha256(data).hexdigest() == entry['sha256']
                output.parent.mkdir(parents=True, exist_ok=True)
                if not output.exists():
                    with output.open('xb') as stream:
                        stream.write(data)
    print('Pinned M2 FFI files verified:', len(manifest['files']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    prepare(parser.parse_args().offline)
