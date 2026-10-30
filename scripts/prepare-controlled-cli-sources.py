"""Recreate exact CLI source archives from fixed upstream commits, without checkout."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def prepare():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'ci/controlled-ffmpeg.json')
    parser.add_argument('--recapture', action='store_true', help='Independently reproduce rather than reuse existing archives')
    args = parser.parse_args()
    pin = json.loads(args.manifest.read_text(encoding='utf-8'))
    cache = ROOT / 'build/controlled-cli-source-cache'
    cache.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(cache).free < 2 * 1024**3:
        raise OSError('Source capture requires 2 GiB free')
    report = {'schema': 1, 'sourceProfileSha256': hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
              'sources': [], 'applicationRuntimeChanged': False}
    for item in pin['sources']:
        destination = ROOT / item['archive']
        if not destination.resolve().is_relative_to((ROOT / 'build').resolve()):
            raise ValueError('Archive output must be project-owned')
        if destination.exists() and not args.recapture:
            if hashlib.sha256(destination.read_bytes()).hexdigest() != item['archiveSha256']:
                raise ValueError('Existing source archive differs: ' + item['name'])
            report['sources'].append({'name': item['name'], 'reusedVerifiedArchive': True})
            continue
        repo = cache / (item['name'] + '.git')
        if not repo.exists():
            subprocess.run(['git', 'init', '--bare', str(repo)], capture_output=True, check=True)
        known = list((ROOT / 'build').glob('ffmpeg-external-source-review-*/' + item['name'] + '.git'))
        known += [ROOT / 'build/controlled-ffmpeg-inputs' / (item['name'] + '.git')]
        if item['name'] == 'ffmpeg':
            known += list((ROOT / 'build').glob('ffmpeg-cli-source-review-*/upstream.git'))
        native = ROOT / ('build/native-git-inputs/' + item['name'] + '-' + item['revision'][:12] + '.json')
        if native.is_file():
            known += [ROOT / json.loads(native.read_text(encoding='utf-8'))['sourceFolder']]
        local = next((file for file in known if file.is_dir()), None)
        present = subprocess.run(['git', '-C', str(repo), 'cat-file', '-e', item['revision']], capture_output=True).returncode == 0
        if not present:
            subprocess.run(['git', '-c', 'credential.interactive=never', '-C', str(repo), 'fetch', '--depth=1',
                            str(local) if local else item['repository'], item['revision']], capture_output=True, check=True, timeout=180)
        captured = cache / (item['name'] + '-' + item['revision'] + '.tar')
        if not captured.exists() or hashlib.sha256(captured.read_bytes()).hexdigest() != item['archiveSha256']:
            subprocess.run(['git', '-c', 'core.autocrlf=' + str(item['archiveAutoCrlf']).lower(), '-C', str(repo),
                'archive', '--format=tar', '--prefix=' + item['prefix'], '--output=' + str(captured), item['revision']], check=True, timeout=600)
        if hashlib.sha256(captured.read_bytes()).hexdigest() != item['archiveSha256']:
            raise ValueError('Recreated source archive differs: ' + item['name'])
        if not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(captured, destination)
        report['sources'].append({'name': item['name'], 'revision': item['revision'],
            'archiveSha256': item['archiveSha256'], 'recreated': True, 'usedExistingGitObjects': local is not None})
        (cache / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(item['name'] + ' source reproduced', flush=True)
    (cache / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sources': len(report['sources']), 'recaptured': args.recapture}))


if __name__ == '__main__':
    prepare()
