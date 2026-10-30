"""Join frozen application, native and controlled-CLI materials without publication."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def stage():
    parser=argparse.ArgumentParser();parser.add_argument('--directory',type=Path,default=ROOT/'build/m5-final-sdr-20261029');parser.add_argument('--name',default='AVHub-M5-source-materials-0.2.16.zip')
    args=parser.parse_args();output=args.directory.resolve()
    if not output.is_relative_to((ROOT/'build').resolve()):raise ValueError('Owned local M5 directory required')
    application = Path(json.loads((ROOT / 'build/application-source-review-latest.json').read_text(encoding='utf-8'))['folder'])
    native = Path(json.loads((ROOT / 'build/native-replayed-source-materials-latest.json').read_text(encoding='utf-8'))['folder'])
    cli = Path(json.loads((ROOT / 'build/controlled-cli-runtime-latest.json').read_text(encoding='utf-8'))['folder'])
    app_index = json.loads((application / 'source-review-inventory.json').read_text(encoding='utf-8'))
    native_index = json.loads((native / 'inventory.json').read_text(encoding='utf-8'))
    profile = json.loads((ROOT / 'ci/controlled-ffmpeg.json').read_text(encoding='utf-8'))
    if Path(args.name).name!=args.name or not args.name.endswith('.zip'):raise ValueError('Expected a ZIP basename')
    archive = output / args.name
    if archive.exists():
        raise ValueError('Preserve existing source delivery; choose a new output before rebuilding')
    entries = []

    def add(file, name, expected=None):
        if not file.resolve().is_relative_to(ROOT.resolve()) or file.is_symlink() or not file.is_file():
            raise ValueError('Expected owned regular material: ' + str(file))
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if expected is not None and digest != expected:
            raise ValueError('Source material changed: ' + name)
        entries.append({'file': file, 'path': name, 'size': file.stat().st_size, 'sha256': digest})

    for item in app_index['files']:
        add(application / item['path'], 'APPLICATION/' + item['path'], item['sha256'])
    add(application / 'source-review-inventory.json', 'APPLICATION/source-review-inventory.json')
    add(ROOT / 'docs/playback-refactor/M5-LOCAL-ACCEPTANCE.md', 'APPLICATION/docs/playback-refactor/M5-LOCAL-ACCEPTANCE.md')
    add(ROOT / 'docs/playback-refactor/62-playback-compatibility-without-whitelist.md', 'APPLICATION/docs/playback-refactor/62-playback-compatibility-without-whitelist.md')
    replay=Path(json.loads((ROOT/'build/application-build-replay-latest.json').read_text(encoding='utf-8'))['folder'])
    for name in ('replay-report.json','backend-replay-report.json'):
        add(replay/name,'APPLICATION/build-evidence/'+name)
    backend=json.loads((replay/'backend-replay-report.json').read_text(encoding='utf-8'))
    add(Path(backend['verificationReceipt']),'APPLICATION/build-evidence/backend-verification.json')
    replay_source=Path(json.loads((replay/'replay-report.json').read_text(encoding='utf-8'))['source'])
    replay_inventory=json.loads((replay_source/'source-review-inventory.json').read_text(encoding='utf-8'))
    delivered_app={item['path']:item['sha256'] for item in app_index['files']}
    for item in replay_inventory['files']:
        product=item['path']
        if (product.startswith(('frontend/','electron/src/','electron/player/'))
            or product in {'package.json','package-lock.json','vite.config.ts','electron/tsconfig.json'}):
            if delivered_app.get(product)!=item['sha256']:
                raise ValueError('Delivered frontend/Electron sources differ from actual replay: '+product)

    binding=json.loads((output/'M5-BUILD-INPUTS.json').read_text(encoding='utf-8'))
    add(output/'M5-BUILD-INPUTS.json','APPLICATION/build-evidence/actual-package-inputs.json')
    actual_backend=Path(binding['actualBackendSourceReplay'])
    for name in ('replay-report.json','backend-replay-report.json'):
        add(actual_backend/name,'APPLICATION/build-evidence/actual-backend-'+name)
    actual_receipt=json.loads((actual_backend/'backend-replay-report.json').read_text(encoding='utf-8'))
    add(Path(actual_receipt['verificationReceipt']),'APPLICATION/build-evidence/actual-backend-verification.json')
    actual_source=Path(json.loads((actual_backend/'replay-report.json').read_text(encoding='utf-8'))['source'])
    actual_inventory=json.loads((actual_source/'source-review-inventory.json').read_text(encoding='utf-8'))
    delivered={v['path']:v['sha256'] for v in app_index['files']}
    for item in actual_inventory['files']:
        if item['path']=='run.py' or item['path'].startswith('app/') and item['path'].endswith('.py'):
            if delivered.get(item['path'])!=item['sha256']:raise ValueError('Delivered backend sources do not match actual compiled package')
    for item in native_index['files']:
        add(native / item['path'], 'NATIVE/' + item['path'], item['sha256'])
    add(native / 'inventory.json', 'NATIVE/inventory.json')
    render = ROOT / binding['nativeRoot']
    render_manifest = json.loads((render / 'runtime.json').read_text(encoding='utf-8'))
    for name in ('runtime.json','layout.json','materials.json'):
        add(render / name, 'RENDER/' + name)
    for source in render_manifest['sources']:
        add(ROOT / source['name'], 'RENDER/compiled-sources/' + source['name'], source['sha256'])
    independent = binding.get('independentRuntime')
    if independent:
        runtime = ROOT / independent
        manifest = json.loads((runtime / 'runtime.json').read_text(encoding='utf-8'))
        build = Path(manifest['buildReceipt']).parent
        record = json.loads((build / 'report.json').read_text(encoding='utf-8'))
        if not record['buildPassed'] or record['recipeSha256'] != manifest['recipeSha256']:
            raise ValueError('Independent MPV build receipt differs')
        lua = record['luaSource']; archive_file = ROOT / lua['archive']
        add(archive_file, 'NATIVE/' + lua['archive'], lua['archiveSha256'])
        add(archive_file.with_suffix('.json'), 'NATIVE/' + lua['archive'].replace('.tar', '.json'))
        add(ROOT / 'scripts/build-desktop-mpv.py', 'INDEPENDENT/scripts/build-desktop-mpv.py', record['recipeSha256'])
        add(ROOT / 'scripts/stage-desktop-mpv.py', 'INDEPENDENT/scripts/stage-desktop-mpv.py')
        add(runtime / 'runtime.json', 'INDEPENDENT/runtime.json')
        add(runtime / 'LuaJIT-COPYRIGHT.txt', 'INDEPENDENT/LuaJIT-COPYRIGHT.txt')
        for name in ('report.json', 'configure.log', 'compile.log', 'lua-build.log', 'windows-x64.ini', 'import-audit.json'):
            add(build / name, 'INDEPENDENT/build-records/' + name)
    for item in profile['sources']:
        add(ROOT / item['archive'], 'CLI/' + item['archive'], item['archiveSha256'])
    # Package-specific notices are an explicit overlay, not a rewrite of the
    # immutable working-tree source snapshot's historical default CLI notices.
    for file in cli.iterdir():
        if file.suffix in {'.txt', '.json'}:
            add(file, 'CLI-OVERLAY/bin/' + ('FFmpeg-RUNTIME.json' if file.name == 'runtime-index.json' else file.name))
    build = ROOT / 'build/controlled-ffmpeg-b464na_v'
    for name in ['report.json', 'x265-multilib.mri']:
        add(build / name, 'CLI/build-records/' + name)
    add(ROOT / 'build/controlled-cli-source-cache/report.json', 'CLI/build-records/source-recapture.json')
    acceptance = Path(json.loads((ROOT / 'build/controlled-cli-validation-latest.json').read_text(encoding='utf-8'))['folder'])
    add(acceptance / 'report.json', 'CLI/build-records/windows-cli-verification.json')
    info = {'schema': 1, 'scope': 'M5 dual-MPV Windows desktop materials; no sample/HDR admission whitelist; no default-engine promotion or publication',
        'application': str(application.relative_to(ROOT)), 'applicationBuild': app_index.get('buildIdentityReference'),
        'nativeSourceArchives': native_index['gitSourceArchives'] + bool(independent),
        'nativeSupportSourcePackages': native_index['supportSourcePackages'], 'controlledCliSourceArchives': len(profile['sources']),
        'defaultProjectCliChanged': False, 'files': [{k: v for k, v in item.items() if k != 'file'} for item in entries],
        'sourceBundleOmits': ['user media', 'databases', 'Git configuration', 'node_modules', 'compiled runtime binaries'],
        'legalCertificationClaimed': False, 'published': False}
    instructions = '''AVHub M5 source and build materials / M5 源码与构建材料

APPLICATION is a frozen working-tree application snapshot, not a release tag.
NATIVE contains the exact native source archives, support runtime sources,
patch/configuration inputs and historical build receipts. CLI contains the
11 exact controlled-CLI archives; CLI-OVERLAY contains its actual notices/index.
Every file is recorded in DELIVERY-INDEX.json. This is not a compiled app.

Rebuild preparation (Windows x64 + existing Ubuntu 24.04 WSL toolchain):
1. Use APPLICATION as the project root. Restore NATIVE/build source inputs
   and CLI/build archives below it, retaining their project-relative paths.
   Do not overwrite the current APPLICATION scripts with historical receipts.
2. Run scripts/prepare-native-cross-tools.py --download --lock
   ci/controlled-cli-cross-tools.json in Ubuntu WSL. This extracts private tools,
   not system packages. Run scripts/prepare-controlled-cli-tools.py next.
3. Run scripts/prepare-controlled-cli-sources.py to verify fixed inputs, then
   scripts/build-controlled-ffmpeg.py to build the static Windows CLI.
4. The Windows comparison harness uses the ordinary pinned Gyan CLI in bin/
   as an independent reference/fixture encoder, not as the delivered runtime.
   Prepare that test tool with ci-prepare.py and generate the documented
   acceptance samples; run verify-controlled-ffmpeg.py, then
   stage-controlled-cli-runtime.py. Reference tool binaries are not included.
5. Rebuild the application's frontend/Electron and backend using its pinned
   dependency manifests. For the M5 payload use the controlled CLI/notices;
   the ordinary Gyan ci-prepare.py path is a separate historical default.
   After staging the application source, run replay-application-build.mjs and
   replay-backend-build.py. Pass the resulting owned replay folder to
   stage-m5-backend-cli.py --backend-replay <folder> for a dedicated payload;
   it verifies the rebuilt executable receipt and frozen Python inputs.
6. Native rebuild order, source patches and actual compiler arguments are in
   NATIVE/README.txt and its inventories/reports. Rebuilding native libraries
   may require generating a new checksum cohort and rebuilding the app pins;
   do not mix a changed DLL into the delivered fixed cohort or bypass checks.
7. Select electron/native-render.builder.cjs, AVHUB_RENDER_RUNTIME_CANDIDATE,
   and AVHUB_RENDER_BACKEND_DIR for the dedicated acceptance payload. The
   configuration refuses stable-tag publishing. Launch its ZIP using
   Start-render-acceptance.cmd, explicitly opt into MPV + D3D11, and test SDR.

Ordinary project bin/ and ordinary CI/release configuration were not switched.
The package-specific controlled CLI overlay is intentional. Existing Python,
Node and compiler environments are prerequisites; this is not a claim of a
fully offline clean-OS build, bit-exact backend reproduction, or legal review.
HDR, mixed-DPI physical displays and VMware are not certified by this bundle.
No source videos, personal database, credentials or project .git were included.
'''
    if independent:
        info['scope']='M5 desktop dual-MPV materials; HDR/display verification status is not a playback whitelist'
        instructions += '''
CURRENT DUAL-MPV DESKTOP OVERLAY / 双 MPV 桌面构建补充
The historical acceptance launcher instructions above describe the old package.
The current desktop candidate starts AVHub.exe directly and bundles both MPV
presentations. INDEPENDENT contains the exact Lua-enabled MPV build recipe,
matching archive metadata, import audit and build logs. Its MPV/dependency
archives are already in NATIVE; the extra LuaJIT archive brings that count to 22.
After rebuilding the existing native dependency chain, run build-desktop-mpv.py
in Ubuntu WSL, audit-libmpv-imports.py in WSL and Windows, then stage-desktop-mpv.py
in Windows. All stages are private and do not replace bin/mpv automatically.
RENDER contains the active helper manifest, layout and hash-matched C# sources;
NATIVE build receipts remain historical evidence and do not override them.
Normal desktop packaging uses electron/desktop-release.builder.cjs and prepared
hash-bound release inputs; desktop-render.builder.cjs remains the nonpublishing
candidate configuration. Use the source-built controlled CLI for the backend.
Actual HDR/display fidelity and mixed-DPI verification are recorded separately;
the absence of such verification does not reject ordinary or HDR sources.
'''
    names = [item['path'] for item in entries]
    if len(names) != len(set(names)):
        raise ValueError('Source delivery member collision')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        for item in entries:
            target.write(item['file'], item['path'])
        target.writestr('DELIVERY-INDEX.json', json.dumps(info, indent=2) + '\n')
        target.writestr('README-SOURCE.txt', instructions)
    with zipfile.ZipFile(archive) as source:
        if source.testzip() is not None:
            raise ValueError('Source ZIP CRC failure')
        for item in entries:
            with source.open(item['path']) as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
                    raise ValueError('Source delivery hash mismatch: ' + item['path'])
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    report = {**{k: v for k, v in info.items() if k != 'files'}, 'fileCount': len(entries), 'zip': str(archive),
              'bytes': archive.stat().st_size, 'sha256': digest, 'allMembersVerified': True}
    (ROOT / 'build/m5-source-delivery.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    stage()
