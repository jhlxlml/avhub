"""Synthetic Git ref parser contracts, not source or decoder validation."""
import importlib.util
import copy
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("native_rebuild_refs", Path(__file__).resolve().parents[1] / "scripts/resolve-native-rebuild-lock.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RebuildRefTests(unittest.TestCase):
    def test_model_free_profile_retains_the_codec_but_excludes_model_input(self):
        root = Path(__file__).resolve().parents[1]
        materials = json.loads((root / "third_party/libmpv-render-d3d11/materials.json").read_text())
        profile = json.loads((root / "ci/native-rebuild-profile.json").read_text())
        components, fixed, excluded = module.rebuild_inputs(materials, profile)
        self.assertIn("opus", [c["id"] for c in components])
        self.assertNotIn("opus-dnn", [c["id"] for c in components])
        self.assertEqual(fixed["opus"], profile["opus"]["revision"])
        self.assertEqual([e["id"] for e in excluded], ["opus-dnn"])
        for feature in ["deep-plc", "dred", "osce"]:
            changed = copy.deepcopy(profile)
            changed["opus"]["modelFeatures"][feature] = "enabled"
            enabled, _, skipped = module.rebuild_inputs(materials, changed)
            self.assertIn("opus-dnn", [c["id"] for c in enabled])
            self.assertEqual(skipped, [])

    def test_unknown_model_option_cannot_silently_remove_input(self):
        root = Path(__file__).resolve().parents[1]
        materials = json.loads((root / "third_party/libmpv-render-d3d11/materials.json").read_text())
        profile = json.loads((root / "ci/native-rebuild-profile.json").read_text())
        profile["opus"]["modelFeatures"]["deep-plc"] = "auto"
        with self.assertRaisesRegex(ValueError, "explicit Opus"):
            module.rebuild_inputs(materials, profile)

    def test_remote_head_symbolic_line_is_not_a_commit(self):
        self.assertEqual(module.advertised_revision("ref: refs/heads/main\tHEAD\n" + "a" * 40 + "\tHEAD", "HEAD"), "a" * 40)

    def test_annotated_tag_uses_peeled_commit(self):
        text = "a" * 40 + "\trefs/tags/v1\n" + "b" * 40 + "\trefs/tags/v1^{}"
        self.assertEqual(module.advertised_revision(text, "v1"), "b" * 40)

    def test_branch_tag_collision_is_not_silently_chosen(self):
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            module.advertised_revision("a" * 40 + "\trefs/heads/main\n" + "b" * 40 + "\trefs/tags/main", "main")

    def test_missing_ref_does_not_invent_a_default(self):
        self.assertIsNone(module.advertised_revision("a" * 40 + "\trefs/heads/other", "main"))


if __name__ == "__main__":
    unittest.main()
