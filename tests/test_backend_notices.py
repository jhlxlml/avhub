"""Synthetic build-metadata boundary tests; no packaged-app claim."""
import importlib.util
import json
import os
from pathlib import Path,PurePosixPath
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('backend_notices',ROOT/'scripts/prepare-backend-notices.py')
notices=importlib.util.module_from_spec(spec);spec.loader.exec_module(notices)


class BackendNoticeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.site=self.root/'site-packages';self.site.mkdir();self.code=self.site/'demo.py';self.code.write_text('value=1')
        self.license=self.site/'demo-1.0.dist-info/licenses/LICENSE';self.license.parent.mkdir(parents=True);self.license.write_text('Synthetic notice bytes')
        self.metadata=self.license.parent.parent/'METADATA';self.metadata.write_text('Name: demo\nVersion: 1.0')
        (self.root/'LICENSE.txt').write_text('Synthetic CPython notice')
        (self.root/'build/backend-dist/AVHubServer/_internal/licenses').mkdir(parents=True)
        self.analysis=self.root/'build/pyinstaller/AVHubServer/Analysis-00.toc';self.analysis.parent.mkdir(parents=True)
        data=[[] for _ in range(20)];data[0]=[str(self.root/'run.py')];data[14]=[('demo',str(self.code),'PYMODULE')];self.analysis.write_text(repr(tuple(data)))
        fake=lambda name:SimpleNamespace(version='1.0',files=[PurePosixPath('demo-1.0.dist-info/licenses/LICENSE'),PurePosixPath('demo-1.0.dist-info/METADATA')],metadata={'License-Expression':'MIT'},locate_file=lambda item:self.site/str(item))
        for context in [patch.object(notices.sysconfig,'get_paths',return_value={'purelib':str(self.site)}),
                        patch.object(notices.metadata,'packages_distributions',return_value={'demo':['demo']}),
                        patch.object(notices.metadata,'distribution',side_effect=fake),patch.object(notices.sys,'base_prefix',str(self.root))]:
            context.start();self.addCleanup(context.stop)

    def test_install_preserves_actual_notice_bytes_and_names_versions(self):
        folder=notices.prepare(self.root,install=True)
        report=json.loads((folder/'inventory.json').read_text())
        self.assertEqual({p['name'] for p in report['packages']},{'demo','PyInstaller'})
        self.assertEqual((folder/'demo-1.0/licenses/LICENSE').read_bytes(),self.license.read_bytes())
        target=self.root/'build/backend-dist/AVHubServer/_internal/licenses/python-distributions'
        self.assertEqual((target/'demo-1.0/licenses/LICENSE').read_bytes(),self.license.read_bytes())
        self.assertFalse(report['distributionReady'])
        with self.assertRaisesRegex(ValueError,'already installed'):notices.prepare(self.root,install=True)

    def test_missing_notices_and_unmapped_imports_fail(self):
        self.license.unlink()
        with self.assertRaises(ValueError):notices.prepare(self.root)
        with patch.object(notices.metadata,'packages_distributions',return_value={}):
            with self.assertRaisesRegex(ValueError,'Unmapped'):notices.prepare(self.root)

    def test_modified_package_after_analysis_requires_rebuild(self):
        newer=self.analysis.stat().st_mtime_ns+1_000_000_000;os.utime(self.code,ns=(newer,newer))
        with self.assertRaisesRegex(ValueError,'rebuild backend'):notices.prepare(self.root)

    def test_unexpected_analysis_layout_is_rejected(self):
        self.analysis.write_text(repr(([],)))
        with self.assertRaisesRegex(ValueError,'layout'):notices.prepare(self.root)
