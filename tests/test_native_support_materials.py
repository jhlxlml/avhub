"""Offline provenance boundary tests; no playback or license certification."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "support_materials", Path(__file__).resolve().parents[1] / "scripts/capture-native-support-materials.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SupportMaterialsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="support-materials-test-",
                                                dir=Path(__file__).resolve().parents[1] / "build")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        package_dir = self.root / "build/native-cross-tools/packages"
        package_dir.mkdir(parents=True)
        (self.root / "ci").mkdir()
        (self.root / "LICENSE").write_text("fixture project license")
        definitions = {
            "gcc-mingw-w64-x86-64-posix-runtime":
                ["libgcc_s_seh-1.dll", "libstdc++-6.dll", "libssp-0.dll"],
            "mingw-w64-x86-64-dev": ["libwinpthread-1.dll"],
            "gcc-mingw-w64-base": ["copyright"],
            "mingw-w64-common": ["copyright"],
        }
        self.payloads, records, dependencies = {}, [], []
        for package, names in definitions.items():
            content = package.encode()
            filename = package + ".deb"
            (package_dir / filename).write_bytes(content)
            records.append({"package": package, "filename": filename,
                            "sha256": hashlib.sha256(content).hexdigest()})
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w") as archive:
                for name in names:
                    data = name.encode()
                    member = tarfile.TarInfo(f"./usr/share/doc/{package}/{name}" if name == "copyright"
                                            else "./usr/lib/" + name)
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))
                    if name.endswith(".dll"):
                        dependencies.append({"name": name, "sha256": hashlib.sha256(data).hexdigest()})
            self.payloads[filename] = buffer.getvalue()
        (self.root / "build/native-cross-tools/inputs.json").write_text(json.dumps({"packages": records}))
        self.pin = self.root / "ci/self-built-render-runtime.json"
        self.pin.write_text(json.dumps({"id": "fixture", "dependencies": dependencies}))

    def run_capture(self):
        def command(args, **kwargs):
            return type("Result", (), {"stdout": self.payloads[Path(args[-1]).name]})()
        with patch.object(MODULE, "ROOT", self.root), patch.object(MODULE.subprocess, "run", side_effect=command):
            MODULE.capture()

    def test_runtime_members_and_notices_are_recorded_without_distribution_approval(self):
        self.run_capture()
        report = json.loads((self.root / "build/native-support-materials/report.json").read_text())
        self.assertEqual(len(report["files"]), 6)
        self.assertFalse(report["distributionReady"])
        self.assertTrue(report["remaining"])
        self.assertEqual((self.root / "build/native-support-materials/notices/avhub/LICENSE").read_bytes(),
                         (self.root / "LICENSE").read_bytes())

    def test_modified_package_is_rejected(self):
        (self.root / "build/native-cross-tools/packages/mingw-w64-common.deb").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Package identity changed"):
            self.run_capture()

    def test_dll_not_matching_pinned_cohort_is_rejected(self):
        pin = json.loads(self.pin.read_text())
        pin["dependencies"][0]["sha256"] = "0" * 64
        self.pin.write_text(json.dumps(pin))
        with self.assertRaisesRegex(ValueError, "Runtime differs"):
            self.run_capture()
