"""Synthetic recipe transformation contracts, not a Windows runtime build."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("opus_overlay", ROOT / "scripts/prepare-model-free-opus-overlay.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ModelFreeOverlayTests(unittest.TestCase):
    def test_dependency_copy_cleanup_and_global_download_entry_removed_together(self):
        profile = json.loads((ROOT / "ci/native-rebuild-profile.json").read_text())
        opus = 'get_property(src_opus_dnn TARGET opus-dnn PROPERTY _EP_SOURCE_DIR)\nExternalProject_Add(opus\n    DEPENDS\n        opus-dnn\n    GIT_REMOTE_NAME origin\n    GIT_TAG main\n    COMMAND bash -c "cp ${src_opus_dnn}/*.c destination"\n        -Dhardening=false\n    COMMAND bash -c "rm -rf ${src_opus_dnn}/models"\n)\n'
        result = module.model_free_files(opus, "list(APPEND ep\n    opus-dnn\n    opus\n)\n", profile)
        for text in result.values():
            self.assertNotIn("opus-dnn", text)
            self.assertNotIn("src_opus_dnn", text)
        self.assertIn("    opus\n", result["packages/CMakeLists.txt"])
        self.assertIn(profile["opus"]["revision"], result["packages/opus.cmake"])
        for name in ["deep-plc", "dred", "osce"]:
            self.assertIn("-D" + name + "=disabled", result["packages/opus.cmake"])

    def test_enabled_model_feature_prevents_model_free_override(self):
        profile = json.loads((ROOT / "ci/native-rebuild-profile.json").read_text())
        changed = copy.deepcopy(profile)
        changed["opus"]["modelFeatures"]["deep-plc"] = "enabled"
        with self.assertRaisesRegex(ValueError, "all model features disabled"):
            module.model_free_files("", "", changed)


if __name__ == "__main__":
    unittest.main()
