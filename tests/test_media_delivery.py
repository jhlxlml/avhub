import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException
from app.media_delivery import original_file_response


class MediaDeliveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='avhub-range-')
        self.source = Path(self.temp.name) / 'sample.TS'
        self.data = bytes(range(256)) * 10000
        self.source.write_bytes(self.data)
        self.mtime = self.source.stat().st_mtime_ns

    def tearDown(self):
        self.assertEqual(self.source.read_bytes(), self.data)
        self.assertEqual(self.source.stat().st_mtime_ns, self.mtime)
        self.temp.cleanup()

    async def deliver(self, method='GET', **headers):
        messages = []
        async def send(message): messages.append(message)
        async def receive(): return {'type': 'http.request', 'body': b'', 'more_body': False}
        scope = {'type': 'http', 'method': method, 'headers': [
            (key.replace('_', '-').encode(), value.encode()) for key, value in headers.items()
        ]}
        await original_file_response(self.source)(scope, receive, send)
        start = messages[0]
        body = b''.join(message.get('body', b'') for message in messages[1:])
        return start['status'], dict(start['headers']), body, messages

    async def test_full_delivery_uses_explicit_type_and_bounded_large_reads(self):
        status, headers, body, messages = await self.deliver()
        self.assertEqual(status, 200)
        self.assertEqual(headers[b'content-type'], b'video/mp2t')
        self.assertEqual(headers[b'accept-ranges'], b'bytes')
        self.assertEqual(body, self.data)
        self.assertEqual(len(messages[1]['body']), 1024 * 1024)
        self.assertLessEqual(max(len(message.get('body', b'')) for message in messages), 1024 * 1024)
        for extension, expected in [('.mkv', 'video/x-matroska'), ('.m2ts', 'video/mp2t'), ('.mp4', 'video/mp4')]:
            path = self.source.with_suffix(extension)
            path.write_bytes(b'test')
            self.assertEqual(original_file_response(path).media_type, expected)

    async def test_random_open_ended_suffix_and_head_ranges(self):
        for header, start, end in [('bytes=1000000-2000000', 1000000, 2000000),
                                   ('bytes=2559980-', 2559980, len(self.data) - 1),
                                   ('bytes=-17', len(self.data) - 17, len(self.data) - 1)]:
            status, headers, body, _ = await self.deliver(range=header)
            self.assertEqual(status, 206)
            self.assertEqual(body, self.data[start:end + 1])
            self.assertEqual(headers[b'content-range'], f'bytes {start}-{end}/{len(self.data)}'.encode())
            head_status, head_headers, head_body, _ = await self.deliver(method='HEAD', range=header)
            self.assertEqual(head_status, 206)
            self.assertEqual(head_headers[b'content-length'], headers[b'content-length'])
            self.assertEqual(head_body, b'')
        status, headers, body, _ = await self.deliver(range='bytes=9999999-')
        self.assertEqual(status, 416)
        self.assertEqual(headers[b'content-range'], f'bytes */{len(self.data)}'.encode())
        self.assertEqual(body, b'')

    async def test_if_range_and_multipart_keep_standard_semantics(self):
        _, headers, _, _ = await self.deliver(method='HEAD')
        for validator in [headers[b'etag'].decode(), headers[b'last-modified'].decode()]:
            status, _, body, _ = await self.deliver(range='bytes=10-19', if_range=validator)
            self.assertEqual((status, body), (206, self.data[10:20]))
        status, _, body, _ = await self.deliver(range='bytes=10-19', if_range='"stale"')
        self.assertEqual((status, body), (200, self.data))
        status, headers, body, _ = await self.deliver(range='bytes=10-19,40-49')
        self.assertEqual(status, 206)
        self.assertIn(b'multipart/byteranges', headers[b'content-type'])
        self.assertIn(self.data[10:20], body)
        self.assertIn(self.data[40:50], body)
        self.assertEqual(int(headers[b'content-length']), len(body))

    def test_missing_and_directory_sources_are_rejected(self):
        for path in [self.source.parent, self.source.with_name('absent.mkv')]:
            with self.assertRaises(HTTPException) as error:
                original_file_response(path)
            self.assertEqual(error.exception.status_code, 404)
