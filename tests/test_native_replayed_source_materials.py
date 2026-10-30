"""Actual new-cohort dossier identity, not an approval of redistribution."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


class ReplayedMaterialsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=Path(json.loads((ROOT/'build/native-replayed-source-materials-latest.json').read_text())['folder'])
        cls.inventory=json.loads((cls.folder/'inventory.json').read_text())

    def test_exact_cohort_and_corresponding_build_records(self):
        pin=json.loads((ROOT/'ci/replayed-render-runtime.json').read_text())
        self.assertEqual(self.inventory['cohort'],pin['id'])
        self.assertIn(pin['id'],(self.folder/'README.txt').read_text())
        names={item['path'] for item in self.inventory['files']}
        materials=json.loads((ROOT/'build/render-replayed-candidate-Aa7Otl/materials.json').read_text())
        self.assertTrue(set(materials['buildRecords']).issubset(names))
        for archive in materials['sourceArchives']:
            self.assertIn(archive['archive'],names)
        self.assertEqual(self.inventory['gitSourceArchives'],21)
        self.assertEqual(self.inventory['supportSourcePackages'],3)

    def test_every_copied_byte_matches_inventory_without_media_or_binaries(self):
        for item in self.inventory['files']:
            file=self.folder/item['path']
            self.assertTrue(file.resolve().is_relative_to(self.folder.resolve()))
            self.assertFalse(file.is_symlink())
            self.assertNotIn(file.suffix.lower(),{'.dll','.exe','.mp4','.mkv','.db','.sqlite'})
            self.assertEqual(file.stat().st_size,item['size'])
            with file.open('rb') as stream:self.assertEqual(hashlib.file_digest(stream,'sha256').hexdigest(),item['sha256'])
        self.assertFalse(self.inventory['distributionReady'])
        self.assertFalse(self.inventory['dscSignaturesVerified'])
        self.assertTrue(self.inventory['remaining'])
