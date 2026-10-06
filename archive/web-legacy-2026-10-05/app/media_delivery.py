"""Read-only original-file delivery with explicit video types and standard Range handling."""
from pathlib import Path
import mimetypes
import stat
import threading
import anyio
from contextlib import asynccontextmanager
from starlette.datastructures import MutableHeaders
from secrets import token_hex

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response


VIDEO_MEDIA_TYPES = {
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
    ".mkv": "video/x-matroska", ".webm": "video/webm", ".avi": "video/x-msvideo",
    ".ts": "video/mp2t", ".mts": "video/mp2t", ".m2ts": "video/mp2t",
    ".mpg": "video/mpeg", ".mpeg": "video/mpeg", ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
}


class PreparedFragmentResponse(Response):
    """Listen for disconnect even while a short FFmpeg task prepares the body."""
    media_type='video/mp2t'

    def __init__(self, prepare, release):
        super().__init__()
        self.prepare=prepare
        self.release=release

    async def __call__(self, scope, receive, send):
        cancelled=threading.Event()
        reader=None
        failure=None
        response_started=False
        try:
            async with anyio.create_task_group() as group:
                async def disconnected():
                    while True:
                        if (await receive())['type']=='http.disconnect':
                            cancelled.set()
                            group.cancel_scope.cancel()
                            return
                        await anyio.lowlevel.checkpoint()
                group.start_soon(disconnected)
                try:
                    # Do not abandon the worker: it owns a subprocess/temp file
                    # and may be returning a Windows file handle as we cancel.
                    reader,prefix,length=await anyio.to_thread.run_sync(self.prepare,cancelled)
                    if not cancelled.is_set():
                        headers=MutableHeaders({'Content-Type':self.media_type,
                            'Cache-Control':'private, no-cache','Content-Length':str(len(prefix)+length)})
                        timing=getattr(reader,'avhub_timing',None)
                        if timing:
                            headers['Server-Timing']=','.join(f'{name};dur={max(0,timing[key]):.2f}' for name,key in
                                [('queue','queue_ms'),('remux','generation_ms'),('server','server_ms')])
                            headers['X-AVHub-Fragment-Cache']='hit' if timing['cache_hit'] else 'miss'
                        response_started=True
                        await send({'type':'http.response.start','status':200,'headers':headers.raw})
                        if prefix:await send({'type':'http.response.body','body':prefix,'more_body':True})
                        while length:
                            chunk=await anyio.to_thread.run_sync(reader.read,min(1024*1024,length))
                            if not chunk:raise OSError('视频分片读取中断')
                            length-=len(chunk)
                            await send({'type':'http.response.body','body':chunk,'more_body':True})
                        await send({'type':'http.response.body','body':b'','more_body':False})
                except Exception as exc:
                    if not cancelled.is_set():failure=exc
                finally:
                    cancelled.set()
                    group.cancel_scope.cancel()
            # Raise HTTP errors outside TaskGroup so FastAPI retains their
            # status codes instead of wrapping them in an ExceptionGroup.
            if failure is not None:raise failure
            if not response_started:
                # The client has gone, but the ASGI middleware still needs a
                # completed response rather than "No response returned" / 500.
                await Response(status_code=499)(scope,receive,send)
        finally:
            cancelled.set()
            if reader is not None:
                with anyio.CancelScope(shield=True):
                    await anyio.to_thread.run_sync(self.release,reader)


class MediaFileResponse(FileResponse):
    # Keep Starlette's suffix/multipart/If-Range/HEAD behavior. Larger reads reduce
    # threadpool hops for local high-bitrate video without buffering the whole file.
    chunk_size = 1024 * 1024

    @asynccontextmanager
    async def reader(self):
        file=await anyio.open_file(self.path,'rb')
        try:yield file
        finally:
            # FileResponse's unshielded AsyncFile exit can itself be cancelled,
            # leaking a Windows handle after disconnect. Always finish close.
            with anyio.CancelScope(shield=True):await file.aclose()

    async def send_range(self,file,send,start,end):
        await file.seek(start)
        while start<end:
            chunk=await file.read(min(self.chunk_size,end-start))
            if not chunk:raise OSError('视频源读取中断')
            start+=len(chunk)
            await send({'type':'http.response.body','body':chunk,'more_body':True})

    async def _handle_simple(self,send,head,pathsend):
        await send({'type':'http.response.start','status':self.status_code,'headers':self.raw_headers})
        if not head:
            async with self.reader() as file:await self.send_range(file,send,0,self.stat_result.st_size)
        await send({'type':'http.response.body','body':b'','more_body':False})

    async def _handle_single_range(self,send,start,end,file_size,head):
        headers=MutableHeaders(raw=list(self.raw_headers))
        headers['content-range']=f'bytes {start}-{end-1}/{file_size}';headers['content-length']=str(end-start)
        await send({'type':'http.response.start','status':206,'headers':headers.raw})
        if not head:
            async with self.reader() as file:await self.send_range(file,send,start,end)
        await send({'type':'http.response.body','body':b'','more_body':False})

    async def _handle_multiple_ranges(self,send,ranges,file_size,head):
        boundary=token_hex(13);length,generate=self.generate_multipart(ranges,boundary,file_size,self.media_type)
        headers=MutableHeaders(raw=list(self.raw_headers))
        headers['content-type']=f'multipart/byteranges; boundary={boundary}';headers['content-length']=str(length)
        await send({'type':'http.response.start','status':206,'headers':headers.raw})
        if not head:
            async with self.reader() as file:
                for start,end in ranges:
                    await send({'type':'http.response.body','body':generate(start,end),'more_body':True})
                    await self.send_range(file,send,start,end)
                    await send({'type':'http.response.body','body':b'\r\n','more_body':True})
        await send({'type':'http.response.body','body':b'' if head else f'--{boundary}--'.encode(),'more_body':False})

    async def __call__(self, scope, receive, send):
        # FileResponse does not listen for http.disconnect. Uvicorn's send may
        # silently discard bytes after a seek cancels its previous open-ended
        # Range, leaving that reader traversing the entire rest of the movie.
        # Keep Starlette's Range implementation, but retire obsolete readers.
        async with anyio.create_task_group() as group:
            async def disconnected():
                while True:
                    if (await receive())['type'] == 'http.disconnect':
                        group.cancel_scope.cancel()
                        return
                    await anyio.lowlevel.checkpoint()
            group.start_soon(disconnected)
            try:
                await super().__call__(scope, receive, send)
            finally:
                group.cancel_scope.cancel()


def original_file_response(path: str | Path) -> MediaFileResponse:
    source = Path(path)
    try:
        info = source.stat()
    except OSError as exc:
        raise HTTPException(404, "视频文件不存在，请检查磁盘连接") from exc
    if not stat.S_ISREG(info.st_mode):
        raise HTTPException(404, "视频文件不存在")
    media_type = VIDEO_MEDIA_TYPES.get(source.suffix.lower()) or mimetypes.guess_type(str(source))[0] or "application/octet-stream"
    return MediaFileResponse(source, media_type=media_type, stat_result=info,
                             headers={"Cache-Control": "private, no-cache"})
