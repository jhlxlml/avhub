import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import backend_report


class BackendReportTests(unittest.TestCase):
    def test_verbose_log_and_structured_failures_survive_a_failed_suite(self):
        class Owned(unittest.TestCase):
            def test_success(self):pass
            def test_failure(self):self.fail('owned injected assertion')
            def test_error(self):raise ValueError('owned injected error')
            @unittest.skip('owned skip')
            def test_skip(self):pass
        with tempfile.TemporaryDirectory(prefix='avhub-test-report-') as owned:
            root=Path(owned).resolve()
            with patch.object(backend_report,'ROOT',root),contextlib.redirect_stderr(io.StringIO()):
                result=backend_report.run(unittest.defaultTestLoader.loadTestsFromTestCase(Owned),'owned')
            self.assertFalse(result.wasSuccessful())
            directory=root/'build/backend-tests'
            report=json.loads((directory/'owned.json').read_text(encoding='utf-8'))
            self.assertFalse(report['passed']);self.assertEqual(report['tests'],4)
            self.assertEqual(len(report['failures']),1);self.assertEqual(len(report['errors']),1)
            self.assertEqual(len(report['skipped']),1)
            self.assertIn('owned injected assertion',report['failures'][0]['traceback'])
            self.assertIn('test_success',(directory/'owned.log').read_text(encoding='utf-8'))
    def test_invalid_report_names_are_rejected(self):
        for value in ('../escape','', 'x'*100):
            with self.subTest(value=value),self.assertRaises(ValueError):backend_report.run(unittest.TestSuite(),value)
