"""Build an isolated, source-pinned Windows CLI candidate, without replacing bin/."""
import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume', type=Path)
    parser.add_argument('--extend-sources', action='store_true')
    args = parser.parse_args()
    if platform.system() != 'Linux':
        raise SystemExit('Run in the existing Ubuntu WSL environment')
    pin = json.loads((ROOT / 'ci/controlled-ffmpeg.json').read_text(encoding='utf-8'))
    for item in pin['sources']:
        archive = ROOT / item['archive']
        if not archive.resolve().is_relative_to((ROOT / 'build').resolve()):
            raise ValueError('Source archives must be project-owned inputs')
        if hashlib.sha256(archive.read_bytes()).hexdigest() != item['archiveSha256']:
            raise ValueError('Source archive changed: ' + item['name'])
    if shutil.disk_usage(ROOT / 'build').free < 4 * 1024**3:
        raise OSError('Candidate compilation requires 4 GiB free')
    folder = args.resume.resolve() if args.resume else Path(tempfile.mkdtemp(prefix='controlled-ffmpeg-', dir=ROOT / 'build'))
    if not folder.is_relative_to((ROOT / 'build').resolve()) or not folder.name.startswith('controlled-ffmpeg-'):
        raise ValueError('Resume target must be an owned candidate build')
    report_file = folder / 'report.json'
    report = json.loads(report_file.read_text(encoding='utf-8')) if args.resume else {
        'schema': 1, 'kind': 'isolated-static-cli-candidate', 'sources': pin['sources'],
        'phases': {}, 'buildPassed': False, 'applicationRuntimeChanged': False,
        'distributionReady': False, 'lineEndingNormalization': []}
    old_sources = report['sources'] if args.resume else []
    if args.resume and old_sources != pin['sources']:
        if not args.extend_sources or not all(item in pin['sources'] for item in old_sources):
            raise ValueError('Resume requires identical source inputs; extension may only append inputs')
        report.setdefault('previousSourceProfiles', []).append(old_sources)
        report['sources'] = pin['sources']
        report['buildPassed'] = False
    (ROOT / 'build/controlled-ffmpeg-latest.json').write_text(json.dumps({'folder': str(folder)}) + '\n')
    source = {item['name']: folder / 'sources' / item['name'] / item['prefix'] for item in pin['sources']}
    new_sources = [item for item in pin['sources'] if item not in old_sources]
    if new_sources:
        for item in new_sources:
            target = folder / 'sources' / item['name']
            target.mkdir(parents=True)
            with tarfile.open(ROOT / item['archive']) as archive:
                archive.extractall(target, filter='data')
            changed = 0
            for file in source[item['name']].rglob('*'):
                if not file.is_file() or file.is_symlink():
                    continue
                data = file.read_bytes()
                if b'\r\n' in data and b'\0' not in data and data.decode('utf-8', errors='ignore').encode('utf-8') == data:
                    file.write_bytes(data.replace(b'\r\n', b'\n'))
                    changed += 1
            report['lineEndingNormalization'].append({'source': item['name'], 'utf8TextFiles': changed,
                'archivesUnchanged': True, 'operation': 'CRLF to LF in extracted build trees only'})
        if not args.resume:
            shutil.copytree(source['graphengine'], source['zimg'] / 'graphengine', dirs_exist_ok=True)
    prefix = folder / 'install'
    tools = ROOT / 'build/native-cross-tools/root/usr'
    autotools = ROOT / 'build/controlled-cli-tools/root/usr'
    cross = str(ROOT / 'build/native-cross-tools/bin/x86_64-w64-mingw32-')
    env = {**os.environ, 'PATH': os.pathsep.join([str(autotools / 'bin'), str(tools / 'bin'), os.environ['PATH']]),
           'PYTHONPATH': str(tools / 'lib/python3/dist-packages'),
           'LD_LIBRARY_PATH': str(tools / 'lib/x86_64-linux-gnu'),
           'PERL5LIB': os.pathsep.join([str(autotools / 'share/autoconf'), str(autotools / 'share/automake-1.16')]),
           'AUTOMAKE_LIBDIR': str(autotools / 'share/automake-1.16'),
           'ACLOCAL': str(autotools / 'bin/aclocal-1.16'),
           'AUTOMAKE': str(autotools / 'bin/automake-1.16'),
           'ACLOCAL_PATH': str(autotools / 'share/aclocal'),
           'PKG_CONFIG_LIBDIR': str(prefix / 'lib/pkgconfig'), 'PKG_CONFIG_PATH': '',
           'CC': cross + 'gcc', 'CXX': cross + 'g++', 'AR': cross + 'ar', 'RANLIB': cross + 'ranlib',
           'STRINGS': str(tools / 'bin/x86_64-w64-mingw32-strings'),
           'GIT_CEILING_DIRECTORIES': str(folder)}
    cmakefile = folder / 'windows-x64.cmake'
    cmakefile.write_text('\n'.join(['set(CMAKE_SYSTEM_NAME Windows)', 'set(CMAKE_SYSTEM_PROCESSOR x86_64)',
        *['set(CMAKE_' + key + ' "' + cross + value + '")' for key, value in
          [('C_COMPILER', 'gcc'), ('CXX_COMPILER', 'g++'), ('RC_COMPILER', 'windres'), ('AR', 'ar'), ('RANLIB', 'ranlib')]],
        'set(CMAKE_FIND_ROOT_PATH "' + str(prefix) + '" "' + str(tools / 'x86_64-w64-mingw32') + '")',
        'set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)',
        *['set(CMAKE_FIND_ROOT_PATH_MODE_' + kind + ' ONLY)' for kind in ['LIBRARY', 'INCLUDE', 'PACKAGE']]]) + '\n')
    mesonfile = folder / 'windows-x64.ini'
    mesonfile.write_text("[binaries]\n" + '\n'.join(key + " = '" + cross + value + "'" for key, value in
        [('c', 'gcc'), ('cpp', 'g++'), ('ar', 'ar'), ('strip', 'strip'), ('windres', 'windres'), ('pkg-config', 'pkg-config')]) +
        "\n[properties]\nneeds_exe_wrapper = true\n[host_machine]\nsystem = 'windows'\ncpu_family = 'x86_64'\ncpu = 'x86_64'\nendian = 'little'\n")
    report_file.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    upstream_changed = False

    def run(label, command, cwd=folder, input_bytes=None):
        nonlocal upstream_changed
        old = report['phases'].get(label)
        input_hash = hashlib.sha256(input_bytes).hexdigest() if input_bytes else None
        if not upstream_changed and old and old['passed'] and old['command'] == command and old.get('inputSha256') == input_hash:
            print(label + ' reused completed phase', flush=True)
            return
        upstream_changed = True
        with (folder / (label + '.log')).open('w') as log:
            result = subprocess.run(command, cwd=cwd, env=env, input=input_bytes, stdout=log, stderr=subprocess.STDOUT, timeout=1800)
        report['phases'][label] = {'command': command, 'cwd': str(cwd), 'passed': result.returncode == 0, 'inputSha256': input_hash}
        report_file.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        if result.returncode:
            print((folder / (label + '.log')).read_text(errors='replace')[-3500:], flush=True)
            raise SystemExit(label + ' failed; original runtime untouched')
        print(label + ' passed', flush=True)

    for name, options in [
        ('zlib', ['-DZLIB_COMPAT=ON', '-DBUILD_TESTING=OFF', '-DWITH_GTEST=OFF', '-DWITH_NATIVE_INSTRUCTIONS=OFF']),
        ('xz', ['-DXZ_NLS=OFF', '-DXZ_TOOL_XZ=OFF', '-DXZ_TOOL_XZDEC=OFF', '-DXZ_TOOL_LZMADEC=OFF',
                '-DXZ_TOOL_LZMAINFO=OFF', '-DXZ_TOOL_SCRIPTS=OFF', '-DXZ_DOC=OFF', '-DBUILD_TESTING=OFF']),
        ('opus', ['-DOPUS_BUILD_TESTING=OFF', '-DOPUS_BUILD_PROGRAMS=OFF'])]:
        out = folder / (name + '-build')
        run(name + '-configure', ['cmake', '-S', str(source[name]), '-B', str(out), '-G', 'Ninja',
            '-DCMAKE_TOOLCHAIN_FILE=' + str(cmakefile), '-DCMAKE_INSTALL_PREFIX=' + str(prefix),
            '-DCMAKE_INSTALL_LIBDIR=lib', '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF',
            '-DFETCHCONTENT_FULLY_DISCONNECTED=ON', *options])
        run(name + '-build', ['cmake', '--build', str(out), '--parallel', '6'])
        run(name + '-install', ['cmake', '--install', str(out)])
    run('bzip2-build', ['make', '-j6', 'libbz2.a', 'CC=' + cross + 'gcc', 'AR=' + cross + 'ar',
        'RANLIB=' + cross + 'ranlib'], source['bzip2'])
    (prefix / 'include').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source['bzip2'] / 'bzlib.h', prefix / 'include/bzlib.h')
    shutil.copyfile(source['bzip2'] / 'libbz2.a', prefix / 'lib/libbz2.a')
    run('x264-configure', ['bash', str(source['x264'] / 'configure'), '--host=x86_64-w64-mingw32',
        '--cross-prefix=' + cross, '--prefix=' + str(prefix), '--enable-static', '--disable-cli',
        '--bit-depth=all', '--chroma-format=all'], source['x264'])
    run('x264-build', ['make', '-j6'], source['x264'])
    run('x264-install', ['make', 'install-lib-static', 'install-lib-dev'], source['x264'])
    out = folder / 'dav1d-build'
    run('dav1d-configure', ['/usr/bin/python3', '-m', 'mesonbuild.mesonmain', 'setup', str(out), str(source['dav1d']),
        '--cross-file=' + str(mesonfile), '--prefix=' + str(prefix), '--libdir=lib', '--buildtype=release',
        '--default-library=static', '-Dbitdepths=8,16', '-Denable_tools=false', '-Denable_tests=false', '-Denable_docs=false'])
    run('dav1d-build', [str(tools / 'bin/ninja'), '-C', str(out), '-j6'])
    run('dav1d-install', [str(tools / 'bin/ninja'), '-C', str(out), 'install'])
    run('zimg-autogen', ['sh', 'autogen.sh'], source['zimg'])
    run('zimg-configure', ['sh', 'configure', '--host=x86_64-w64-mingw32', '--prefix=' + str(prefix),
        '--enable-static', '--disable-shared', '--disable-testapp', '--disable-unit-test', '--disable-example'], source['zimg'])
    run('zimg-build', ['make', '-j6'], source['zimg'])
    run('zimg-install', ['make', 'install'], source['zimg'])
    vpx_env = {**env, 'CROSS': cross}
    previous_env = env
    env = vpx_env
    run('vpx-configure', ['bash', str(source['vpx'] / 'configure'), '--target=x86_64-win64-gcc',
        '--prefix=' + str(prefix), '--disable-examples', '--disable-tools', '--disable-docs',
        '--disable-unit-tests', '--enable-vp9-highbitdepth', '--enable-runtime-cpu-detect',
        '--disable-shared', '--enable-static'], source['vpx'])
    run('vpx-build', ['make', '-j6'], source['vpx'])
    run('vpx-install', ['make', 'install'], source['vpx'])
    env = previous_env
    for depth in [12, 10, 8]:
        out = folder / ('x265-' + str(depth))
        options = ['-DHIGH_BIT_DEPTH=ON', '-DEXPORT_C_API=OFF'] if depth > 8 else [
            '-DLINKED_10BIT=ON', '-DLINKED_12BIT=ON', '-DEXTRA_LIB=x265_main10.a;x265_main12.a', '-DEXTRA_LINK_FLAGS=-L.']
        if depth == 12:
            options += ['-DMAIN12=ON']
        if depth == 8:
            out.mkdir(exist_ok=True)
            for high in [10, 12]:
                shutil.copyfile(folder / ('x265-' + str(high)) / 'libx265.a', out / ('libx265_main' + str(high) + '.a'))
        run('x265-' + str(depth) + '-configure', ['cmake', '-S', str(source['x265'] / 'source'), '-B', str(out),
            '-G', 'Ninja', '-DCMAKE_TOOLCHAIN_FILE=' + str(cmakefile), '-DCMAKE_INSTALL_PREFIX=' + str(prefix),
            '-DCMAKE_BUILD_TYPE=Release', '-DENABLE_SHARED=OFF', '-DENABLE_CLI=OFF', '-DENABLE_LIBNUMA=OFF', *options])
        run('x265-' + str(depth) + '-build', ['cmake', '--build', str(out), '--parallel', '6'])
    run('x265-install', ['cmake', '--install', str(folder / 'x265-8')])
    for high in [10, 12]:
        shutil.copyfile(folder / ('x265-' + str(high)) / 'libx265.a', prefix / ('lib/libx265_main' + str(high) + '.a'))
    mri = 'CREATE libx265.a\n' + '\n'.join('ADDLIB ' + str(folder / ('x265-' + str(depth)) / 'libx265.a') for depth in [8, 10, 12]) + '\nSAVE\nEND\n'
    (folder / 'x265-multilib.mri').write_text(mri)
    run('x265-merge', [cross + 'ar', '-M'], prefix / 'lib', mri.encode())
    # CMake records the compiler's default shared exception runtime in x265.pc.
    # This profile links the final programs statically; select its static SEH
    # counterpart rather than importing libgcc_s and duplicating unwinder symbols.
    pkgconfig = prefix / 'lib/pkgconfig/x265.pc'
    original_pkgconfig = pkgconfig.read_bytes()
    static_pkgconfig = original_pkgconfig.replace(b' -lgcc_s', b' -lgcc_eh')
    if static_pkgconfig != original_pkgconfig:
        pkgconfig.write_bytes(static_pkgconfig)
        upstream_changed = True
        report['x265StaticPkgConfigFix'] = {
            'originalSha256': hashlib.sha256(original_pkgconfig).hexdigest(),
            'staticSha256': hashlib.sha256(static_pkgconfig).hexdigest(),
            'operation': 'Select static gcc_eh instead of the compiler-default gcc_s import library'}
    out = folder / 'ffmpeg-build'
    out.mkdir(exist_ok=True)
    run('ffmpeg-configure', [str(source['ffmpeg'] / 'configure'), '--prefix=' + str(prefix),
        '--target-os=mingw32', '--arch=x86_64', '--enable-cross-compile', '--cross-prefix=' + cross,
        '--pkg-config=' + cross + 'pkg-config', '--pkg-config-flags=--static',
        '--enable-static', '--disable-shared', '--disable-debug', '--disable-doc', '--disable-ffplay',
        '--disable-autodetect', '--enable-gpl', '--enable-version3', '--enable-libx264', '--enable-libdav1d',
        '--enable-libzimg', '--enable-libx265', '--enable-libvpx', '--enable-libopus',
        '--enable-zlib', '--enable-bzlib', '--enable-lzma', '--enable-schannel',
        '--enable-d3d11va', '--enable-dxva2', '--extra-cflags=-I' + str(prefix / 'include'),
        '--extra-ldflags=-static -L' + str(prefix / 'lib'), '--extra-version=avhub-controlled'], out)
    run('ffmpeg-build', ['make', '-j6'], out)
    run('ffmpeg-install', ['make', 'install'], out)
    report.update(buildPassed=True, binaries=[{'path': file.relative_to(folder).as_posix(),
        'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': file.stat().st_size}
        for file in sorted((prefix / 'bin').glob('*.exe'))])
    report_file.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'folder': str(folder), 'buildPassed': True, 'applicationRuntimeChanged': False}))


if __name__ == '__main__':
    build()
