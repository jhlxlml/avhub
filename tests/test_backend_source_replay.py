"""Audit real backend compile/verification receipts; never simulate completion."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'build/backend-source-replay-evidence.json'


@unittest.skipUnless(EVIDENCE.exists(),'Requires explicit frozen-source backend replay')
class BackendSourceReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence=json.loads(EVIDENCE.read_text());cls.receipt=json.loads(Path(cls.evidence['correctedExecutableVerification']).read_text())

    def test_rebuilt_executable_matches_frozen_build_and_closes_normally(self):
        evidence=self.evidence;receipt=self.receipt
        self.assertTrue(receipt['passed']);self.assertTrue(receipt['health']['frozen'])
        self.assertEqual(receipt['health']['build_id'],evidence['buildId'])
        self.assertTrue(receipt['health']['sqlite_runtime']['verified'])
        self.assertEqual(receipt['exitCode'],0);self.assertNotIn('forcedTermination',receipt)
        with Path(evidence['backendExe']).open('rb') as stream:self.assertEqual(hashlib.file_digest(stream,'sha256').hexdigest(),evidence['backendExeSha256'])
        self.assertTrue(receipt['unauthenticatedNoticeRejected'])
        self.assertTrue(receipt['frontendNoticeFilesMatch']);self.assertTrue(receipt['frontendEntryResponseMatches'])

    def test_source_inputs_and_original_failed_verification_are_retained(self):
        inventory=json.loads((Path(self.evidence['sourceSnapshot'])/'source-review-inventory.json').read_text())
        replay=Path(self.evidence['backendExe']).parents[3]
        for item in inventory['files']:
            file=replay/item['path']
            with file.open('rb') as stream:self.assertEqual(hashlib.file_digest(stream,'sha256').hexdigest(),item['sha256'])
        prior=json.loads(Path(self.evidence['initialBackendBuildAndVerificationReceipt']).read_text())
        self.assertFalse(prior['passed']);self.assertTrue(self.evidence['originalFailurePreserved'])
        self.assertFalse(self.evidence['cleanEnvironment']);self.assertFalse(self.evidence['nativeRuntimeRebuilt'])
