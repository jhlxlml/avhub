"""Audit the actual local review dossier, not runtime/redistribution approval."""
import hashlib
import json
from pathlib import Path
import tarfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NativeSourceMaterialsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pointer = json.loads((ROOT / "build/native-source-materials-latest.json").read_text())
        cls.folder = Path(pointer["folder"])
        cls.inventory = json.loads((cls.folder / "inventory.json").read_text())

    def test_every_collected_input_is_present_and_matches_record(self):
        seen = set()
        for item in self.inventory["files"]:
            self.assertNotIn(item["path"], seen)
            seen.add(item["path"])
            file = self.folder / item["path"]
            self.assertTrue(file.resolve().is_relative_to(self.folder.resolve()))
            self.assertFalse(file.is_symlink())
            self.assertEqual(file.stat().st_size, item["size"])
            with file.open("rb") as stream:
                self.assertEqual(hashlib.file_digest(stream, "sha256").hexdigest(), item["sha256"])
        self.assertEqual(sum(f["size"] for f in self.inventory["files"]), self.inventory["totalBytes"])

    def test_scope_does_not_certify_rebuild_signature_or_distribution(self):
        self.assertFalse(self.inventory["distributionReady"])
        self.assertFalse(self.inventory["runtimeRebuiltFromDossier"])
        self.assertFalse(self.inventory["dscSignaturesVerified"])
        self.assertEqual(self.inventory["gitSourceArchives"], 21)
        self.assertEqual(self.inventory["supportSourcePackages"], 3)
        self.assertTrue(self.inventory["remaining"])
        for item in self.inventory["files"]:
            file = Path(item["path"])
            self.assertNotIn(file.suffix.lower(), {".dll", ".exe", ".mp4", ".mkv", ".sqlite", ".db"})
            self.assertNotIn(".git", file.parts)

    def test_build_evidence_records_conditional_submodule_scope(self):
        libplacebo = self.folder / "build/libplacebo-windows-cross-1bb_qu_s/report.json"
        report = json.loads(libplacebo.read_text())
        self.assertTrue({"-Ddemos=false", "-Dopengl=disabled", "-Dvulkan=disabled"}.issubset(report["configureArguments"]))
        ids = {item["id"] for item in report["sources"]}
        self.assertTrue({"fast_float", "libplacebo-vulkan-headers"}.issubset(ids))
        # Do not relabel upstream's unpopulated optional submodules as verified.
        self.assertFalse(next(item for item in report["sources"] if item["id"] == "libplacebo")["submodulesVerified"])

    def test_gcc_source_version_chain_and_used_wrapper_hashes_match(self):
        compiler = json.loads((self.folder / "build/libmpv-windows-cross-06dva4ei/compiler-inputs-and-wrappers.json").read_text())
        sources = json.loads((self.folder / "ci/native-support-sources.json").read_text())["sources"]
        versions = {source["id"]: source["version"] for source in sources}
        expected = versions["gcc-13"] + "+" + versions["gcc-mingw-w64"]
        runtimes = [p for p in compiler["packages"] if p["package"] == "gcc-mingw-w64-x86-64-posix-runtime"]
        self.assertEqual(len(runtimes), 1)
        self.assertEqual(runtimes[0]["version"], expected)
        archive = self.folder / "build/native-support-source-inputs/gcc-mingw-w64_26.1.tar.xz"
        with tarfile.open(archive) as source:
            rules = source.extractfile(next(member for member in source if member.name.endswith("debian/rules"))).read().decode()
        self.assertIn("deb_version := $(source_version)+$(DEB_VERSION)", rules)
        self.assertIn("gcc-$(target_version)-source", rules)
        for wrapper in compiler["wrappers"]:
            file = self.folder / "build/native-cross-tools" / wrapper["path"]
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(), wrapper["sha256"])
