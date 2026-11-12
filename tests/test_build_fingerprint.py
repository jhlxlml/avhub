import json
import os
import runpy
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class NestedUIBuildFingerprintTests(unittest.TestCase):
    def test_nested_primitives_are_hashed_identically_without_generated_static_files(self):
        with tempfile.TemporaryDirectory(prefix='avhub-build-fingerprint-') as folder:
            root = Path(folder)
            for relative in ('scripts/write-build-info.mjs', 'app/build_info.py'):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / relative, target)
            fixtures = {
                'run.py': '# fixture', 'package.json': '{"version":"0.2.14"}',
                'vite.config.ts': 'export default {}', 'app/sqlite-runtime.json': '{}',
                'package-lock.json':'{"lockfileVersion":3}', 'requirements.txt':'fastapi==0.1',
                'scripts/frontend-notices.mjs':'export function frontendNotices(){}',
                'frontend/src/main.tsx': 'export const main=1',
                'frontend/src/components/ui/button.tsx': 'export const button=1',
                'frontend/src/lib/utils.ts': 'export const cn=1',
                'electron/src/main.ts': 'export const desktop=1',
                'electron/native/render/RenderHost.cs': '// native host',
                'app/static/assets/generated.css': 'body{color:red}',
                'frontend/public/fonts/owned.woff2':'fixture font',
            }
            for relative, value in fixtures.items():
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(value, encoding='utf-8')

            def capture():
                subprocess.run(['node', str(root / 'scripts/write-build-info.mjs')],
                               cwd=root, check=True, capture_output=True, timeout=15)
                emitted = json.loads((root / 'app/build-info.json').read_text())
                loaded = runpy.run_path(str(root / 'app/build_info.py'))['BUILD']
                self.assertEqual(emitted['build_id'], loaded['build_id'])
                return loaded['build_id']

            first = capture()
            frozen_time='2026-10-29T12:35:36.395Z'
            command=['node',str(root/'scripts/write-build-info.mjs')]
            subprocess.run(command,cwd=root,env={**os.environ,'AVHUB_BUILD_TIMESTAMP':frozen_time},check=True,capture_output=True,timeout=15)
            frozen=(root/'app/build-info.json').read_bytes()
            self.assertEqual(json.loads(frozen)['built_at'],frozen_time)
            self.assertEqual(json.loads(frozen)['build_id'],first)
            invalid=subprocess.run(command,cwd=root,env={**os.environ,'AVHUB_BUILD_TIMESTAMP':'not-a-timestamp'},capture_output=True,timeout=15)
            self.assertNotEqual(invalid.returncode,0)
            self.assertEqual((root/'app/build-info.json').read_bytes(),frozen)
            (root / 'frontend/src/components/ui/button.tsx').write_text('export const button=2')
            second = capture()
            self.assertNotEqual(first, second)
            (root / 'app/static/assets/generated.css').write_text('body{color:blue}')
            self.assertEqual(second, capture())
            for relative in ('package-lock.json','requirements.txt','frontend/public/fonts/owned.woff2','scripts/frontend-notices.mjs','electron/native/render/RenderHost.cs','scripts/write-build-info.mjs'):
                previous=capture()
                with (root/relative).open('a',encoding='utf-8') as file:file.write('\n// changed' if relative.endswith(('.mjs','.cs')) else '\nchanged')
                self.assertNotEqual(previous,capture(),relative)
            previous=capture()
            (root/'electron/native/render/generated.exe').write_bytes(b'generated output')
            self.assertEqual(previous,capture())
            previous=capture()
            (root/'frontend/public/new-image.svg').write_text('<svg/>',encoding='utf-8')
            self.assertNotEqual(previous,capture())
            previous=capture();(root/'frontend/public/new-image.svg').unlink()
            self.assertNotEqual(previous,capture())
