"""Stage exact self-built CLI files and full notices, without adopting or publishing."""
import hashlib
import json
import shutil
import tempfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]


def stage():
    pin_file = ROOT / 'ci/controlled-ffmpeg.json'
    pin = json.loads(pin_file.read_text(encoding='utf-8'))
    pointer = json.loads((ROOT / 'build/controlled-ffmpeg-latest.json').read_text(encoding='utf-8'))
    candidate = ROOT / 'build' / PurePosixPath(pointer['folder'].replace('\\', '/')).name
    report = json.loads((candidate / 'report.json').read_text(encoding='utf-8'))
    identities = lambda sources: sorted((s['name'], s['revision'], s['archiveSha256']) for s in sources)
    if not report['buildPassed'] or identities(report['sources']) != identities(pin['sources']):
        raise ValueError('The complete selected source profile must actually be built')
    folder = Path(tempfile.mkdtemp(prefix='controlled-cli-runtime-', dir=ROOT / 'build'))
    for binary in report['binaries']:
        file = candidate / binary['path']
        if file.name not in {'ffmpeg.exe', 'ffprobe.exe'} or hashlib.sha256(file.read_bytes()).hexdigest() != binary['sha256']:
            raise ValueError('Candidate executable changed')
        shutil.copyfile(file, folder / file.name)
    ffmpeg = next(s for s in pin['sources'] if s['name'] == 'ffmpeg')
    extracted = candidate / 'sources/ffmpeg' / ffmpeg['prefix']
    shutil.copyfile(extracted / 'COPYING.GPLv3', folder / 'FFmpeg-LICENSE.txt')
    notices = []
    for source in pin['sources']:
        file = candidate / 'sources' / source['name'] / source['prefix'] / source['license']
        notices.append('\n===== ' + source['name'] + ' / ' + source['revision'] + ' =====\n' +
            'Source: ' + source['repository'] + '\nOriginal license file: ' + source['license'] + '\n\n' + file.read_text(encoding='utf-8'))
        # XZ's COPYING incorporates these license texts by reference.
        if source['name'] == 'xz':
            for license_file in sorted((file.parent / 'COPYING').parent.glob('COPYING.*')):
                notices.append('\n===== xz / ' + license_file.name + ' =====\n' + license_file.read_text(encoding='utf-8'))
            for license_file in sorted((file.parent / 'LICENSES').glob('*.txt')):
                notices.append('\n===== xz / LICENSES/' + license_file.name + ' =====\n' + license_file.read_text(encoding='utf-8'))
    support = ROOT / 'build/native-cross-tools/root/usr/share/doc'
    for component in ['gcc-mingw-w64-base', 'mingw-w64-common']:
        notices.append('\n===== Compiler runtime: ' + component + ' =====\n' + (support / component / 'copyright').read_text(encoding='utf-8'))
    (folder / 'FFmpeg-THIRD-PARTY-NOTICES.txt').write_text('Actual controlled CLI dependency notices; source archives and build recipe are separate delivery materials.\n' + ''.join(notices), encoding='utf-8')
    info = ('AVHub controlled Windows x64 FFmpeg CLI\nCore version: ' + pin['coreVersion'] + '\n'
        'Core commit: ' + ffmpeg['revision'] + '\n'
        'Built from ci/controlled-ffmpeg.json with scripts/build-controlled-ffmpeg.py.\n'
        'GPL v3-or-later configuration; see FFmpeg-LICENSE.txt and FFmpeg-THIRD-PARTY-NOTICES.txt.\n'
        'The original-file and stream-copy paths do not re-encode video or audio.\n'
        'Generic vendor CLI extras outside AVHub are not promised.\n\n' +
        '\n'.join(s['name'] + ': ' + s['revision'] + ' / source tar SHA256 ' + s['archiveSha256'] for s in pin['sources']) +
        '\n\n' + '\n'.join(Path(b['path']).name + ' SHA256 ' + b['sha256'] for b in report['binaries']) + '\n')
    (folder / 'FFmpeg-BUILD-INFO.txt').write_text(info, encoding='utf-8')
    inventory = {'schema': 1, 'kind': 'avhub-controlled-ffmpeg-runtime', 'version': pin['coreVersion'],
        'sourceProfileSha256': hashlib.sha256(pin_file.read_bytes()).hexdigest(),
        'sourceIdentities': identities(pin['sources']),
        'buildRecipeSha256': hashlib.sha256((ROOT / 'scripts/build-controlled-ffmpeg.py').read_bytes()).hexdigest(),
        'crossToolsSha256': hashlib.sha256((ROOT / 'ci/controlled-cli-cross-tools.json').read_bytes()).hexdigest(),
        'files': [{'path': file.name, 'size': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
                  for file in sorted(folder.iterdir())], 'windowsValidationRequired': True}
    (folder / 'runtime-index.json').write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'build/controlled-cli-runtime-latest.json').write_text(json.dumps({'folder': str(folder)}) + '\n')
    print(json.dumps({'folder': str(folder), 'files': len(inventory['files']), 'adopted': False}))


if __name__ == '__main__':
    stage()
