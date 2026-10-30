"""Source replay boundary only; actual compilation is separately recorded."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/build-libmpv-windows-harness.py"
SPEC = importlib.util.spec_from_file_location("libmpv_replay", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NativeSourceReplayTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="source-replay-test-", dir=ROOT / "build")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.folder = self.root / "build/native-source-materials-fixture"
        names = {
            "scripts/build-libmpv-windows-harness.py": SCRIPT.read_bytes(),
            "ci/native-rebuild-source-proposal.json": json.dumps({"sources": [{"id": "mpv", "revision": "a" * 40}]}).encode(),
            "build/native-git-inputs/mpv-aaaaaaaaaaaa.tar": b"fixture archive",
            "build/native-git-inputs/mpv-aaaaaaaaaaaa.json": b"{}",
        }
        self.records = []
        for name, data in names.items():
            file = self.folder / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
            self.records.append({"path": name, "sha256": hashlib.sha256(data).hexdigest()})
        self.inventory = {"cohort": "selfbuilt-sdr-2cf60d001765", "distributionReady": False, "files": self.records}
        self.write_inventory()

    def write_inventory(self):
        (self.folder / "inventory.json").write_text(json.dumps(self.inventory))

    def test_exact_frozen_recipe_and_source_accepted_without_enabling_distribution(self):
        folder, evidence = MODULE.replay_inputs(self.folder, self.root)
        self.assertEqual(folder, self.folder)
        self.assertEqual(evidence["sourceArchiveSha256"], hashlib.sha256(b"fixture archive").hexdigest())
        self.assertEqual(evidence["recipeSha256"], hashlib.sha256(SCRIPT.read_bytes()).hexdigest())

    def test_changed_source_rejected(self):
        (self.folder / "build/native-git-inputs/mpv-aaaaaaaaaaaa.tar").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "source changed"):
            MODULE.replay_inputs(self.folder, self.root)

    def test_frozen_different_recipe_rejected_even_with_matching_inventory(self):
        file = self.folder / "scripts/build-libmpv-windows-harness.py"
        file.write_bytes(b"old recipe")
        self.records[0]["sha256"] = hashlib.sha256(file.read_bytes()).hexdigest()
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, "actual replay recipe"):
            MODULE.replay_inputs(self.folder, self.root)

    def test_external_directory_or_unexpected_approval_rejected(self):
        with self.assertRaisesRegex(ValueError, "owned frozen"):
            MODULE.replay_inputs(self.folder.parent, self.root)
        self.inventory["distributionReady"] = True
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, "cohort/approval"):
            MODULE.replay_inputs(self.folder, self.root)

    def dependency_fixture(self):
        values = []
        for name in ["ffmpeg", "libplacebo", "subtitle", "shaderc", "render-deps"]:
            stage = self.root / "build" / (name + "-replay-fixture")
            stage.mkdir()
            archive = self.folder / "build/native-git-inputs" / (name + "-" + "a" * 12 + ".tar")
            archive.write_bytes(name.encode())
            binary = stage / "fixture.dll"
            binary.write_bytes(b"fixture binary")
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            report = {"buildPassed": True, "windowsExecutionPassed": True, "windowsTestsPassed": True,
                      "sourceMaterialsReplay": {"fixture": True},
                      "sources": [{"id": name, "revision": "a" * 40, "archiveSha256": digest}],
                      "sourceRevision": "a" * 40, "sourceArchiveSha256": digest,
                      "binaries": [{"path": binary.name, "sha256": hashlib.sha256(binary.read_bytes()).hexdigest()}]}
            (stage / "report.json").write_text(json.dumps(report))
            values.append(name + "=" + str(stage))
        return values

    def test_full_dependency_selection_is_explicit_ordered_and_verified(self):
        values = self.dependency_fixture()
        result = MODULE.selected_dependencies(list(reversed(values)), self.folder, self.root)
        self.assertEqual(list(result), ["ffmpeg", "libplacebo", "subtitle", "shaderc", "render-deps"])
        with self.assertRaisesRegex(ValueError, "all five"):
            MODULE.selected_dependencies(values[:-1], self.folder, self.root)
        with self.assertRaisesRegex(ValueError, "exactly once"):
            MODULE.selected_dependencies(values + [values[0]], self.folder, self.root)

    def test_unvalidated_changed_or_external_dependency_is_rejected(self):
        values = self.dependency_fixture()
        stage = Path(values[0].split("=", 1)[1])
        (stage / "fixture.dll").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "binary changed"):
            MODULE.selected_dependencies(values, self.folder, self.root)
        with self.assertRaisesRegex(ValueError, "owned replay dependency"):
            MODULE.selected_dependencies(["ffmpeg=" + str(self.root / "outside")], self.folder, self.root)


class ActualReplayEvidenceTests(unittest.TestCase):
    def test_new_complete_closure_uses_rebuilt_dependencies_and_passes_windows_checks(self):
        folder = ROOT / "build/libmpv-chain-replay-1a5jyjem"
        report = json.loads((folder / "report.json").read_text())
        self.assertTrue(report["explicitDependencyReplayChain"])
        self.assertTrue(report["buildPassed"])
        self.assertTrue(report["windowsTestsPassed"])
        self.assertFalse(report["currentRuntimeReplaced"])
        self.assertFalse(report["distributionReady"])
        self.assertEqual(report["dependencyStages"], {
            "ffmpeg": "build/ffmpeg-source-replay-wesx64x9",
            "libplacebo": "build/libplacebo-source-replay-halz2k13",
            "subtitle": "build/subtitle-source-replay-c6vp31en",
            "shaderc": "build/shaderc-source-replay-j5155yvv",
            "render-deps": "build/render-deps-replay-n9lsb7gr"})
        imports = json.loads((folder / "import-audit.json").read_text())
        self.assertTrue(imports["windowsOsImportsResolved"])
        self.assertEqual(len(imports["binaries"]), 29)
        pin = json.loads((ROOT / "ci/replayed-render-runtime.json").read_text())
        files = [{"name": "libmpv-2.dll", "sha256": pin["dllSha256"]}, *pin["dependencies"]]
        for file in files:
            with (folder / "install/bin" / file["name"]).open("rb") as stream:
                self.assertEqual(hashlib.file_digest(stream, "sha256").hexdigest(), file["sha256"])

    def test_actual_build_library_tests_and_import_resolution_match_evidence(self):
        folder = ROOT / "build/libmpv-source-replay-68npnz9m"
        replay = json.loads((folder / "replay-result.json").read_text())
        build = json.loads((folder / "report.json").read_text())
        tests = json.loads((folder / "windows-tests.json").read_text())
        imports = json.loads((folder / "import-audit.json").read_text())
        self.assertTrue(build["buildPassed"])
        self.assertTrue(tests["passed"])
        self.assertEqual(len(tests["officialCoreTests"]), 10)
        self.assertTrue(all(test["exitCode"] == 0 for test in tests["officialCoreTests"]))
        self.assertEqual(len(tests["samples"]), 4)
        self.assertEqual(tests["samples"][0]["hardwareDecode"], "d3d11va-copy")
        self.assertTrue(imports["windowsOsImportsResolved"])
        self.assertEqual(len(imports["osModules"]), 21)
        self.assertEqual(hashlib.sha256((folder / "install/bin/libmpv-2.dll").read_bytes()).hexdigest(), replay["resultDll"]["sha256"])
        for key in ["electronAccepted", "fullDependencyChainRebuilt", "currentRuntimeReplaced", "distributionReady"]:
            self.assertFalse(replay[key])

    def test_replay_does_not_retarget_candidate_and_keeps_all_dependency_identities(self):
        pin = json.loads((ROOT / "ci/self-built-render-runtime.json").read_text())
        selected = json.loads((ROOT / "build/libmpv-windows-cross-latest.json").read_text())
        self.assertEqual(Path(selected["folder"]).name, "libmpv-windows-cross-06dva4ei")
        folder = ROOT / "build/libmpv-source-replay-68npnz9m"
        report = json.loads((folder / "pe-comparison.json").read_text())
        self.assertEqual(report["artifacts"][0]["sha256"], pin["dllSha256"])
        self.assertNotEqual(report["artifacts"][0]["sha256"], report["artifacts"][1]["sha256"])
        self.assertTrue(next(row["equal"] for row in report["sectionsEqual"] if row["name"] == ".text"))
        self.assertFalse(report["knownMetadataComparison"]["filesModified"])
        for dependency in pin["dependencies"]:
            with (folder / "install/bin" / dependency["name"]).open("rb") as stream:
                self.assertEqual(hashlib.file_digest(stream, "sha256").hexdigest(), dependency["sha256"])
