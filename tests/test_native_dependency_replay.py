"""Frozen dependency replay boundary; real build/test evidence is separate."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts/native_source_replay.py"
SPEC = importlib.util.spec_from_file_location("dependency_replay", HELPER)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DependencyReplayTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="dependency-replay-test-", dir=ROOT / "build")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.folder = self.root / "build/native-source-materials-fixture"
        self.helper = self.root / "scripts/native_source_replay.py"
        self.recipe = self.root / "scripts/build-fixture.py"
        self.helper.parent.mkdir()
        self.helper.write_bytes(HELPER.read_bytes())
        self.recipe.write_bytes(b"fixture recipe")
        self.records = []
        for name, data in {"scripts/native_source_replay.py": HELPER.read_bytes(),
                           "scripts/build-fixture.py": self.recipe.read_bytes(),
                           "build/native-git-inputs/input.tar": b"fixture source"}.items():
            file = self.folder / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
            self.records.append({"path": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        self.inventory = {"cohort": "selfbuilt-sdr-2cf60d001765", "distributionReady": False, "files": self.records}
        self.write_inventory()

    def write_inventory(self):
        (self.folder / "inventory.json").write_text(json.dumps(self.inventory))

    def replay(self):
        with patch.object(MODULE, "__file__", str(self.helper)):
            return MODULE.replay_context(self.folder, self.recipe, self.root)

    def test_frozen_inputs_recipe_and_helper_must_agree(self):
        folder, evidence = self.replay()
        self.assertEqual(folder, self.folder)
        self.assertEqual(evidence["recipeSha256"], hashlib.sha256(self.recipe.read_bytes()).hexdigest())
        self.assertEqual(MODULE.replay_context(None, self.recipe, self.root), (self.root, None))

    def test_modified_source_and_stale_actual_recipe_rejected(self):
        self.recipe.write_bytes(b"different actual recipe")
        with self.assertRaisesRegex(ValueError, "actual replay recipe/helper"):
            self.replay()
        self.recipe.write_bytes(b"fixture recipe")
        (self.folder / "build/native-git-inputs/input.tar").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Invalid frozen source member"):
            self.replay()

    def test_unknown_cohort_or_approval_rejected(self):
        self.inventory["distributionReady"] = True
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, "cohort/approval"):
            self.replay()

    def test_outside_manifest_path_rejected(self):
        file = self.folder.parent / "outside"
        file.write_bytes(b"outside")
        self.records.append({"path": "../outside", "size": 7, "sha256": hashlib.sha256(b"outside").hexdigest()})
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, "Invalid frozen source member"):
            self.replay()

    def test_owned_stage_selector_preserves_default_and_rejects_external_paths(self):
        marker = self.root / "build/stage-latest.json"
        marker.write_text(json.dumps({"folder": "/earlier/root/build/render-deps-cross-fixture"}))
        pattern = r"render-deps-(?:cross|replay)-[a-z0-9_]+"
        self.assertEqual(MODULE.owned_build(None, marker.name, pattern, self.root), self.root / "build/render-deps-cross-fixture")
        with self.assertRaisesRegex(ValueError, "project-owned"):
            MODULE.owned_build(self.root / "outside/render-deps-replay-fixture", marker.name, pattern, self.root)
        with self.assertRaisesRegex(ValueError, "build name"):
            MODULE.owned_build(self.root / "build/other", marker.name, pattern, self.root)

    @unittest.skipUnless(os.name == "nt", "Windows verifier negative control")
    def test_failed_child_test_makes_verifier_exit_nonzero_and_retains_report(self):
        # Synthetic harness failure only: real DLL, deliberate exit-7 child.
        # This is never counted as an upstream GPU/renderer acceptance run.
        with tempfile.TemporaryDirectory(prefix="libplacebo-source-replay-", dir=ROOT / "build") as name:
            folder = Path(name)
            self.assertTrue(folder.resolve().is_relative_to((ROOT / "build").resolve()))
            original = ROOT / "build/libplacebo-windows-cross-1bb_qu_s"
            build = json.loads((original / "report.json").read_text())
            binaries = []
            for item in build["binaries"]:
                target = folder / item["path"]
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(original / item["path"], target)
                binaries.append(item)
            (folder / "report.json").write_text(json.dumps({"kind": "synthetic-verifier-negative-control",
                "buildPassed": True, "syntheticFixture": True, "binaries": binaries, "distributionReady": False}))
            source = folder / "exit-seven.cs"
            source.write_text("class Fixture { static int Main() { return 7; } }")
            binary = folder / "build/src/tests/test.d3d11.synthetic.exe"
            binary.parent.mkdir(parents=True)
            compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
            subprocess.run([str(compiler), "/nologo", "/platform:x64", "/out:" + str(binary), str(source)],
                           check=True, capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
            result = subprocess.run([sys.executable, str(ROOT / "scripts/verify-libplacebo-windows-harness.py"),
                                     "--build-dir", str(folder)], capture_output=True, text=True,
                                    timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            report = json.loads((folder / "windows-tests.json").read_text())
            self.assertFalse(report["passed"])
            self.assertEqual(report["tests"][0]["exitCode"], 7)


class ActualRenderingReplayTests(unittest.TestCase):
    def test_fresh_render_chain_shares_frozen_inputs_and_preserves_default_markers(self):
        stages = [ROOT / "build" / name for name in ["render-deps-replay-n9lsb7gr",
                  "shaderc-source-replay-j5155yvv", "libplacebo-source-replay-halz2k13"]]
        reports = [json.loads((folder / "report.json").read_text()) for folder in stages]
        self.assertEqual(len({report["sourceMaterialsReplay"]["inventorySha256"] for report in reports}), 1)
        for folder, report in zip(stages, reports):
            self.assertTrue(report["buildPassed"])
            self.assertFalse(report["currentRuntimeReplaced"])
            self.assertFalse(report["distributionReady"])
            for binary in report["binaries"]:
                with (folder / binary["path"]).open("rb") as stream:
                    self.assertEqual(hashlib.file_digest(stream, "sha256").hexdigest(), binary["sha256"])
        self.assertEqual(set(reports[-1]["dependencyFolders"]), {"build/" + stage.name for stage in stages[:2]})
        for marker, name in [("render-deps-cross-latest.json", "render-deps-cross-m3twx_94"),
                             ("shaderc-windows-cross-latest.json", "shaderc-windows-cross-k10wlpyf"),
                             ("libplacebo-windows-cross-latest.json", "libplacebo-windows-cross-1bb_qu_s")]:
            self.assertEqual(Path(json.loads((ROOT / "build" / marker).read_text())["folder"]).name, name)

    def test_real_windows_apis_shader_translation_and_official_d3d11_tests_passed(self):
        deps = json.loads((ROOT / "build/render-deps-replay-n9lsb7gr/windows-tests.json").read_text())
        for key in ["passed", "lcmsFloatTransformPassed", "xxhashKnownVectorPassed", "spirvToHlslPassed"]:
            self.assertTrue(deps[key])
        shader = json.loads((ROOT / "build/shaderc-source-replay-j5155yvv/windows-tests.json").read_text())
        self.assertTrue(shader["passed"])
        self.assertEqual(shader["spirvBytes"], 752)
        old_shader = json.loads((ROOT / "build/shaderc-windows-cross-k10wlpyf/windows-tests.json").read_text())
        self.assertEqual(shader["spirvSha256"], old_shader["spirvSha256"])
        placebo = json.loads((ROOT / "build/libplacebo-source-replay-halz2k13/windows-tests.json").read_text())
        self.assertTrue(placebo["passed"])
        self.assertTrue(placebo["d3d11Passed"])
        self.assertEqual(len(placebo["tests"]), 15)
        self.assertTrue(all(test["exitCode"] == 0 for test in placebo["tests"]))
        self.assertFalse(placebo["distributionReady"])
