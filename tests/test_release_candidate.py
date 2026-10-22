"""No network, credentials or publishing: exact-commit candidate gate contracts."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('release_candidate',Path(__file__).resolve().parents[1]/'scripts/check-release-candidate.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)


class ReleaseCandidateTests(unittest.TestCase):
    def setUp(self):
        self.sha='a'*40
        self.run={'id':12,'head_sha':self.sha,'event':'workflow_dispatch','status':'completed','conclusion':'success','head_repository':{'full_name':gate.REPOSITORY}}
        self.job={'name':'verify','conclusion':'success','steps':[{'name':name,'conclusion':'success'} for name in gate.REQUIRED_STEPS]}
        self.asset={'id':34,'name':'windows-portable-'+self.sha,'expired':False,'size_in_bytes':100}
        self.calls=[]
    def get(self,route):
        self.calls.append(route)
        if '/workflows/' in route:return {'workflow_runs':[self.run]}
        if '/jobs?' in route:return {'jobs':[self.job]}
        if '/artifacts?' in route:return {'artifacts':[self.asset]}
        raise AssertionError(route)
    def test_only_exact_successful_manual_candidate_with_packaged_evidence_is_accepted(self):
        self.assertEqual(gate.verified_candidate(self.get,self.sha),{'sha':self.sha,'candidate_run':12,'artifact':34})
        self.assertTrue(all(route.startswith('/actions/') for route in self.calls))
    def test_branch_success_native_only_other_source_and_untrusted_repository_do_not_qualify(self):
        original=copy.deepcopy(self.run)
        for change in ({'event':'push'},{'conclusion':'failure'},{'status':'in_progress'},
                       {'head_sha':'b'*40},{'head_repository':{'full_name':'other/repo'}}):
            with self.subTest(change=change):
                self.run=original|change
                with self.assertRaises(RuntimeError):gate.verified_candidate(self.get,self.sha)
        self.run=original
        for name in gate.REQUIRED_STEPS:
            with self.subTest(skipped=name):
                self.job['steps']=[{'name':value,'conclusion':'skipped' if value==name else 'success'} for value in gate.REQUIRED_STEPS]
                with self.assertRaises(RuntimeError):gate.verified_candidate(self.get,self.sha)
    def test_expired_empty_or_mismatched_artifacts_keep_gate_closed(self):
        original=self.asset.copy()
        for change in ({'expired':True},{'size_in_bytes':0},{'name':'windows-portable-'+'b'*40}):
            with self.subTest(change=change):
                self.asset=original|change
                with self.assertRaises(RuntimeError):gate.verified_candidate(self.get,self.sha)
    def test_no_candidate_or_malformed_sha_fails_without_any_write(self):
        with self.assertRaises(RuntimeError):gate.verified_candidate(lambda _: {'workflow_runs':[]},self.sha)
        with self.assertRaises(ValueError):gate.verified_candidate(lambda _: self.fail('invalid SHA must not call API'),'main')
    def test_paginates_candidates_and_checks_latest_job_attempt(self):
        def get(route):
            if '/workflows/' in route:
                return {'workflow_runs':[self.run|{'head_sha':'b'*40}]*100 if '&page=1' in route else [self.run]}
            self.assertTrue('/jobs?filter=latest' in route or '/artifacts?' in route)
            return self.get(route)
        self.assertEqual(gate.verified_candidate(get,self.sha)['candidate_run'],12)
