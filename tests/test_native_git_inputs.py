"""Source acquisition boundary tests, not compiler or distribution acceptance."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("git_inputs", ROOT / "scripts/prepare-native-git-inputs.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PinnedGitInputTests(unittest.TestCase):
    def fixture(self, **changes):
        source = {"id": "fixture", "repository": "https://github.com/example/library.git", "revision": "a" * 40}
        source.update(changes)
        return {"sources": [source]}

    def test_selects_only_explicit_pinned_source(self):
        result = module.selected_inputs(self.fixture(), ["fixture"])
        self.assertEqual(result[0]["revision"], "a" * 40)

    def test_rejects_unknown_duplicate_and_empty_selection(self):
        for names in (["missing"], ["fixture", "fixture"], []):
            with self.subTest(names=names), self.assertRaises(ValueError):
                module.selected_inputs(self.fixture(), names)

    def test_mutable_refs_and_non_https_sources_are_rejected(self):
        for changes in ({"revision": "main"}, {"revision": "a" * 12},
                        {"repository": "file:///tmp/source"}, {"repository": "ssh://git@example.com/repo"},
                        {"repository": "https://user:secret@example.com/repo"},
                        {"repository": "https://example.com/repo?token=secret"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                module.selected_inputs(self.fixture(**changes), ["fixture"])


if __name__ == "__main__":
    unittest.main()
