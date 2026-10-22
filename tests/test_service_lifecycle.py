import asyncio
from contextlib import ExitStack
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import test_correctness as fixture  # Select an isolated profile before main imports.
from app import main as m
from app.db_lifecycle import WalAnchor
from app.service_lifecycle import ServiceLifecycle


class ServiceLifecycleTests(unittest.TestCase):
    def test_evidence_is_bounded_path_free_and_logs_rate_limited(self):
        state=ServiceLifecycle();state.logger=Mock()
        with patch('app.service_lifecycle.time.monotonic',return_value=100):
            for _ in range(10):state.outcome('playback-sweep',OSError('PRIVATE E:/downloads/title.mp4'))
        self.assertEqual(state.logger.warning.call_count,1)
        with patch('app.service_lifecycle.time.monotonic',return_value=161):state.outcome('playback-sweep',OSError('PRIVATE'))
        self.assertEqual(state.logger.warning.call_count,2)
        row=state.report()['steps']['playback-sweep']
        self.assertEqual(row['failures'],11);self.assertEqual(row['consecutive_failures'],11)
        state.outcome('playback-sweep')
        row=state.report()['steps']['playback-sweep']
        self.assertIsNone(row['error']);self.assertEqual(row['last_error'],'OSError');self.assertEqual(row['consecutive_failures'],0)
        for index in range(100):state.outcome(f'fixed-step-{index}')
        self.assertEqual(len(state.report()['steps']),24)
        self.assertNotIn('PRIVATE',json.dumps(state.report()));self.assertNotIn('downloads',json.dumps(state.report()))

    def test_failed_step_and_incomplete_join_are_not_success(self):
        state=ServiceLifecycle();state.logger=Mock()
        async def exercise():
            def failure():raise PermissionError('owned failure')
            error=await state.attempt('playback-sweep',failure)
            self.assertIsInstance(error,PermissionError)
            self.assertIsInstance(await state.attempt('scan-close',lambda:False,require_completed=True),RuntimeError)
            self.assertIsNone(await state.attempt('optional-none',lambda:None,require_completed=True))
        asyncio.run(exercise())
        self.assertEqual(state.report()['steps']['scan-close']['failures'],1)

    def test_cancellation_is_not_swallowed_or_reported_as_success(self):
        state=ServiceLifecycle()
        async def exercise():
            def cancel():raise asyncio.CancelledError()
            with self.assertRaises(asyncio.CancelledError):await state.attempt('cancelled',cancel,threaded=False)
        asyncio.run(exercise());self.assertEqual(state.report()['steps'],{})


class ApplicationCleanupTests(unittest.TestCase):
    closers=['playback-close','native-close','scan-close','covers-close','data-close','recycle-close']

    def setUp(self):
        self.assertTrue(m.DATA.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()))
        self.calls=[];self.outcomes={};self.state=ServiceLifecycle();self.state.logger=Mock()
        self.anchor=WalAnchor();self.addCleanup(self.anchor.close)
        self.stack=ExitStack();self.addCleanup(self.stack.close)
        def operation(name):
            def run():
                self.calls.append(name)
                results=self.outcomes.get(name,[])
                value=results.pop(0) if results else None
                if isinstance(value,BaseException):raise value
                return value
            return run
        self.services={
            'thumbnail_service':SimpleNamespace(start=operation('covers-start'),request_stop=operation('covers-stop'),close=operation('covers-close')),
            'scanner':SimpleNamespace(pause_for_shutdown=operation('scan-pause'),close=operation('scan-close')),
            'playback':SimpleNamespace(sweep=operation('playback-sweep'),close=operation('playback-close')),
            'native_prepare':SimpleNamespace(close=operation('native-close')),
            'data_jobs':SimpleNamespace(sweep=operation('data-sweep'),close=operation('data-close')),
            'recycle_service':SimpleNamespace(close=operation('recycle-close')),
            'db_anchor':self.anchor,'service_lifecycle':self.state,
        }
        for name,value in self.services.items():self.stack.enter_context(patch.object(m,name,value))

    def assert_closed(self):
        self.assertEqual([name for name in self.calls if name.endswith('-close')],self.closers)
        self.assertFalse(self.anchor.status()['connected']);self.assertFalse(self.anchor.status()['enabled'])

    def test_partial_start_failure_still_attempts_all_owners(self):
        self.outcomes['covers-start']=[RuntimeError('owned partial startup failure')]
        async def exercise():
            with self.assertRaisesRegex(RuntimeError,'owned partial startup failure'):
                async with m.lifespan(m.app):self.fail('Startup failure must not yield')
        asyncio.run(exercise());self.assert_closed()
        self.assertLess(self.calls.index('scan-pause'),self.calls.index('playback-close'))
        self.assertLess(self.calls.index('covers-stop'),self.calls.index('playback-close'))

    def test_cancellation_signal_and_close_failures_do_not_skip_other_owners(self):
        for name in ['scan-pause','playback-close','data-close']:self.outcomes[name]=[OSError('PRIVATE cleanup failure')]
        async def exercise():
            with self.assertRaisesRegex(RuntimeError,'scan-pause, playback-close, data-close'):
                async with m.lifespan(m.app):self.assertTrue(self.anchor.status()['connected'])
        asyncio.run(exercise());self.assert_closed()
        steps=self.state.report()['steps']
        for name in ['scan-pause','playback-close','data-close']:self.assertEqual(steps[name]['failures'],1)
        self.assertEqual(steps['recycle-close']['failures'],0)

    def test_worker_false_result_is_reported_after_all_cleanup(self):
        self.outcomes['scan-close']=[False]
        async def exercise():
            with self.assertRaisesRegex(RuntimeError,'scan-close'):
                async with m.lifespan(m.app):pass
        asyncio.run(exercise());self.assert_closed()

    def test_maintenance_recovers_and_other_component_runs_in_failed_cycle(self):
        self.outcomes['playback-sweep']=[PermissionError('owned transient failure')]
        async def exercise():
            real_sleep=asyncio.sleep
            async def short_interval(seconds):await real_sleep(.001 if seconds==10 else seconds)
            with patch.object(m.asyncio,'sleep',short_interval):
                async with m.lifespan(m.app):
                    for _ in range(200):
                        if self.calls.count('data-sweep')>=2:break
                        await real_sleep(.002)
                    else:self.fail('Maintenance loop did not recover')
                    row=self.state.report()['steps']['playback-sweep']
                    self.assertEqual(row['failures'],1);self.assertIsNone(row['error'])
                    self.assertEqual(row['consecutive_failures'],0)
        asyncio.run(exercise());self.assert_closed()
        self.assertLess(self.calls.index('data-sweep'),self.calls.index('playback-sweep',self.calls.index('playback-sweep')+1))

    def test_body_failure_or_cancellation_keeps_original_exception_after_cleanup(self):
        for error in [ValueError('owned body failure'),asyncio.CancelledError()]:
            self.calls.clear()
            async def exercise():
                with self.assertRaises(type(error)):
                    async with m.lifespan(m.app):raise error
            asyncio.run(exercise());self.assert_closed()
