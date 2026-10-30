"""Metadata boundary tests; these do not stand in for an actual compiler run."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cross_tools", ROOT / "scripts/prepare-native-cross-tools.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CrossToolMetadataTests(unittest.TestCase):
    def metadata(self, **changes):
        values = {"Package": "fixture", "Version": "1.0", "Architecture": "amd64",
                  "SHA256": "a" * 64, "Size": "12", "Filename": "pool/fixture.deb"}
        values.update(changes)
        return subprocess.CompletedProcess([], 0, "\n".join(k + ": " + v for k, v in values.items()))

    def test_preserves_exact_version_digest_and_provenance(self):
        with patch.object(module.subprocess, "run", return_value=self.metadata()) as call:
            result = module.package_metadata("fixture", "1.0")
        self.assertEqual(call.call_args.args[0], ["apt-cache", "show", "fixture=1.0"])
        self.assertEqual(result["sha256"], "a" * 64)
        self.assertEqual(result["size"], 12)
        self.assertEqual(result["digestProvenance"], "Existing Ubuntu APT index")

    def test_wrong_package_or_revision_cannot_be_accepted(self):
        for change in ({"Package": "other"}, {"Version": "2.0"}):
            with self.subTest(change=change), patch.object(module.subprocess, "run", return_value=self.metadata(**change)), self.assertRaises(ValueError):
                module.package_metadata("fixture", "1.0")

    def test_missing_or_invalid_strong_digest_cannot_be_accepted(self):
        for digest in ("", "a" * 40, "z" * 64):
            with self.subTest(digest=digest), patch.object(module.subprocess, "run", return_value=self.metadata(SHA256=digest)), self.assertRaises(ValueError):
                module.package_metadata("fixture", "1.0")


if __name__ == "__main__":
    unittest.main()
