import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from app.db_timing import DatabaseTiming


class DatabaseTimingTests(unittest.TestCase):
    def test_scope_snapshot_cannot_change_operation_or_correlation(self):
        timing=DatabaseTiming()
        with timing.scope('scan-media') as scope:
            snapshot=timing.current_scope();snapshot['operation']='changed';snapshot['scope_id']=0
            self.assertEqual(timing.current_scope(),scope)
        self.assertEqual(timing.current_scope(),{})

    def test_operation_groups_are_bounded_and_keep_early_commit_and_change_evidence(self):
        from app.db_timing import OPERATIONS
        timing=DatabaseTiming()
        with timing.scope('cover-queue'):
            ticket=timing.begin_serialized()
            timing.record('serialized',{'commit':.2,'total':.21},{**ticket,'changed_rows':2,
                'transaction_open_at_commit':True,'commit_attempted':True,'transaction_outcome':'committed'})
        for _ in range(600):
            with timing.scope('cover-queue'):timing.record('serialized',{'commit':.001,'total':.002})
        for operation in OPERATIONS:
            for kind in ['read','serialized']:
                with timing.scope(operation):timing.record(kind,{'commit':0,'total':.001})
        for kind in ['read','serialized']:timing.record(kind,{'commit':0,'total':.001})
        report=timing.report()['operation_lifetime'];row=report['groups']['serialized:cover-queue']
        self.assertEqual(len(report['groups']),report['capacity']);self.assertEqual(row['changed_rows'],2)
        self.assertEqual(row['max_ms']['commit'],200);self.assertEqual(row['worst_commit']['connection_id'],ticket['connection_id'])
        self.assertEqual(row['attempted_commits'],1);self.assertEqual(row['open_transactions'],1)
        row['worst_commit']['changed_rows']=99;row['max_ms']['commit']=99
        self.assertEqual(timing.report()['operation_lifetime']['groups']['serialized:cover-queue']['worst_commit']['changed_rows'],2)

    def test_scopes_are_isolated_nested_and_reset_after_failure(self):
        timing=DatabaseTiming()
        with timing.scope('progress-save') as outer:
            with self.assertRaises(RuntimeError):
                with timing.scope('scan-media') as inner:
                    self.assertNotEqual(outer['scope_id'],inner['scope_id']);raise RuntimeError()
            self.assertEqual(timing.begin_serialized()['scope_id'],outer['scope_id'])
        self.assertNotIn('scope_id',timing.begin_serialized())
        barrier=threading.Barrier(2)
        def work(label):
            with timing.scope(label) as scope:
                barrier.wait(2)
                return scope,timing.begin_serialized()
        with ThreadPoolExecutor(2) as pool:
            a=pool.submit(work,'progress-save');b=pool.submit(work,'scan-media')
            results=[a.result(3),b.result(3)]
        for scope,ticket in results:self.assertEqual(scope['scope_id'],ticket['scope_id']);self.assertEqual(scope['operation'],ticket['operation'])
        self.assertNotEqual(results[0][0]['scope_id'],results[1][0]['scope_id'])

    def test_save_trace_correlates_observed_writer_without_claiming_exclusive_cause(self):
        timing=DatabaseTiming()
        with timing.scope('scan-media'):
            scan=timing.begin_serialized()
        with timing.writer(scan):
            with timing.scope('progress-save') as scope:
                save=timing.begin_serialized()
                self.assertEqual(save['observed_writer_connection_id'],scan['connection_id'])
                self.assertEqual(save['observed_writer_operation'],'scan-media')
                timing.record('serialized',{'lock_wait':.2,'commit':.002,'total':.202},save)
        self.assertNotIn('observed_writer_connection_id',timing.begin_serialized())
        report=timing.report();row=report['save_trace']['operations'][0]
        self.assertEqual(row['scope_id'],scope['scope_id']);self.assertEqual(row['lock_wait'],200)
        self.assertEqual(report['slow_operations'][0]['connection_id'],row['connection_id'])
        # Trace strings are deliberately not mixed into numeric percentiles.
        self.assertEqual(report['groups']['serialized']['stages']['commit']['max_ms'],2)

    def test_fast_saves_remain_bounded_and_report_cannot_mutate_evidence(self):
        timing=DatabaseTiming()
        for _ in range(40):
            with timing.scope('progress-save'):
                timing.record('serialized',{'total':.001},timing.begin_serialized())
        before=timing.report();self.assertEqual(len(before['save_trace']['operations']),32)
        before['save_trace']['operations'][0]['operation']='modified snapshot'
        self.assertEqual(timing.report()['save_trace']['operations'][0]['operation'],'progress-save')
        self.assertEqual(timing.report()['slow_operations'],[])
        with self.assertRaises(ValueError):
            with timing.scope('E:/private/source.mp4'):pass
        self.assertNotIn('private',str(timing.report()))

    def test_reentrant_writer_is_restored_even_on_error(self):
        timing=DatabaseTiming();outer=timing.begin_serialized()
        with self.assertRaises(RuntimeError):
            with timing.writer(outer):
                nested=timing.begin_serialized()
                with timing.writer(nested):pass
                self.assertEqual(timing.begin_serialized()['observed_writer_connection_id'],outer['connection_id'])
                raise RuntimeError()
        self.assertNotIn('observed_writer_connection_id',timing.begin_serialized())

    def test_early_tail_survives_rolling_samples_and_recent_slow_events(self):
        timing=DatabaseTiming()
        timing.record('serialized',{'commit':6.4,'close':2.5,'total':8.9})
        for _ in range(600):timing.record('read',{'commit':0,'close':.0001,'total':.001})
        for _ in range(40):timing.record('serialized',{'commit':.2,'close':.0001,'total':.2001})
        report=timing.report()
        self.assertEqual(len(timing.samples),512);self.assertEqual(len(report['slow_operations']),32)
        self.assertLess(report['groups']['serialized']['stages']['commit']['max_ms'],6400)
        lifetime=report['lifetime'];group=lifetime['groups']['serialized']
        self.assertEqual(group['count'],41);self.assertEqual(group['slow_count'],41)
        self.assertEqual(group['max_ms']['commit'],6400);self.assertEqual(group['max_ms']['close'],2500)
        self.assertEqual(lifetime['worst_operations'][0]['total'],8900)
        self.assertEqual(len(lifetime['worst_operations']),8)

    def test_report_snapshot_does_not_change_when_new_records_arrive(self):
        timing=DatabaseTiming();timing.record('read',{'total':.001})
        before=timing.report();timing.record('read',{'total':.2})
        self.assertEqual(before['lifetime']['groups']['read']['count'],1)
        self.assertEqual(before['lifetime']['groups']['read']['max_ms']['total'],1)
        self.assertEqual(timing.report()['lifetime']['groups']['read']['count'],2)

    def test_all_run_counters_are_thread_safe_and_bounded(self):
        timing=DatabaseTiming()
        threads=[threading.Thread(target=lambda:[timing.record('read',{'total':.001}) for _ in range(500)]) for _ in range(4)]
        for thread in threads:thread.start()
        for thread in threads:thread.join()
        self.assertEqual(timing.report()['lifetime']['groups']['read']['count'],2000)
        for index in range(20):timing.record(f'fixed-test-{index}',{'total':.001})
        report=timing.report()['lifetime']
        self.assertEqual(len(report['groups']),8);self.assertEqual(report['omitted_operations'],13)
