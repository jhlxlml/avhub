"""Build a Lua-capable Windows MPV EXE from pinned sources in Ubuntu WSL.

Reuse the already rebuilt/attested render dependency prefixes. Never overwrite
the installed player. The report is build evidence, not a distribution signoff.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    if os.name == 'nt':
        raise SystemExit('Use Ubuntu WSL Python')
    selected = json.loads((ROOT / 'build/libmpv-chain-replay-latest.json').read_text())['folder']
    base = ROOT / 'build' / selected.replace('\\', '/').split('/')[-1]
    if not base.name.startswith('libmpv-chain-replay-') or base.is_symlink() or base.resolve() != base:
        raise ValueError('Owned validated dependency build required')
    prior = json.loads((base / 'report.json').read_text())
    if not prior['buildPassed'] or not prior['windowsTestsPassed']:
        raise ValueError('Validated rebuilt MPV dependencies required')
    lua_archive = ROOT / 'build/native-git-inputs/luajit-5d8d0a27bfa4.tar'
    lua = json.loads(lua_archive.with_suffix('.json').read_text())
    archives = [(ROOT / prior['source']['archive'], prior['source']['archiveSha256']),
                (lua_archive, lua['archiveSha256'])]
    for file, expected in archives:
        if hashlib.file_digest(file.open('rb'), 'sha256').hexdigest() != expected:
            raise ValueError('Source archive changed')
    folder = Path(tempfile.mkdtemp(prefix='desktop-mpv-build-', dir=ROOT / 'build'))
    report = {'kind': 'source-built-lua-windows-mpv', 'buildPassed': False,
              'recipeSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'toolchainManifestSha256': hashlib.sha256((ROOT / 'build/native-cross-tools/report.json').read_bytes()).hexdigest(),
              'mpvSource': prior['source'], 'luaSource': lua,
              'dependencyStages': prior['dependencyStages'], 'compilerReused': True,
              'installedRuntimeReplaced': False, 'distributionReady': False, 'commands': []}
    (ROOT / 'build/desktop-mpv-build-latest.json').write_text(json.dumps({'folder': str(folder)}))
    tools = ROOT / 'build/native-cross-tools'
    env = {**os.environ, 'PATH': str(tools / 'root/usr/bin') + ':' + os.environ['PATH'],
           'PYTHONPATH': str(tools / 'root/usr/lib/python3/dist-packages'),
           'LD_LIBRARY_PATH': str(tools / 'root/usr/lib/x86_64-linux-gnu')}

    def run(label, args, cwd=folder):
        report['commands'].append({'label': label, 'args': list(map(str, args))})
        with (folder / (label + '.log')).open('w') as log:
            subprocess.run(args, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=600)
        print(label + ' passed', flush=True)

    try:
        lua_tree, tree = folder / 'luajit', folder / 'mpv'
        lua_tree.mkdir(); tree.mkdir()
        run('extract-lua', ['tar', '-xf', str(lua_archive), '-C', str(lua_tree)])
        run('extract-mpv', ['tar', '-xf', str(archives[0][0]), '-C', str(tree)])
        run('lua-build', ['make', '-j4', 'HOST_CC=/usr/bin/gcc', 'CC=gcc',
                          'CROSS=' + str(tools / 'bin/x86_64-w64-mingw32-'),
                          'TARGET_SYS=Windows', 'BUILDMODE=dynamic', 'XCFLAGS=-DLUAJIT_ENABLE_LUA52COMPAT'], lua_tree)
        lua_prefix = folder / 'lua-prefix'
        (lua_prefix / 'lib/pkgconfig').mkdir(parents=True)
        (lua_prefix / 'include/luajit-2.1').mkdir(parents=True)
        for name in ('lua.h', 'lualib.h', 'lauxlib.h', 'luaconf.h', 'luajit.h'):
            shutil.copyfile(lua_tree / 'src' / name, lua_prefix / 'include/luajit-2.1' / name)
        shutil.copyfile(lua_tree / 'src/libluajit-5.1.dll.a', lua_prefix / 'lib/libluajit-5.1.dll.a')
        (lua_prefix / 'lib/pkgconfig/luajit.pc').write_text(
            f'prefix={lua_prefix}\nlibdir=${{prefix}}/lib\nincludedir=${{prefix}}/include/luajit-2.1\n'
            'Name: LuaJIT\nDescription: Pinned Windows LuaJIT\nVersion: 2.1.0\nLibs: -L${libdir} -lluajit-5.1\nCflags: -I${includedir}\n')
        cross = folder / 'windows-x64.ini'
        cross.write_text((base / 'windows-x64.ini').read_text().replace("pkg_config_libdir = '", "pkg_config_libdir = '" + str(lua_prefix / 'lib/pkgconfig') + ':'))
        args = prior['configureArguments'].copy()
        args[args.index('setup') + 1:args.index('setup') + 3] = [str(folder / 'build'), str(tree)]
        args = [str(cross) if arg.startswith('--cross-file=') else arg for arg in args]
        args = ['--cross-file=' + arg if arg == str(cross) else arg for arg in args]
        args = ['--prefix=' + str(folder / 'install') if arg.startswith('--prefix=') else
                '-Dlibmpv=false' if arg == '-Dlibmpv=true' else '-Dlua=luajit' if arg == '-Dlua=disabled' else arg for arg in args]
        run('configure', args)
        run('compile', [str(tools / 'root/usr/bin/ninja'), '-C', str(folder / 'build'), '-j4'])
        runtime = folder / 'runtime'; runtime.mkdir()
        shutil.copyfile(folder / 'build/mpv.exe', runtime / 'mpv.exe')
        shutil.copyfile(lua_tree / 'src/lua51.dll', runtime / 'lua51.dll')
        shutil.copyfile(tree / 'LICENSE.GPL', runtime / 'LICENSE.GPL')
        shutil.copyfile(lua_tree / 'COPYRIGHT', runtime / 'LuaJIT-COPYRIGHT.txt')
        for dependency in prior['dependencyStages'].values():
            stage = ROOT / dependency
            for binary in json.loads((stage / 'report.json').read_text())['binaries']:
                source = stage / binary['path']
                if source.suffix != '.dll':
                    continue
                if hashlib.file_digest(source.open('rb'), 'sha256').hexdigest() != binary['sha256']:
                    raise ValueError('Rebuilt dependency changed')
                target = runtime / source.name
                if target.exists() and target.read_bytes() != source.read_bytes():
                    raise ValueError('Conflicting dependency')
                shutil.copyfile(source, target)
        report.update(buildPassed=True, runtime=str(runtime),
                      binaries=[{'path': p.relative_to(folder).as_posix(), 'sha256': hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()} for p in sorted(runtime.iterdir()) if p.suffix in ('.dll', '.exe')],
                      files=[{'name': p.name, 'sha256': hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()} for p in sorted(runtime.iterdir())])
    finally:
        (folder / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'folder': str(folder), 'buildPassed': report['buildPassed']}), flush=True)


if __name__ == '__main__':
    main()
