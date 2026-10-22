"""Passive readiness state tests; simulated clocks/queues are not performance data."""
from contextlib import ExitStack
import threading
import unittest
from unittest.mock import patch
from app.scan_readiness import ScanReadiness

class ScanCancelled(Exception):pass


class ScanReadinessTests(unittest.TestCase):
    def test_disabled_observer_does_not_read_clock_allocate_tickets_or_record_fake_zeros(self):
        observer=ScanReadiness(enabled=False)
        with patch('app.scan_readiness.time.perf_counter',side_effect=AssertionError('disabled clock')):
            self.complete(observer)
        report=observer.report();self.assertFalse(report['enabled']);self.assertEqual(report['started'],0)
        self.assertEqual(report['stages'],{});self.assertEqual(report['recent'],[])

    def complete(self,observer):
        with observer.item() as item:item.probed();item.ready();item.writing(7);item.committed()

    def test_stage_boundaries_and_durable_ack_are_distinct(self):
        observer=ScanReadiness()
        with patch('app.scan_readiness.time.perf_counter',side_effect=[10,11,12,14,17,18]):self.complete(observer)
        report=observer.report();row=report['recent'][0]
        self.assertEqual((row['probe_and_budget_ms'],row['prepare_ms'],row['ready_wait_ms'],row['write_ms'],row['total_ms']),
                         (1000,1000,2000,3000,8000))
        self.assertEqual(row['scope_id'],7);self.assertEqual(report['outcomes']['committed'],1)
        self.assertEqual(report['ready_at_arrival_counts'][1],1)
        self.assertEqual(report['other_ready_at_writer_entry_counts'][0],1)

    def test_other_ready_counts_exclude_the_current_writer_and_probing_items(self):
        observer=ScanReadiness()
        with observer.item() as a,observer.item() as b,observer.item():
            a.probed();a.ready();b.probed();b.ready()
            self.assertEqual(observer.report()['active']['ready'],2)
            a.writing(1);b.writing(2);a.committed();b.committed()
        report=observer.report();rows={r.get('scope_id'):r for r in report['recent']}
        self.assertEqual(rows[1]['others_ready'],1);self.assertEqual(rows[2]['others_ready'],0)
        self.assertEqual(report['peak_ready'],2);self.assertEqual(report['outcomes']['abandoned'],1)

    def test_capacity_never_blocks_work_or_accumulates_unbounded_active_items(self):
        observer=ScanReadiness()
        with ExitStack() as stack:
            items=[stack.enter_context(observer.item()) for _ in range(9)]
            self.assertEqual(sum(observer.report()['active'].values()),8)
            for item in items:item.probed();item.ready();item.writing();item.committed()
        report=observer.report();self.assertEqual(report['started'],9);self.assertEqual(report['omitted'],1)
        self.assertEqual(report['outcomes']['committed'],8);self.assertEqual(sum(report['active'].values()),0)

    def test_cancel_failure_and_missing_commit_are_not_successes_or_private_error_text(self):
        observer=ScanReadiness(ScanCancelled)
        for error in [ScanCancelled(),ValueError('E:/private/title.mp4')]:
            with self.assertRaises(type(error)):
                with observer.item() as item:item.probed();item.ready();raise error
        with observer.item() as item:item.probed();item.ready();item.writing()
        report=observer.report();self.assertEqual(report['outcomes'],{'committed':0,'cancelled':1,'failed':1,'abandoned':1})
        self.assertNotIn('private',str(report));self.assertEqual(report['stages']['ready_wait']['count'],1)

    def test_recent_records_are_bounded_without_discarding_lifetime_maxima(self):
        observer=ScanReadiness()
        with patch('app.scan_readiness.time.perf_counter',side_effect=[10,11,12,14,17,18]):self.complete(observer)
        for _ in range(600):self.complete(observer)
        report=observer.report();self.assertEqual(len(report['recent']),128);self.assertEqual(len(report['worst_wait']),8)
        self.assertEqual(report['outcomes']['committed'],601)
        self.assertEqual(report['stages']['ready_wait']['max_ms'],2000)
        self.assertEqual(report['worst_wait'][0]['ready_wait_ms'],2000)
        report['stages']['ready_wait']['max_ms']=0;report['worst_wait'][0]['scope_id']=999
        report['ready_at_arrival_counts'][1]=0
        again=observer.report();self.assertEqual(again['stages']['ready_wait']['max_ms'],2000)
        self.assertEqual(again['worst_wait'][0]['scope_id'],7);self.assertEqual(again['ready_at_arrival_counts'][1],601)

    def test_invalid_mark_does_not_throw_or_change_scheduler(self):
        observer=ScanReadiness()
        with observer.item() as item:
            item.writing();item.probed();item.ready();item.writing();item.committed()
        self.assertEqual(observer.report()['invalid_transitions'],1)
        self.assertEqual(observer.report()['outcomes']['committed'],1)

    def test_concurrent_counts_are_complete_and_reports_do_not_take_work_locks(self):
        observer=ScanReadiness();threads=[threading.Thread(target=lambda:[self.complete(observer) for _ in range(100)]) for _ in range(4)]
        for thread in threads:thread.start()
        for thread in threads:thread.join(3);self.assertFalse(thread.is_alive())
        report=observer.report();self.assertEqual(report['outcomes']['committed'],400)
        self.assertEqual(report['invalid_transitions'],0);self.assertEqual(report['omitted'],0)
