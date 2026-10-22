import asyncio
import unittest
from unittest.mock import patch
from app.progress_timing import ProgressTiming


class ProgressTimingTests(unittest.TestCase):
    def test_headers_only_and_original_body_and_input_preserved(self):
        messages=[]
        async def receive():return {'type':'http.request','body':b'owned input'}
        async def send(message):messages.append(message)
        async def app(scope, incoming, outgoing):
            self.assertEqual((await incoming())['body'],b'owned input')
            scope['avhub_progress_timing']['handler_entered']=1.006
            await outgoing({'type':'http.response.start','status':200,'headers':[(b'existing',b'yes')]})
            await outgoing({'type':'http.response.body','body':b'owned response'})
        with patch('app.progress_timing.time.perf_counter',side_effect=[1,1.002,1.01]):
            asyncio.run(ProgressTiming(app)({'type':'http','method':'PUT','path':'/api/media/1/progress'},receive,send))
        self.assertEqual(dict(messages[0]['headers']),{b'existing':b'yes',b'x-avhub-progress-http-ms':b'10.000',b'x-avhub-progress-body-ms':b'2.000',b'x-avhub-progress-dispatch-ms':b'4.000'})
        self.assertEqual(messages[1],{'type':'http.response.body','body':b'owned response'})

    def test_chunked_body_marks_only_completion_and_no_handler_means_no_dispatch(self):
        chunks=[{'type':'http.request','body':b'a','more_body':True},{'type':'http.request','body':b'b','more_body':False}]
        messages=[]
        async def receive():return chunks.pop(0)
        async def send(message):messages.append(message)
        async def app(scope,incoming,outgoing):
            self.assertEqual((await incoming())['body'],b'a')
            self.assertNotIn('body_ready',scope['avhub_progress_timing'])
            self.assertEqual((await incoming())['body'],b'b')
            await outgoing({'type':'http.response.start','status':422,'headers':[]})
        with patch('app.progress_timing.time.perf_counter',side_effect=[1,1.005,1.008]):
            asyncio.run(ProgressTiming(app)({'type':'http','method':'PUT','path':'/api/media/1/progress'},receive,send))
        headers=dict(messages[0]['headers'])
        self.assertEqual(headers[b'x-avhub-progress-body-ms'],b'5.000')
        self.assertNotIn(b'x-avhub-progress-dispatch-ms',headers)

    def test_unread_body_has_no_fabricated_body_or_dispatch_timing(self):
        messages=[]
        async def app(scope,receive,send):await send({'type':'http.response.start','status':403,'headers':[]})
        async def send(message):messages.append(message)
        with patch('app.progress_timing.time.perf_counter',side_effect=[1,1.01]):
            asyncio.run(ProgressTiming(app)({'type':'http','method':'PUT','path':'/api/media/1/progress'},None,send))
        self.assertEqual(dict(messages[0]['headers']),{b'x-avhub-progress-http-ms':b'10.000'})

    def test_other_routes_do_not_read_clock_and_failures_propagate(self):
        async def app(*args):raise RuntimeError('owned failure')
        for scope in ({'type':'lifespan'},{'type':'http','method':'GET','path':'/api/media'}):
            with patch('app.progress_timing.time.perf_counter',side_effect=AssertionError('unrelated clock')):
                with self.assertRaisesRegex(RuntimeError,'owned failure'):
                    asyncio.run(ProgressTiming(app)(scope,None,None))
