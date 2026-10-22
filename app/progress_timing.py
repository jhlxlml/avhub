"""Opt-in HTTP boundary timing; never buffers bodies or delays a response."""
import time


class ProgressTiming:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if (scope['type'] != 'http' or scope.get('method') != 'PUT'
                or not path.startswith('/api/media/') or not path.endswith('/progress')):
            return await self.app(scope, receive, send)
        started = time.perf_counter()
        timing = {'started': started}
        scope['avhub_progress_timing'] = timing

        async def timed_receive():
            message = await receive()
            if (message['type'] == 'http.request' and not message.get('more_body', False)
                    and 'body_ready' not in timing):
                timing['body_ready'] = time.perf_counter()
            return message

        async def timed_send(message):
            if message['type'] == 'http.response.start':
                headers = [*message.get('headers', []),
                    (b'x-avhub-progress-http-ms', f'{(time.perf_counter()-started)*1000:.3f}'.encode('ascii'))]
                body_ready, entered = timing.get('body_ready'), timing.get('handler_entered')
                if body_ready is not None:
                    headers.append((b'x-avhub-progress-body-ms', f'{(body_ready-started)*1000:.3f}'.encode('ascii')))
                if body_ready is not None and entered is not None and entered >= body_ready:
                    headers.append((b'x-avhub-progress-dispatch-ms', f'{(entered-body_ready)*1000:.3f}'.encode('ascii')))
                message = {**message, 'headers': headers}
            await send(message)

        await self.app(scope, timed_receive, timed_send)
