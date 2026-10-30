"""Isolated synthetic Git inputs; not a native build or distribution sign-off."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("native_source_capture", ROOT / "scripts/capture-native-source.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceCaptureTests(unittest.TestCase):
    def fixture(self):
        root = Path(tempfile.mkdtemp(prefix="source-capture-contract-", dir=ROOT / "build"))
        source = root / "build/input"
        source.mkdir(parents=True)
        hooks = root / "empty-hooks"
        hooks.mkdir()
        commands = [["init", "-q"], ["config", "core.hooksPath", str(hooks)], ["config", "commit.gpgsign", "false"], ["config", "user.name", "AVHub fixture"], ["config", "user.email", "fixture@example.invalid"]]
        for args in commands:
            subprocess.run(["git", "-C", str(source), *args], check=True, capture_output=True)
        (source / "code.c").write_text("synthetic original\n")
        (source / ".gitignore").write_text("model.dat\n")
        subprocess.run(["git", "-C", str(source), "add", "."], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(source), "commit", "-qm", "synthetic fixture"], check=True, capture_output=True)
        return root, source

    def test_injected_ignored_and_modified_inputs_are_captured(self):
        root, source = self.fixture()
        (source / "code.c").write_bytes(b"synthetic modified\n")
        (source / "generated.h").write_text("synthetic injected header\n")
        (source / "model.dat").write_bytes(b"synthetic ignored input")
        result = module.capture(source, "fixture", root)
        record = result["record"]
        self.assertFalse(record["distributionReady"])
        self.assertFalse(record["buildVerified"])
        self.assertEqual(len(record["baseRevision"]), 40)
        self.assertIn("code.c", record["gitStatus"])
        with zipfile.ZipFile(Path(result["folder"]) / "source.zip") as archive:
            self.assertEqual(archive.read("code.c"), b"synthetic modified\n")
            self.assertIn("model.dat", archive.namelist())
            self.assertIn("generated.h", archive.namelist())
            self.assertFalse(any(name.startswith(".git/") for name in archive.namelist()))

    def test_unchanged_tree_has_identical_archive_bytes(self):
        root, source = self.fixture()
        first = module.capture(source, "fixture", root)
        second = module.capture(source, "fixture", root)
        self.assertNotEqual(first["folder"], second["folder"])
        self.assertEqual(first["record"]["archiveSha256"], second["record"]["archiveSha256"])

    def test_size_limit_rejects_before_publishing(self):
        root, source = self.fixture()
        with self.assertRaisesRegex(ValueError, "size limit"):
            module.capture(source, "fixture", root, limit=1)
        self.assertEqual(list((root / "build").glob("native-source-*")), [])

    def test_source_cannot_inherit_the_application_repository(self):
        root, _ = self.fixture()
        folder = root / "build/not-a-repository"
        folder.mkdir()
        with self.assertRaisesRegex(ValueError, "own its Git repository"):
            module.capture(folder, "fixture", root)

    def test_directory_link_inputs_are_flattened_and_cycles_rejected(self):
        root, source = self.fixture()
        shared = root / "build/shared"
        shared.mkdir()
        (shared / "injected.h").write_text("synthetic shared input")
        try:
            (source / "shared").symlink_to(shared, target_is_directory=True)
        except OSError as error:
            self.skipTest("Host does not permit creating a synthetic directory link: " + str(error))
        result = module.capture(source, "fixture", root)
        self.assertTrue(result["record"]["sourceLinks"])
        with zipfile.ZipFile(Path(result["folder"]) / "source.zip") as archive:
            self.assertIn("shared/injected.h", archive.namelist())
        (source / "cycle").symlink_to(source, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "cycles"):
            module.capture(source, "fixture", root)


if __name__ == "__main__":
    unittest.main()
