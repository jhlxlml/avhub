"""Deterministic ordering/retention harness, not a playback performance test."""
import threading
import time
import unittest
from unittest.mock import patch
from app.publication_gate import PublicationGate
from app.db_timing import DatabaseTiming,OPERATIONS


class PublicationGateTests(unittest.TestCase):
    def wait_for(self,predicate):
        until=time.monotonic()+3
        while not predicate() and time.monotonic()<until:threading.Event().wait(.005)
        self.assertTrue(predicate())

    def test_wait_and_hold_have_separate_fixed_boundaries(self):
        gate=PublicationGate(lambda:{'operation':'scan-media','scope_id':7})
        with patch('app.publication_gate.time.perf_counter',side_effect=[1,1.2,1.5]):
            with gate:pass
        row=gate.report()['recent'][0]
        self.assertEqual((row['wait_ms'],row['hold_ms'],row['total_ms']),(200,300,500))
        self.assertEqual((row['scope_id'],row['operation']),(7,'scan-media'))
        self.assertEqual(row['outcome'],'completed');self.assertFalse(row['contended'])

    def test_reentrant_entries_do_not_double_count_hold_time(self):
        gate=PublicationGate()
        with gate:
            with gate:
                with gate.hold():pass
        report=gate.report();self.assertEqual(report['reentrant_entries'],2)
        self.assertEqual(report['groups']['unlabelled']['count'],1)
        self.assertEqual(len(report['recent']),1);self.assertIsNone(report['active'])

    def test_exception_releases_mutex_and_keeps_failure_evidence(self):
        gate=PublicationGate()
        with self.assertRaises(ValueError):
            with gate:
                with gate:raise ValueError('owned exception')
        with gate:pass
        report=gate.report();self.assertEqual(report['groups']['unlabelled']['failed'],1)
        self.assertEqual([r['outcome'] for r in report['recent']],['failed','completed'])
        self.assertEqual(report['waiting'],0);self.assertIsNone(report['active'])

    def test_contended_owner_is_observed_and_waiters_visible_without_taking_gate(self):
        timing=DatabaseTiming();gate=PublicationGate(timing.current_scope);entered=[]
        def waiter():
            with timing.scope('cover-publish'):
                with gate:entered.append(True)
        with timing.scope('scan-media') as scope:
            with gate:
                owner=gate.report()['active'];thread=threading.Thread(target=waiter);thread.start()
                self.wait_for(lambda:gate.report()['waiting']==1)
                self.assertEqual(gate.report()['active']['scope_id'],scope['scope_id'])
                self.assertEqual(entered,[])
        thread.join(3);self.assertFalse(thread.is_alive());self.assertEqual(entered,[True])
        row=next(r for r in gate.report()['recent'] if r['operation']=='cover-publish')
        self.assertTrue(row['contended']);self.assertEqual(row['observed_holder_gate_id'],owner['gate_id'])
        self.assertEqual(row['observed_holder_scope_id'],scope['scope_id'])
        self.assertGreater(row['wait_ms'],0);self.assertEqual(gate.report()['peak_waiting'],1)

    def test_scopes_reset_and_gate_ids_are_distinct(self):
        timing=DatabaseTiming();gate=PublicationGate(timing.current_scope)
        with timing.scope('scan-media') as scope:
            with gate:ticket=timing.begin_serialized()
        with gate:pass
        rows=gate.report()['recent'];self.assertEqual(rows[0]['scope_id'],ticket['scope_id'])
        self.assertEqual(scope['scope_id'],rows[0]['scope_id']);self.assertNotIn('scope_id',rows[1])
        self.assertNotEqual(rows[0]['gate_id'],rows[1]['gate_id'])
        self.assertEqual(timing.report()['lifetime']['groups'],{},'Gate timing must not be added to database timing')

    def test_unknown_labels_and_private_fields_are_never_retained(self):
        gate=PublicationGate(lambda:{'operation':'E:/private/video.mp4','scope_id':'private','path':'secret'})
        with gate:pass
        report=gate.report();self.assertEqual(list(report['groups']),['unlabelled'])
        self.assertNotIn('private',str(report));self.assertNotIn('secret',str(report))

    def test_samples_groups_and_worst_are_bounded_and_snapshots_cannot_mutate_state(self):
        label=['unlabelled'];gate=PublicationGate(lambda:{'operation':label[0]})
        with patch('app.publication_gate.time.perf_counter',side_effect=[1,1.2,1.5]):
            with gate:pass
        for name in [*OPERATIONS,'unlabelled']:
            label[0]=name
            for _ in range(100):
                with gate:pass
        report=gate.report();self.assertEqual(len(report['groups']),report['group_capacity'])
        self.assertEqual(len(report['recent']),32);self.assertEqual(len(report['worst']),8)
        self.assertEqual(report['worst'][0]['total_ms'],500)
        report['worst'][0]['total_ms']=0;report['groups']['scan-media']['max_ms']['wait']=999
        self.assertEqual(gate.report()['worst'][0]['total_ms'],500)
        self.assertNotEqual(gate.report()['groups']['scan-media']['max_ms']['wait'],999)

    def test_parallel_updates_are_serialized_and_counted_exactly(self):
        gate=PublicationGate();counter=[0]
        def work():
            for _ in range(100):
                with gate:counter[0]+=1
        threads=[threading.Thread(target=work) for _ in range(4)]
        for thread in threads:thread.start()
        for thread in threads:thread.join(5);self.assertFalse(thread.is_alive())
        self.assertEqual(counter[0],400);self.assertEqual(gate.report()['groups']['unlabelled']['count'],400)


if __name__=='__main__':unittest.main()
