"""Synthetic archive identity contracts, not real build approval."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("native_rebuild_archives", ROOT / "scripts/prepare-native-rebuild-archives.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveIdentityTests(unittest.TestCase):
    def fixture(self):
        folder = Path(tempfile.mkdtemp(prefix="source-archive-contract-", dir=ROOT / "build"))
        file = folder / "fixture.tar.gz"
        file.write_bytes(b"synthetic archive input")
        return file

    def test_strong_recipe_match_never_implies_build_approval(self):
        file = self.fixture()
        source = {"id": "fixture", "declaredHash": "SHA256=" + hashlib.sha256(file.read_bytes()).hexdigest()}
        result = module.verify(file, source)
        self.assertTrue(result["strongRecipeDigest"])
        self.assertFalse(result["buildVerified"])

    def test_legacy_sha1_match_is_not_relabeled_as_strong(self):
        file = self.fixture()
        result = module.verify(file, {"id": "fixture", "declaredHash": "SHA1=" + hashlib.sha1(file.read_bytes()).hexdigest()})
        self.assertTrue(result["recipeDigestMatched"])
        self.assertFalse(result["strongRecipeDigest"])
        self.assertEqual(result["sha256"], hashlib.sha256(file.read_bytes()).hexdigest())

    def test_mismatch_preserves_the_original_input(self):
        file = self.fixture()
        before = file.read_bytes()
        with self.assertRaisesRegex(ValueError, "preserved"):
            module.verify(file, {"id": "fixture", "declaredHash": "SHA256=" + "0" * 64})
        self.assertEqual(file.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
