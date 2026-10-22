"""Correlated progress diagnostics must never replace durable confirmation."""
import sqlite3
import asyncio
import json
import time
import threading
import unittest
from unittest.mock import patch
from starlette.responses import Response
from fastapi import FastAPI
import test_correctness as fixture
from app import main as m
from app.db_timing import DatabaseTiming
from app.progress_timing import ProgressTiming


class ProgressTraceTests(unittest.TestCase):
    setUp=fixture.CorrectnessTests.setUp

    def test_queued_progress_commits_before_already_waiting_metadata(self):
        observed=[];errors=[];response=Response()
        def metadata():
            try:
                with m.connection() as db:
                    observed.append(db.execute('SELECT progress FROM media WHERE id=1').fetchone()[0])
                    db.execute("UPDATE media SET title='owned later metadata' WHERE id=1")
            except BaseException as error:errors.append(error)
        def save():
            try:m.save_progress(1,m.ProgressInput(progress=37,updated_at=2000),response)
            except BaseException as error:errors.append(error)
        def queued(key):
            deadline=time.monotonic()+2
            while m.DB_LOCK.status()[key]!=1 and time.monotonic()<deadline:time.sleep(.002)
            self.assertEqual(m.DB_LOCK.status()[key],1)
        background=threading.Thread(target=metadata);foreground=threading.Thread(target=save)
        try:
            with m.DB_LOCK:
                background.start();queued('waiting_normal')
                foreground.start();queued('waiting_saves')
        finally:
            for thread in (background,foreground):
                if thread.ident is not None:thread.join(4)
        self.assertFalse(background.is_alive());self.assertFalse(foreground.is_alive());self.assertEqual(errors,[])
        self.assertEqual(observed,[37]);self.assertIn('X-AVHub-Save-Trace',response.headers)
        with m.read_connection() as db:self.assertEqual(db.execute('SELECT title FROM media WHERE id=1').fetchone()[0],'owned later metadata')

    def test_http_injects_trace_header_without_changing_response_body(self):
        timing=DatabaseTiming();api=FastAPI()
        api.put('/progress/{media_id}')(m.save_progress)
        async def invoke():
            messages=[]
            async def receive():return {'type':'http.request','body':json.dumps({'progress':23,'updated_at':2000}).encode(),'more_body':False}
            async def send(message):messages.append(message)
            await api({'type':'http','asgi':{'version':'3.0'},'method':'PUT','path':'/progress/1',
                'raw_path':b'/progress/1','query_string':b'','headers':[(b'content-type',b'application/json')],
                'server':('127.0.0.1',80),'client':('127.0.0.1',10000),'scheme':'http','http_version':'1.1'},receive,send)
            return messages
        with patch.object(m,'database_timing',timing):
            messages=asyncio.run(invoke())
        start=next(row for row in messages if row['type']=='http.response.start')
        body=json.loads(b''.join(row.get('body',b'') for row in messages if row['type']=='http.response.body'))
        self.assertEqual(start['status'],200);self.assertEqual(body['progress'],23)
        self.assertEqual(set(body),{'id','progress','watched','last_played'})
        self.assertEqual(int(dict(start['headers'])[b'x-avhub-save-trace']),timing.report()['save_trace']['operations'][0]['scope_id'])

    def test_header_maps_to_committed_database_operation(self):
        timing=DatabaseTiming();response=Response()
        with patch.object(m,'database_timing',timing):
            result=m.save_progress(1,m.ProgressInput(progress=37,updated_at=2000),response)
        self.assertEqual(result['progress'],37)
        scope_id=int(response.headers['X-AVHub-Save-Trace'])
        row=timing.report()['save_trace']['operations'][0]
        self.assertEqual((row['scope_id'],row['operation'],row['transaction_outcome']),(scope_id,'progress-save','committed'))
        with m.read_connection() as db:self.assertEqual(db.execute('SELECT progress FROM media WHERE id=1').fetchone()[0],37)
        self.assertNotIn(str(self.source),str(timing.report()))
        self.assertNotIn('X-AVHub-Progress-Handler-Ms',response.headers)

    def test_profiled_http_body_dispatch_and_commit_share_the_actual_request(self):
        timing=DatabaseTiming();api=FastAPI();api.add_middleware(ProgressTiming)
        api.put('/api/media/{media_id}/progress')(m.save_progress)
        async def invoke():
            messages=[];reads=0
            async def receive():
                nonlocal reads
                reads+=1
                return {'type':'http.request','body':b'{"progress":23,"updated_at":2000}','more_body':False}
            async def send(message):messages.append(message)
            await api({'type':'http','asgi':{'version':'3.0'},'method':'PUT','path':'/api/media/1/progress',
                'raw_path':b'/api/media/1/progress','query_string':b'','headers':[(b'content-type',b'application/json')],
                'server':('127.0.0.1',80),'client':('127.0.0.1',10000),'scheme':'http','http_version':'1.1'},receive,send)
            self.assertEqual(reads,1)
            return messages
        with patch.object(m,'database_timing',timing),patch.object(m,'PROFILE_PROGRESS',True):messages=asyncio.run(invoke())
        start=next(row for row in messages if row['type']=='http.response.start');headers=dict(start['headers'])
        self.assertEqual(start['status'],200)
        values=[float(headers[key]) for key in (b'x-avhub-progress-http-ms',b'x-avhub-progress-body-ms',b'x-avhub-progress-dispatch-ms',b'x-avhub-progress-handler-ms')]
        self.assertTrue(all(value>=0 for value in values));self.assertGreaterEqual(values[0]+.01,sum(values[1:]))
        scope=int(headers[b'x-avhub-save-trace']);row=timing.report()['save_trace']['operations'][0]
        self.assertEqual((row['scope_id'],row['transaction_outcome']),(scope,'committed'))
        with m.read_connection() as db:self.assertEqual(db.execute('SELECT progress FROM media WHERE id=1').fetchone()[0],23)

    def test_optional_handler_timing_does_not_change_durable_result(self):
        response=Response()
        with patch.object(m,'PROFILE_PROGRESS',True):
            result=m.save_progress(1,m.ProgressInput(progress=37,updated_at=2000),response)
        self.assertGreaterEqual(float(response.headers['X-AVHub-Progress-Handler-Ms']),0)
        self.assertIn('X-AVHub-Save-Trace',response.headers)
        with m.read_connection() as db:self.assertEqual(db.execute('SELECT progress FROM media WHERE id=1').fetchone()[0],result['progress'])

    def test_failed_commit_has_no_success_header_or_persisted_progress(self):
        timing=DatabaseTiming();response=Response();original=sqlite3.connect
        class Failure(sqlite3.Connection):
            def commit(self):
                time.sleep(.01)  # Injected failure latency, not performance evidence.
                raise sqlite3.OperationalError('owned commit fault')
        def connect(*args,**kwargs):return original(*args,**{**kwargs,'factory':Failure})
        with patch.object(m,'database_timing',timing),patch.object(m.sqlite3,'connect',side_effect=connect):
            with self.assertRaises(sqlite3.OperationalError):m.save_progress(1,m.ProgressInput(progress=99,updated_at=2000),response)
        self.assertNotIn('X-AVHub-Save-Trace',response.headers)
        row=timing.report()['save_trace']['operations'][0]
        self.assertEqual(row['transaction_outcome'],'failed');self.assertGreaterEqual(row['commit'],8)
        self.assertTrue(row['commit_attempted']);self.assertTrue(row['transaction_open_at_commit'])
        self.assertGreater(row['changed_rows'],0)  # Attempted row changes are not durable after failure.
        self.assertNotIn('observed_writer_connection_id',timing.begin_serialized())
        with m.read_connection() as db:self.assertEqual(db.execute('SELECT progress FROM media WHERE id=1').fetchone()[0],0)

    def test_connection_failure_releases_writer_trace(self):
        timing=DatabaseTiming()
        with patch.object(m,'database_timing',timing),patch.object(m.db_anchor,'ensure',side_effect=RuntimeError('owned open fault')):
            with self.assertRaises(RuntimeError):
                with m.connection():pass
        self.assertNotIn('observed_writer_connection_id',timing.begin_serialized())

    def test_progress_wait_correlates_actual_held_scan_transaction(self):
        timing=DatabaseTiming();entered=threading.Event();release=threading.Event();done=threading.Event()
        errors=[];response=Response()
        def hold():
            try:
                with timing.scope('scan-media'),m.connection() as db:
                    db.execute("UPDATE media SET title='owned concurrent edit' WHERE id=1")
                    entered.set();release.wait(3)
            except BaseException as error:errors.append(error);entered.set()
        def save():
            try:m.save_progress(1,m.ProgressInput(progress=37,updated_at=2000),response)
            except BaseException as error:errors.append(error)
            finally:done.set()
        with patch.object(m,'database_timing',timing):
            writer=threading.Thread(target=hold);waiter=threading.Thread(target=save)
            writer.start()
            try:
                self.assertTrue(entered.wait(2));self.assertEqual(errors,[])
                waiter.start();self.assertFalse(done.wait(.15),'Save must really wait for the held writer, not fake success')
            finally:
                release.set();writer.join(4)
                if waiter.ident is not None:waiter.join(4)
        self.assertFalse(writer.is_alive());self.assertFalse(waiter.is_alive());self.assertEqual(errors,[])
        report=timing.report();saved=report['save_trace']['operations'][0]
        self.assertEqual(int(response.headers['X-AVHub-Save-Trace']),saved['scope_id'])
        self.assertEqual(saved['observed_writer_operation'],'scan-media')
        blocker=next(row for row in report['slow_operations'] if row['connection_id']==saved['observed_writer_connection_id'])
        self.assertEqual(blocker['operation'],'scan-media');self.assertGreaterEqual(saved['lock_wait'],100)
        with m.read_connection() as db:self.assertEqual(tuple(db.execute('SELECT progress,title FROM media WHERE id=1').fetchone()),(37,'owned concurrent edit'))
