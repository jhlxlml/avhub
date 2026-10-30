"""Stage a source-built MPV alongside its matching notices and build receipt.

Does not install, approve redistribution, package the application or publish.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def stage():
    selected = json.loads((ROOT / 'build/desktop-mpv-build-latest.json').read_text(encoding='utf-8'))['folder']
    build = ROOT / 'build' / selected.replace('\\', '/').split('/')[-1]
    if not build.name.startswith('desktop-mpv-build-') or build.is_symlink() or build.resolve() != build:
        raise ValueError('Owned desktop MPV build required')
    report = json.loads((build / 'report.json').read_text(encoding='utf-8'))
    if not report['buildPassed']:
        raise ValueError('Build did not pass')
    if hashlib.sha256((ROOT / 'scripts/build-desktop-mpv.py').read_bytes()).hexdigest() != report['recipeSha256']:
        raise ValueError('Deliver the actual build recipe, not a later replacement')
    imports = json.loads((build / 'import-audit.json').read_text(encoding='utf-8'))
    if not imports['windowsOsImportsResolved']:
        raise ValueError('Windows PE dependency validation required')
    runtime = build / 'runtime'
    for item in report['files']:
        file = runtime / item['name']
        if file.is_symlink() or file.parent != runtime or hashlib.file_digest(file.open('rb'), 'sha256').hexdigest() != item['sha256']:
            raise ValueError('Built runtime changed')
    result = subprocess.run([str(runtime / 'mpv.exe'), '--version'], capture_output=True, timeout=20, check=True)
    folder = Path(tempfile.mkdtemp(prefix='mpv-desktop-runtime-', dir=ROOT / 'build'))
    for item in report['files']:
        shutil.copyfile(runtime / item['name'], folder / item['name'])
    render = Path(json.loads((ROOT / 'build/replayed-render-staging.json').read_text(encoding='utf-8'))['folder'])
    layout = json.loads((render / 'layout.json').read_text(encoding='utf-8'))
    for item in layout['files']:
        if not item['path'].startswith('materials/'):
            continue
        source = render / item['path']
        if hashlib.file_digest(source.open('rb'), 'sha256').hexdigest() != item['sha256']:
            raise ValueError('Dependency material changed')
        target = folder / item['path']; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, target)
    shutil.copyfile(build / 'report.json', folder / 'materials/desktop-build.json')
    shutil.copyfile(build / 'import-audit.json', folder / 'materials/desktop-import-audit.json')
    shutil.copyfile(ROOT / 'scripts/build-desktop-mpv.py', folder / 'materials/build-desktop-mpv.py')
    shutil.copyfile(ROOT / 'scripts/stage-desktop-mpv.py', folder / 'materials/stage-desktop-mpv.py')
    manifest = {'schema': 1, 'status': 'source-built-candidate', 'sourceCommit': report['mpvSource']['revision'],
                'sourceArchiveSha256': report['mpvSource']['archiveSha256'],
                'recipeSha256': report['recipeSha256'],
                'luaSource': report['luaSource'], 'distributionReady': False,
                'exeSha256': hashlib.file_digest((folder / 'mpv.exe').open('rb'), 'sha256').hexdigest(),
                'licenseSha256': hashlib.file_digest((folder / 'LICENSE.GPL').open('rb'), 'sha256').hexdigest(),
                'dependencies': [{'name': p.name, 'size': p.stat().st_size, 'sha256': hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()} for p in sorted(folder.glob('*.dll'))],
                'buildReceipt': str(build / 'report.json'), 'versionSmoke': result.stdout.decode('utf-8', 'replace'),
                'releaseBlockers': ['Source delivery bundle and actual packaged independent-window acceptance pending']}
    (folder / 'runtime.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'build/desktop-mpv-runtime-latest.json').write_text(json.dumps({'folder': str(folder), 'manifest': manifest}) + '\n', encoding='utf-8')
    print(json.dumps({'folder': str(folder), 'exeSha256': manifest['exeSha256'], 'dependencies': len(manifest['dependencies'])}))


if __name__ == '__main__':
    stage()
