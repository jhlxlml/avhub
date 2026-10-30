"""Audit explicit local source captures, not simulated upstream availability."""
import hashlib,json,tarfile,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
POINTER=ROOT/'build/ffmpeg-external-source-review-latest.json'

@unittest.skipUnless(POINTER.exists(),'Requires explicit external dependency source capture')
class ExternalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=Path(json.loads(POINTER.read_text(encoding='utf-8'))['folder'])
        cls.report=json.loads((cls.folder/'report.json').read_text(encoding='utf-8'))

    def test_upstream_archives_and_exact_license_bytes(self):
        pins=json.loads((ROOT/'ci/ffmpeg-external-sources.json').read_text(encoding='utf-8'))['libraries']
        self.assertEqual(len(self.report['members']),len(pins))
        for member in self.report['members']:
            pin=next(p for p in pins if p['name']==member['name'])
            self.assertEqual(member['revision'],pin['revision'])
            archive=self.folder/member['archive']
            with archive.open('rb') as stream:self.assertEqual(hashlib.file_digest(stream,'sha256').hexdigest(),member['archiveSha256'])
            with tarfile.open(archive) as source:
                license_bytes=source.extractfile(member['name']+'/'+member['license']).read()
            self.assertEqual(license_bytes,(self.folder/(member['name']+'-COPYING.txt')).read_bytes())
            self.assertTrue(license_bytes.strip())
            self.assertFalse(member['vendorPatchesVerified'])

    def test_real_synthetic_encoder_revision_and_unfinished_scope(self):
        for member in self.report['members']:
            if 'runtimePrefix' not in member:continue
            stream=(self.folder/member['syntheticBitstream']).read_bytes()
            self.assertEqual(hashlib.sha256(stream).hexdigest(),member['syntheticBitstreamSha256'])
            log=(self.folder/(member['name']+'-synthetic-encoder.log')).read_bytes()
            self.assertIn(member['runtimePrefix'].encode(),stream+log)
        self.assertEqual(self.report['reportedExternalLibraryCount'],37)
        self.assertEqual(len(self.report['notYetArchived']),37-len(self.report['members']))
        self.assertFalse(self.report['allExternalLibrariesCovered'])
        self.assertFalse(self.report['vendorPatchesAndBuildRecipesVerified'])
        self.assertFalse(self.report['binaryReproduced']);self.assertFalse(self.report['distributionReady'])
