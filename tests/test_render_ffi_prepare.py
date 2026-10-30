"""Synthetic archive/security checks; do not certify the real native runtime."""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('render_ffi_prepare', Path(__file__).resolve().parents[1] / 'scripts/prepare-render-ffi.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.patcher = patch.object(module, 'ROOT', self.root)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.addCleanup(self.tmp.cleanup)
        self.manifest_path = self.root / 'ci/render-ffi/runtime-manifest.json'
        self.manifest_path.parent.mkdir(parents=True)
        self.name = 'node_modules/koffi/index.cjs'
        self.data = b'module.exports={}'
        self.target = self.root / 'build/libmpv-render-spike/ffi' / self.name
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            info = tarfile.TarInfo('package/index.cjs'); info.size = len(self.data)
            archive.addfile(info, io.BytesIO(self.data))
            info = tarfile.TarInfo('package/unexpected.exe'); info.size = 3
            archive.addfile(info, io.BytesIO(b'bad'))
        self.archive = stream.getvalue()
        self.manifest = {'version': '3.3.4', 'platform': 'win32-x64', 'files': [{'name': self.name, 'size': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest()}], 'archives': [{'prefix': 'node_modules/koffi', 'url': 'https://registry.npmjs.org/koffi/fixed.tgz', 'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(self.archive).digest()).decode()}]}
        self.save()

    def save(self):
        self.manifest_path.write_text(json.dumps(self.manifest))

    def test_pinned_archive_only_extracts_allowlisted_files_and_reuses_offline(self):
        with patch.object(module, 'urlopen', return_value=io.BytesIO(self.archive)):
            module.prepare()
        self.assertEqual(self.target.read_bytes(), self.data)
        self.assertFalse((self.target.parent / 'unexpected.exe').exists())
        module.prepare(offline=True)

    def test_corrupt_archive_rejected_before_output(self):
        with patch.object(module, 'urlopen', return_value=io.BytesIO(b'wrong')):
            with self.assertRaises(AssertionError): module.prepare()
        self.assertFalse(self.target.exists())

    def test_existing_modified_file_is_not_silently_overwritten(self):
        self.target.parent.mkdir(parents=True); self.target.write_bytes(b'user change')
        with self.assertRaisesRegex(AssertionError, 'Changed'): module.prepare(offline=True)
        self.assertEqual(self.target.read_bytes(), b'user change')

    def test_offline_missing_refuses_download(self):
        with patch.object(module, 'urlopen') as request:
            with self.assertRaisesRegex(AssertionError, 'Missing'): module.prepare(offline=True)
            request.assert_not_called()

    def test_unsafe_member_paths_rejected(self):
        for name in ['../escape', 'node_modules/koffi/../../escape', 'C:/escape', 'node_modules\\koffi\\index.cjs']:
            self.manifest['files'][0]['name'] = name; self.save()
            with self.assertRaises(AssertionError): module.prepare()


if __name__ == '__main__': unittest.main()
