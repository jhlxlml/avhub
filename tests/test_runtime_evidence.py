import tempfile
import threading
import time
import unittest
from pathlib import Path
from app.runtime_evidence import RuntimeEvidence
from app.scanning import ScanManager
from app.db_timing import DatabaseTiming
import test_scan_jobs as fixture
from app.scan_jobs import ThumbnailService
from app import main as m


class RuntimeEvidenceTests(unittest.TestCase):
    def test_bounded_persistent_evidence_without_frame_locals(self):
        with tempfile.TemporaryDirectory() as folder:
            evidence=RuntimeEvidence(lambda:Path(folder))
            private_source='a private source filename never copied into a stack'
            for i in range(10):evidence.capture('test-timeout',{'processed':i})
            report=RuntimeEvidence(lambda:Path(folder)).report()
            self.assertEqual(len(report['events']),8)
            raw=(Path(folder)/'diagnostics'/'worker-timeouts.json').read_text()
            self.assertNotIn(private_source,raw)
            for event in report['events']:
                for thread in event['threads']:
                    for frame in thread['stack']:self.assertEqual(set(frame),{'file','line','function'})
            self.assertEqual(report['events'][-1]['state']['processed'],9)
            restarted=RuntimeEvidence(lambda:Path(folder));restarted.capture('after-restart',{})
            self.assertEqual(len(restarted.report()['events']),8)
            self.assertEqual(restarted.report()['events'][-2]['state']['processed'],9)

    def test_scan_close_bounds_wait_preserves_checkpoint_and_records_stuck_thread(self):
        entered=threading.Event();release=threading.Event();saved=[];events=[]
        manager=ScanManager(lambda *args:saved.append(args),lambda *args:events.append(args))
        manager.start(1,lambda manager:(entered.set(),release.wait(3)))
        self.assertTrue(entered.wait(1))
        try:
            began=time.monotonic();self.assertFalse(manager.close(timeout=.02))
            self.assertLess(time.monotonic()-began,.3);self.assertEqual(events[0][0],'metadata-close-timeout')
        finally:release.set();self.assertTrue(manager.close())
        self.assertEqual(manager.snapshot()['state'],'interrupted');self.assertEqual(saved[-1],(1,'interrupted'))

    def test_database_long_tail_callback_is_async_and_rate_limited(self):
        called=threading.Event();calls=[]
        timing=DatabaseTiming(lambda sample:(calls.append(sample),called.set()))
        for _ in range(3):timing.record('read',{'total':3,'lock_wait':0})
        self.assertTrue(called.wait(1));self.assertEqual(len(calls),1)


class CoverCloseTests(unittest.TestCase):
    setUp=fixture.ScanJobsTests.setUp
    seed=fixture.ScanJobsTests.seed

    def test_cover_timeout_records_id_without_path_and_keeps_queue(self):
        self.seed();entered=threading.Event();release=threading.Event();events=[]
        def work(*args):entered.set();release.wait(3);return True,''
        service=ThumbnailService(m.connection,work,m.read_connection,lambda *args:events.append(args))
        service.start();self.assertTrue(entered.wait(1))
        try:
            self.assertFalse(service.close(timeout=.02));self.assertEqual(events[0][0],'thumbnail-close-timeout')
            self.assertNotIn('path',events[0][1]);self.assertEqual(self.jobs.count(),1)
        finally:release.set();self.assertTrue(service.close())
