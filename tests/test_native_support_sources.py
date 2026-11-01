"""Offline source lock/checksum contracts, without download or playback."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES=ROOT/'tests/fixtures/native-support'
SPEC = importlib.util.spec_from_file_location("support_sources", ROOT / "scripts/prepare-native-support-sources.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SupportSourceTests(unittest.TestCase):
    def setUp(self):
        self.lock = json.loads((ROOT / "ci/native-support-sources.json").read_text())

    def test_exact_support_packages_and_pinned_dsc_payloads_agree(self):
        sources = MODULE.validate_sources(self.lock)
        self.assertEqual(len(sources), 3)
        for source in sources:
            file = FIXTURES / source["dsc"]["name"]
            MODULE.verify(file, source["dsc"])
            MODULE.verify_dsc(file, source)

    def test_unknown_origins_traversal_duplicate_and_unbounded_inputs_rejected(self):
        mutations = [
            lambda s: s[0].update(baseUrl="https://example.com/"),
            lambda s: s[0]["dsc"].update(name="../outside.dsc"),
            lambda s: s[0]["archives"][0].update(name=s[0]["dsc"]["name"]),
            lambda s: s[0]["archives"][0].update(size=1024**3),
        ]
        for mutate in mutations:
            lock = copy.deepcopy(self.lock)
            mutate(lock["sources"])
            with self.assertRaises(ValueError):
                MODULE.validate_sources(lock)

    def test_correct_dsc_cannot_authorize_different_payload(self):
        source = copy.deepcopy(self.lock["sources"][0])
        source["archives"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "differs from pinned DSC"):
            MODULE.verify_dsc(FIXTURES / source["dsc"]["name"], source)

    def test_wrong_package_identity_rejected(self):
        source = copy.deepcopy(self.lock["sources"][0])
        source["version"] = "newer"
        with self.assertRaisesRegex(ValueError, "package/version mismatch"):
            MODULE.verify_dsc(FIXTURES / source["dsc"]["name"], source)

    def test_modified_local_archive_rejected(self):
        with tempfile.TemporaryDirectory(prefix="support-source-test-", dir=ROOT / "build") as folder:
            file = Path(folder) / "source.tar"
            file.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
                MODULE.verify(file, {"name": file.name, "size": 7, "sha256": "0" * 64})
