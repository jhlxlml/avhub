"""Payload integrity tests plus local actual-binary evidence, not desktop acceptance."""
import hashlib
import json
import runpy
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
prepare = runpy.run_path(str(ROOT / 'scripts/controlled_cli_runtime.py'))['prepare']
POINTER = ROOT / 'build/controlled-cli-runtime-latest.json'


@unittest.skipUnless(POINTER.exists(), 'Requires explicitly built local CLI candidate')
class ControlledCliTests(unittest.TestCase):
    def test_actual_windows_pixels_and_encoder_evidence_matches_payload(self):
        runtime = Path(json.loads(POINTER.read_text(encoding='utf-8'))['folder'])
        acceptance = Path(json.loads((ROOT / 'build/controlled-cli-validation-latest.json').read_text(encoding='utf-8'))['folder'])
        report = json.loads((acceptance / 'report.json').read_text(encoding='utf-8'))
        self.assertTrue(report['passed'])
        self.assertEqual(len(report['samples']), 16)
        self.assertTrue(all(s['nativeFrameBytesEqual'] and s['screenshotRgb48BytesEqual'] and s['sourceUnchanged'] for s in report['samples']))
        for item in report['observedBinaries']:
            self.assertEqual(hashlib.sha256((runtime / Path(item['path']).name).read_bytes()).hexdigest(), item['sha256'])
        self.assertTrue(report['copiedVideoAudioSubtitlePacketsEqual'])

    def test_payload_installs_exact_files_and_refuses_changed_destination(self):
        runtime = Path(json.loads(POINTER.read_text(encoding='utf-8'))['folder'])
        with tempfile.TemporaryDirectory(prefix='avhub-cli-integrity-') as temporary:
            target = Path(temporary)
            prepare(ROOT, runtime, target)
            self.assertEqual((target / 'runtime-index.json').exists(), False)
            self.assertTrue((target / 'FFmpeg-RUNTIME.json').is_file())
            file = target / 'ffmpeg.exe'
            with file.open('r+b') as stream:
                stream.write(b'changed')
            with self.assertRaisesRegex(ValueError, 'Existing CLI differs'):
                prepare(ROOT, runtime, target)

    def test_wrong_source_profile_is_rejected_before_copy(self):
        runtime = Path(json.loads(POINTER.read_text(encoding='utf-8'))['folder'])
        with tempfile.TemporaryDirectory(prefix='avhub-cli-profile-') as temporary:
            directory = Path(temporary) / 'payload'
            directory.mkdir()
            metadata = json.loads((runtime / 'runtime-index.json').read_text(encoding='utf-8'))
            metadata['sourceProfileSha256'] = '0' * 64
            (directory / 'runtime-index.json').write_text(json.dumps(metadata), encoding='utf-8')
            target = Path(temporary) / 'destination'
            with self.assertRaisesRegex(ValueError, 'identity differs'):
                prepare(ROOT, directory, target)
            self.assertFalse(target.exists())
