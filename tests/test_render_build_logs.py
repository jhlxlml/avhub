"""Synthetic parsing contracts, not evidence of native library contents."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("render_build_logs", Path(__file__).resolve().parents[1] / "scripts/catalog-render-build-logs.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BuildLogTests(unittest.TestCase):
    def test_nested_project_and_compiler_revision_are_not_own_project(self):
        parsed = module.parse_config("Project name: libass\nProject version: 0.17.5\ngtest| Project name: gtest\ngtest| Project version: 1.17.0\nC compiler: clang " + "a" * 40)
        self.assertEqual(parsed["projectName"], "libass")
        self.assertEqual(parsed["projectVersion"], "0.17.5")
        self.assertNotIn("binaryRevision", parsed)

    def test_absent_and_versionless_dependencies_stay_distinct(self):
        parsed = module.parse_config("Run-time dependency x11 found: NO  (tried pkg-config and cmake)\nRun-time dependency iconv found: YES\nRun-time dependency libass found: YES 0.17.5 (cached)")
        self.assertEqual([(d["found"], d["version"]) for d in parsed["dependencies"]], [(False, None), (True, None), (True, "0.17.5")])

    def test_different_observations_are_not_silently_overwritten(self):
        deps = module.parse_config("Run-time dependency test found: YES 1.0\nRun-time dependency test found: YES 2.0")["dependencies"]
        self.assertEqual([d["version"] for d in deps], ["1.0", "2.0"])

    def test_unknown_version_does_not_become_a_release_revision(self):
        parsed = module.parse_config("Project name: mpv\nProject version: 0.41.0-UNKNOWN")
        self.assertEqual(parsed["projectVersion"], "0.41.0-UNKNOWN")
        self.assertEqual(parsed["dependencies"], [])


if __name__ == "__main__":
    unittest.main()
