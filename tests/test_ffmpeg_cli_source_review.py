"""Actual source archive audit, explicitly separate from a complete CLI rebuild."""
import hashlib
import json
from pathlib import Path
import tarfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
POINTER=ROOT/'build/ffmpeg-cli-source-review-latest.json'


@unittest.skipUnless(POINTER.exists(),'Requires explicit local FFmpeg CLI source capture')
class FFmpegCliSourceReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=Path(json.loads(POINTER.read_text())['folder']);cls.report=json.loads((cls.folder/'report.json').read_text())

    def test_archive_matches_independent_cli_revision_and_release(self):
        pin=json.loads((ROOT/'ci/ffmpeg-cli-source.json').read_text())
        self.assertEqual(self.report['revision'],pin['revision'])
        native=json.loads((ROOT/'build/render-replayed-candidate-Aa7Otl/materials.json').read_text())
        native_revision=next(p['revision'] for p in native['sourceArchives'] if p['id']=='ffmpeg')
        self.assertNotEqual(self.report['revision'],native_revision)
        archive=self.folder/self.report['archive']
        with archive.open('rb') as stream:self.assertEqual(hashlib.file_digest(stream,'sha256').hexdigest(),self.report['archiveSha256'])
        with tarfile.open(archive) as source:self.assertEqual(source.extractfile('FFmpeg/RELEASE').read().decode().strip(),'9.0.2')

    def test_binary_and_build_evidence_match_but_external_closure_is_not_claimed(self):
        for item in self.report['observedBinaries']:
            with (ROOT/'bin'/item['name']).open('rb') as stream:self.assertEqual(hashlib.file_digest(stream,'sha256').hexdigest(),item['sha256'])
        self.assertEqual(hashlib.sha256((self.folder/'FFmpeg-BUILD-INFO.txt').read_bytes()).hexdigest(),self.report['buildInfoSha256'])
        self.assertGreater(len(self.report['externalLibraries']),20)
        self.assertTrue(all(not p['exactSourceArchiveVerified'] for p in self.report['externalLibraries']))
        self.assertFalse(self.report['externalLibrarySourcesComplete'])
        self.assertFalse(self.report['binaryReproduced'])
        self.assertFalse(self.report['distributionReady'])
