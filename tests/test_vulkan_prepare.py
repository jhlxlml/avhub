"""Synthetic ZIP contracts; not claims of real Vulkan loading."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("vulkan_prepare", ROOT / "scripts/prepare-vulkan-runtime.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VulkanPreparationTests(unittest.TestCase):
    def fixture(self, machine=0x8664):
        root = Path(tempfile.mkdtemp(prefix="vulkan-contract-", dir=ROOT / "build"))
        (root / "ci").mkdir()
        (root / "third_party/vulkan-loader").mkdir(parents=True)
        license_text = b"synthetic test license"
        (root / "third_party/vulkan-loader/LICENSE.txt").write_bytes(license_text)
        manifest = json.loads((ROOT / "ci/vulkan-runtime.json").read_text())
        folder = root / "build/vulkan-runtime-input"
        folder.mkdir(parents=True)
        archive = folder / manifest["archiveUrl"].rsplit("/", 1)[1]
        pe = bytearray(256)
        pe[:2] = b"MZ"
        struct.pack_into("<I", pe, 0x3C, 64)
        pe[64:68] = b"PE\0\0"
        struct.pack_into("<H", pe, 68, machine)
        struct.pack_into("<H", pe, 88, 0x20B)
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("runtime/x64/vulkan-1.dll", pe)
            z.writestr(manifest["archiveLicenseName"], b"synthetic runtime license")
        manifest["archiveLicenseSha256"] = module.digest(b"synthetic runtime license")
        manifest.update(archiveSize=archive.stat().st_size, archiveSha256=module.digest(archive.read_bytes()), licenseSha256=module.digest(license_text))
        (root / "ci/vulkan-runtime.json").write_text(json.dumps(manifest))
        return root, archive

    def test_verified_archive_extracts_only_owned_fixed_names_and_is_repeatable(self):
        root, _ = self.fixture()
        first = module.prepare(root, offline=True)
        self.assertEqual(first, module.prepare(root, offline=True))
        self.assertEqual(first["files"][0]["name"], "vulkan-1.dll")
        self.assertFalse(first["distributionReady"])

    def test_corrupt_archive_is_preserved_without_runtime_output(self):
        root, archive = self.fixture()
        archive.write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "preserved"):
            module.prepare(root, offline=True)
        self.assertEqual(archive.read_bytes(), b"corrupted")
        self.assertFalse((archive.parent / "runtime").exists())

    def test_x86_member_does_not_satisfy_x64_runtime(self):
        root, _ = self.fixture(machine=0x14C)
        with self.assertRaisesRegex(ValueError, "exactly one AMD64"):
            module.prepare(root, offline=True)

    def test_missing_offline_input_never_downloads_or_publishes(self):
        root, archive = self.fixture()
        archive.unlink()
        with self.assertRaisesRegex(FileNotFoundError, "never downloads"):
            module.prepare(root, offline=True)
        self.assertFalse((archive.parent / "runtime").exists())

    def test_existing_runtime_is_not_overwritten(self):
        root, _ = self.fixture()
        module.prepare(root, offline=True)
        dll = root / "build/vulkan-runtime-input/runtime/vulkan-1.dll"
        dll.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "preserved"):
            module.prepare(root, offline=True)
        self.assertEqual(dll.read_bytes(), b"changed")


if __name__ == "__main__":
    unittest.main()
