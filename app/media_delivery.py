"""Read-only original-file delivery with explicit video types and standard Range handling."""
from pathlib import Path
import mimetypes
import stat
import anyio
from contextlib import asynccontextmanager
from starlette.datastructures import MutableHeaders
from secrets import token_hex

from fastapi import HTTPException
from fastapi.responses import FileResponse


VIDEO_MEDIA_TYPES = {
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
    ".mkv": "video/x-matroska", ".webm": "video/webm", ".avi": "video/x-msvideo",
    ".ts": "video/mp2t", ".mts": "video/mp2t", ".m2ts": "video/mp2t",
    ".mpg": "video/mpeg", ".mpeg": "video/mpeg", ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
}


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
