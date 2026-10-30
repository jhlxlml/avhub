import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("libmpv_render_prepare", ROOT / "scripts/prepare-libmpv-render.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RenderPrepareTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        (self.root / "ci").mkdir()
        self.manifest = json.loads((ROOT / "ci/libmpv-render-candidate.json").read_text())
        self.archive = self.root / "build/libmpv-render-spike" / self.manifest["url"].rsplit("/", 1)[1]
        self.archive.parent.mkdir(parents=True)
        self.archive.write_bytes(b"isolated archive fixture, not executable")
        self.manifest["archiveSha256"] = module.sha(self.archive)
        self.runtime = self.archive.parent / "runtime"
        for item in self.manifest["files"]:
            content = ("fixture:" + item["name"]).encode()
            item["sha256"] = hashlib.sha256(content).hexdigest()
            item["size"] = len(content)
            target = self.runtime / item["name"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        dll = next(item for item in self.manifest["files"] if item["name"] == "libmpv-2.dll")
        self.manifest.update(dllSha256=dll["sha256"], dllSize=dll["size"])
        self.save()

    def save(self):
        (self.root / "ci/libmpv-render-candidate.json").write_text(json.dumps(self.manifest))

    def test_offline_verification_is_idempotent_and_never_downloads(self):
        with patch.object(module, "urlopen", side_effect=AssertionError("No network")):
            self.assertEqual(module.prepare(self.root, offline=True, verify_only=True)["verifiedFiles"], 6)
            self.assertEqual(module.prepare(self.root, offline=True)["verifiedFiles"], 6)
        self.assertFalse((self.root / "bin").exists())

    def test_missing_offline_archive_does_not_download(self):
        self.archive.unlink()
        with patch.object(module, "urlopen", side_effect=AssertionError("No network")):
            with self.assertRaises(FileNotFoundError):
                module.prepare(self.root, offline=True)

    def test_archive_damage_is_preserved_and_rejected(self):
        self.archive.write_bytes(b"damaged")
        with self.assertRaisesRegex(ValueError, "Archive digest"):
            module.prepare(self.root)
        self.assertEqual(self.archive.read_bytes(), b"damaged")

    def test_modified_dll_is_never_overwritten(self):
        dll = self.runtime / "libmpv-2.dll"
        dll.write_bytes(b"user modified")
        with self.assertRaisesRegex(ValueError, "refusing overwrite"):
            module.prepare(self.root)
        self.assertEqual(dll.read_bytes(), b"user modified")

    def test_bad_source_and_changed_commit_are_rejected(self):
        self.manifest["url"] = "https://example.com/libmpv.7z"
        self.save()
        with self.assertRaisesRegex(ValueError, "binary source"):
            module.prepare(self.root)
        self.manifest = json.loads((ROOT / "ci/libmpv-render-candidate.json").read_text())
        self.manifest["sourceCommit"] = "0" * 40
        self.save()
        with self.assertRaisesRegex(ValueError, "commit mismatch"):
            module.prepare(self.root)

    def test_member_traversal_and_duplicates_rejected(self):
        self.manifest["files"][0]["name"] = "../escape.dll"
        self.save()
        with self.assertRaisesRegex(ValueError, "Unsafe/duplicate"):
            module.prepare(self.root)
        self.manifest["files"][0]["name"] = self.manifest["files"][1]["name"]
        self.save()
        with self.assertRaisesRegex(ValueError, "Unsafe/duplicate"):
            module.prepare(self.root)

    def test_verify_only_requires_every_header(self):
        (self.runtime / "include/mpv/render.h").unlink()
        with self.assertRaises(FileNotFoundError):
            module.prepare(self.root, verify_only=True)

    def test_inconsistent_dll_alias_rejected(self):
        self.manifest["dllSha256"] = "0" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "DLL identity mismatch"):
            module.prepare(self.root)

    def test_extra_dll_blocks_runtime_search_path(self):
        extra = self.runtime / "unknown.dll"
        extra.write_bytes(b"untrusted")
        with self.assertRaisesRegex(ValueError, "Unknown runtime member"):
            module.prepare(self.root)
        self.assertEqual(extra.read_bytes(), b"untrusted")

    def test_no_space_blocks_extraction_without_modification(self):
        (self.runtime / "include/mpv/render.h").unlink()
        with patch.object(module.shutil, "disk_usage", return_value=type("Space", (), {"free": 0})()):
            with self.assertRaisesRegex(OSError, "Insufficient space"):
                module.prepare(self.root, offline=True)
        self.assertFalse((self.runtime / "include/mpv/render.h").exists())

    def test_d3d11_candidate_is_separate_and_requires_matching_source_header(self):
        # Synthetic inputs, not native API capability certification.
        self.manifest['supplementalHeader'] = {'path': 'third_party/libmpv-render-d3d11/render_d3d11.h', 'url': 'https://raw.githubusercontent.com/mpv-player/mpv/' + self.manifest['sourceCommit'] + '/include/mpv/render_d3d11.h', 'size': 3, 'sha256': hashlib.sha256(b'api').hexdigest()}
        (self.root / 'ci/libmpv-d3d11-candidate.json').write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, 'header identity'):
            module.metadata(self.root, 'd3d11')
        header = self.root / self.manifest['supplementalHeader']['path']
        header.parent.mkdir(parents=True); header.write_bytes(b'api')
        self.assertEqual(module.metadata(self.root, 'd3d11')['sourceCommit'], self.manifest['sourceCommit'])
        with self.assertRaises(FileNotFoundError):
            module.prepare(self.root, offline=True, candidate='d3d11')
        self.assertTrue(self.archive.exists())
        with self.assertRaisesRegex(ValueError, 'Unknown fixed'):
            module.metadata(self.root, '../escape')


if __name__ == "__main__":
    unittest.main()
