"""Isolated libmpv source compatibility experiment; never changes active pins."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]

if __name__ == '__main__':
    if os.name == 'nt':
        raise SystemExit('Run with Ubuntu WSL Python')
    base_name = json.loads((ROOT / 'build/libmpv-chain-replay-latest.json').read_text())['folder'].replace('\\', '/').split('/')[-1]
    base = ROOT / 'build' / base_name
    assert base.name.startswith('libmpv-chain-replay-') and base.resolve() == base and not base.is_symlink()
    prior = json.loads((base / 'report.json').read_text())
    assert prior['buildPassed'] and prior['windowsTestsPassed']
    archive = ROOT / prior['source']['archive']
    assert hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() == prior['source']['archiveSha256']
    patch = ROOT / 'ci/patches/mkv-reversed-cues.patch'
    folder = Path(tempfile.mkdtemp(prefix='mkv-index-candidate-', dir=ROOT / 'build'))
    source, output, prefix = folder / 'source', folder / 'build', folder / 'install'
    source.mkdir()
    subprocess.run(['tar', '-xf', str(archive), '-C', str(source), '--no-same-owner', '--no-same-permissions'], check=True)
    inputs = {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in ('demux/demux_mkv.c', 'demux/ebml.c')}
    before = hashlib.sha256((source / 'demux/demux_mkv.c').read_bytes()).hexdigest()
    subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(patch)], cwd=source, check=True)
    crossfile = folder / 'windows-x64.ini'
    shutil.copyfile(base / 'windows-x64.ini', crossfile)
    tools = ROOT / 'build/native-cross-tools/root/usr'
    env = {**os.environ, 'PATH': str(tools / 'bin') + os.pathsep + os.environ['PATH'],
           'PYTHONPATH': str(tools / 'lib/python3/dist-packages'), 'LD_LIBRARY_PATH': str(tools / 'lib/x86_64-linux-gnu'),
           'GIT_CEILING_DIRECTORIES': str(folder), 'XDG_CACHE_HOME': str(folder / 'cache')}
    args = [arg.replace(str(base), str(folder)) for arg in prior['configureArguments']]
    report = {'kind': 'isolated-mkv-index-source-compatibility', 'base': base_name,
              'source': prior['source'], 'patchSha256': hashlib.sha256(patch.read_bytes()).hexdigest(),
              'originalSourceSha256': before, 'patchedSourceSha256': hashlib.sha256((source / 'demux/demux_mkv.c').read_bytes()).hexdigest(),
              'sourceFiles': [{'name': name, 'before': value, 'after': hashlib.sha256((source / name).read_bytes()).hexdigest()} for name, value in inputs.items()],
              'configureArguments': args, 'buildPassed': False, 'windowsTestsPassed': False, 'distributionReady': False}
    (folder / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    for name, command in [('configure', args), ('build', [str(tools / 'bin/ninja'), '-C', str(output), '-j8']),
                          ('install', [str(tools / 'bin/ninja'), '-C', str(output), 'install'])]:
        with (folder / (name + '.log')).open('w') as log:
            subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1200)
        print(name + ' PASS', flush=True)
    dlls = list((prefix / 'bin').glob('*mpv*.dll'))
    assert len(dlls) == 1
    if dlls[0].name != 'libmpv-2.dll':
        shutil.copyfile(dlls[0], prefix / 'bin/libmpv-2.dll')
    for item in prior['binaries']:
        file = base / item['path']
        assert hashlib.file_digest(file.open('rb'), 'sha256').hexdigest() == item['sha256']
        if file.name not in ('libmpv-2.dll', dlls[0].name):
            shutil.copyfile(file, prefix / 'bin' / file.name)
    report['buildPassed'] = True
    report['dllSha256'] = hashlib.file_digest((prefix / 'bin/libmpv-2.dll').open('rb'), 'sha256').hexdigest()
    (folder / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    (ROOT / 'build/mkv-index-candidate-latest.json').write_text(json.dumps({'folder': str(folder)}) + '\n')
    print(json.dumps({'folder': str(folder), 'sha256': report['dllSha256']}), flush=True)
