import json
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
                'frontend/src/main.tsx': 'export const main=1',
                'frontend/src/components/ui/button.tsx': 'export const button=1',
                'frontend/src/lib/utils.ts': 'export const cn=1',
                'electron/src/main.ts': 'export const desktop=1',
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
            (root / 'frontend/src/components/ui/button.tsx').write_text('export const button=2')
            second = capture()
            self.assertNotEqual(first, second)
            (root / 'app/static/assets/generated.css').write_text('body{color:blue}')
            self.assertEqual(second, capture())
            for relative in ('package-lock.json','requirements.txt','frontend/public/fonts/owned.woff2'):
                previous=capture()
                with (root/relative).open('a',encoding='utf-8') as file:file.write('\nchanged')
                self.assertNotEqual(previous,capture(),relative)
            previous=capture()
            (root/'frontend/public/new-image.svg').write_text('<svg/>',encoding='utf-8')
            self.assertNotEqual(previous,capture())
            previous=capture();(root/'frontend/public/new-image.svg').unlink()
            self.assertNotEqual(previous,capture())
