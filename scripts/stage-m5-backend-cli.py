"""Create a dedicated M5 backend payload; leave default bin/ and backend intact."""
import hashlib
import argparse
import json
import shutil
import tempfile
from pathlib import Path

from controlled_cli_runtime import prepare

ROOT = Path(__file__).resolve().parents[1]


def stage():
    parser=argparse.ArgumentParser();parser.add_argument('--backend-replay',type=Path);args=parser.parse_args()
    runtime = Path(json.loads((ROOT / 'build/controlled-cli-runtime-latest.json').read_text(encoding='utf-8'))['folder'])
    acceptance = Path(json.loads((ROOT / 'build/controlled-cli-validation-latest.json').read_text(encoding='utf-8'))['folder'])
    evidence = json.loads((acceptance / 'report.json').read_text(encoding='utf-8'))
    current = json.loads((runtime / 'runtime-index.json').read_text(encoding='utf-8'))
    expected = {Path(item['path']).name: item['sha256'] for item in evidence['observedBinaries']}
    if not evidence['passed'] or any(expected.get(item['path']) != item['sha256'] for item in current['files'] if item['path'].endswith('.exe')):
        raise ValueError('Actual Windows comparison must match staged executables')
    folder = Path(tempfile.mkdtemp(prefix='m5-controlled-backend-', dir=ROOT / 'build'))
    prepare(ROOT, runtime, folder / 'cli-inputs')
    original = ROOT / 'build/backend-dist/AVHubServer'
    replay_receipt = None
    baseline = json.loads((ROOT / 'ci/m5-python-runtime-inputs.json').read_text(encoding='utf-8'))
    if args.backend_replay:
        replay=args.backend_replay.resolve()
        if not replay.is_relative_to((ROOT/'build').resolve()) or replay.is_symlink() or replay.is_junction():
            raise ValueError('Expected an owned backend replay')
        replay_receipt=json.loads((replay/'backend-replay-report.json').read_text(encoding='utf-8'))
        frontend_receipt=json.loads((replay/'replay-report.json').read_text(encoding='utf-8'))
        verification=json.loads(Path(replay_receipt['verificationReceipt']).read_text(encoding='utf-8'))
        if not replay_receipt['passed'] or not frontend_receipt['passed'] or not verification['passed']:
            raise ValueError('Backend source replay must pass before staging')
        if frontend_receipt['buildId'] != json.loads((ROOT/'app/build-info.json').read_text(encoding='utf-8'))['build_id']:
            raise ValueError('Backend replay is not the current application build')
        source=Path(frontend_receipt['source'])
        baseline=json.loads((source/'source-review-inventory.json').read_text(encoding='utf-8'))
        original=replay/'build/backend-dist/AVHubServer'
        if hashlib.sha256((original/'AVHubServer.exe').read_bytes()).hexdigest()!=verification['executableSha256']:
            raise ValueError('Replayed backend executable changed after verification')
        run=next(item for item in baseline['files'] if item['path']=='run.py')
        if hashlib.sha256((ROOT/'run.py').read_bytes()).hexdigest()!=run['sha256']:
            raise ValueError('Backend entry point changed after replay')
    python_inputs = [item for item in baseline['files'] if item['path'].startswith('app/') and item['path'].endswith('.py')]
    actual_python = {file.relative_to(ROOT).as_posix() for file in (ROOT / 'app').rglob('*.py')}
    if actual_python != {item['path'] for item in python_inputs} or any(hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256'] for item in python_inputs):
        raise ValueError('Python runtime source changed; rebuild the frozen backend before reusing its executable')
    backend = folder / 'AVHubServer'
    # Electron's resource copier excludes development-agent metadata. Keep the
    # staged payload byte-exact with the deliverable instead of weakening the
    # complete resource-tree hash at release admission.
    shutil.copytree(original, backend, ignore=shutil.ignore_patterns('.agents'))
    original_exe = hashlib.sha256((original / 'AVHubServer.exe').read_bytes()).hexdigest()
    # PyInstaller onedir stores these data files outside its Python archive.
    # Reuse the verified unchanged Python executable, but refresh the frontend
    # and build metadata explicitly; never combine new JS with old static data.
    static = backend / '_internal/app/static'
    if not static.resolve().is_relative_to(folder.resolve()) or any(file.is_symlink() or file.is_junction() for file in static.rglob('*')):
        raise ValueError('Unexpected staged frontend path/link')
    shutil.rmtree(static)
    shutil.copytree(ROOT / 'app/static', static)
    shutil.copyfile(ROOT / 'app/build-info.json', backend / '_internal/app/build-info.json')
    swaps = []
    for item in current['files']:
        target = backend / '_internal' / ('bin' if item['path'].endswith('.exe') else 'licenses') / item['path']
        previous = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
        shutil.copyfile(folder / 'cli-inputs' / item['path'], target)
        swaps.append({'path': target.relative_to(backend).as_posix(), 'previousSha256': previous, 'sha256': item['sha256']})
    shutil.copyfile(runtime / 'runtime-index.json', backend / '_internal/licenses/FFmpeg-RUNTIME.json')
    if hashlib.sha256((backend / 'AVHubServer.exe').read_bytes()).hexdigest() != original_exe:
        raise ValueError('Backend executable unexpectedly changed')
    report = {'kind': 'dedicated-m5-controlled-cli-payload', 'backend': str(backend), 'runtime': str(runtime),
        'windowsCliAcceptance': str(acceptance), 'backendExeSha256': original_exe, 'swaps': swaps,
        'defaultProjectBinariesUnchanged': True, 'defaultBackendUnchanged': True, 'packaged': False,
        'unchangedPythonSourceInputsVerified': len(python_inputs), 'externalFrontendAndMetadataRefreshed': True,
        'build': json.loads((ROOT / 'app/build-info.json').read_text(encoding='utf-8')),
        'backendSourceReplay':str(args.backend_replay) if args.backend_replay else None}
    (folder / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'build/m5-controlled-backend-latest.json').write_text(json.dumps({'folder': str(folder), 'backend': str(backend)}) + '\n')
    print(json.dumps({'backend': str(backend), 'defaultRuntimeChanged': False}))


if __name__ == '__main__':
    stage()
