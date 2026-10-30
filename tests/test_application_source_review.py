"""Verify the real source-only review snapshot; no release approval implied."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]


class ApplicationSourceReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=Path(json.loads((ROOT/'build/application-source-review-latest.json').read_text())['folder'])
        cls.inventory=json.loads((cls.folder/'source-review-inventory.json').read_text())

    def test_current_source_and_build_inputs_are_preserved(self):
        names={item['path'] for item in self.inventory['files']}
        self.assertTrue({'package-lock.json','run.py','electron/src/renderPlayer.ts','frontend/src/main.tsx',
                         'app/native_playback.py','scripts/build-native-render.mjs','scripts/frontend-notices.d.mts','scripts/prepare-backend-notices.py',
                         'LICENSE','bin/FFmpeg-LICENSE.txt','bin/SQLite-LICENSE.txt'}.issubset(names))
        for item in self.inventory['files']:
            file=self.folder/item['path']
            self.assertEqual(file.stat().st_size,item['size'])
            with file.open('rb') as stream:self.assertEqual(hashlib.file_digest(stream,'sha256').hexdigest(),item['sha256'])

    def test_media_data_archive_and_development_runtime_are_excluded(self):
        for item in self.inventory['files']:
            file=Path(item['path'])
            self.assertNotIn(file.suffix.lower(),{'.mp4','.mkv','.tsv','.exe','.dll','.db','.sqlite','.log'})
            self.assertNotIn(file.parts[0],{'build','archive','dist','data','AVHub-data','node_modules'})
            self.assertNotIn('.git',file.parts)
        self.assertFalse(self.inventory['distributionReady'])
        self.assertFalse(self.inventory['releaseCommitSnapshot'])
