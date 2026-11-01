"""Source-delivery identity contracts on synthetic files, not package acceptance."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('source_delivery',ROOT/'scripts/stage-m5-source-delivery.py')
delivery=importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)
stage_spec=importlib.util.spec_from_file_location('application_stage',ROOT/'scripts/stage-application-source.py')
application_stage=importlib.util.module_from_spec(stage_spec)
stage_spec.loader.exec_module(application_stage)


class SourceDeliveryIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.source=root/'source';self.source.mkdir()
        self.replay=root/'replay';(self.replay/'app').mkdir(parents=True)
        self.identity={'version':'1.2.3','api_protocol':2,'build_id':'fixture-build','built_at':'2026-10-31T00:00:00.000Z'}
        self.inventory={'buildIdentityReference':self.identity}
        (self.source/'package.json').write_text(json.dumps({'version':'1.2.3'}),encoding='utf-8')
        (self.replay/'app/build-info.json').write_text(json.dumps(self.identity),encoding='utf-8')
        self.report={'source':str(self.source),'passed':True}
        (self.replay/'replay-report.json').write_text(json.dumps(self.report),encoding='utf-8')

    def test_generated_metadata_comes_from_verified_replay_not_source_tree(self):
        self.assertFalse((self.source/'app/build-info.json').exists())
        self.assertEqual(delivery.replay_build_identity(self.source,self.inventory,self.replay),self.identity)

    def test_failed_or_other_snapshot_replay_is_rejected(self):
        for report in ({**self.report,'passed':False},{**self.report,'source':str(self.source/'other')}):
            with self.subTest(report=report):
                (self.replay/'replay-report.json').write_text(json.dumps(report),encoding='utf-8')
                with self.assertRaisesRegex(ValueError,'selected source snapshot'):
                    delivery.replay_build_identity(self.source,self.inventory,self.replay)

    def test_replayed_timestamp_or_build_cannot_be_relabelled_as_frozen(self):
        for key,value in (('build_id','different-build'),('built_at','2026-10-30T00:00:00.000Z')):
            with self.subTest(key=key):
                (self.replay/'app/build-info.json').write_text(json.dumps({**self.identity,key:value}),encoding='utf-8')
                with self.assertRaisesRegex(ValueError,'frozen source identity'):
                    delivery.replay_build_identity(self.source,self.inventory,self.replay)

    def test_package_version_must_match_actual_metadata(self):
        (self.source/'package.json').write_text('{"version":"9.9.9"}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'identity/version'):
            delivery.replay_build_identity(self.source,self.inventory,self.replay)

    def test_review_snapshot_keeps_owned_binary_regression_fixture_not_personal_images(self):
        # Synthetic Git inventory, actual file-copy/hash pipeline. No repository
        # commit, real user data or claim of release/source-package acceptance.
        root=self.source;(root/'build').mkdir();(root/'app').mkdir();(root/'tests/fixtures').mkdir(parents=True)
        (root/'app/build-info.json').write_text(json.dumps(self.identity),encoding='utf-8')
        (root/'LICENSE').write_text('fixture license',encoding='utf-8')
        (root/'package-lock.json').write_text('{}',encoding='utf-8')
        (root/'run.py').write_text('# fixture',encoding='utf-8')
        fixture=(ROOT/'tests/fixtures/native-hdr-pq.png').read_bytes()
        (root/'tests/fixtures/native-hdr-pq.png').write_bytes(fixture)
        (root/'tests/fixtures/personal.png').write_bytes(b'not a source asset')
        (root/'tests/fixtures/personal.mp4').write_bytes(b'not a source asset')
        names=['LICENSE','package.json','package-lock.json','run.py','app/build-info.json','tests/fixtures/native-hdr-pq.png','tests/fixtures/personal.png','tests/fixtures/personal.mp4']
        with patch.object(application_stage.subprocess,'check_output',side_effect=['\0'.join(names).encode(),'synthetic-head\n']):
            snapshot=application_stage.stage(root)
        self.assertEqual((snapshot/'tests/fixtures/native-hdr-pq.png').read_bytes(),fixture)
        self.assertFalse((snapshot/'tests/fixtures/personal.png').exists());self.assertFalse((snapshot/'tests/fixtures/personal.mp4').exists())
        inventory=json.loads((snapshot/'source-review-inventory.json').read_text(encoding='utf-8'))
        record=next(item for item in inventory['files'] if item['path']=='tests/fixtures/native-hdr-pq.png')
        self.assertEqual(record['size'],len(fixture));self.assertEqual(record['sha256'],'845d934db210abc63d8fffb161bda9efbf1cdf5f5d0867d0ebbcb973422af8b7')
