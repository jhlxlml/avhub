"""User-requested decoded PNG frames, not thumbnails or source video edits."""
import json
import re
import shutil
import struct
import threading
import time
import uuid
import zlib
from datetime import datetime
from pathlib import Path
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from .preferences import validate

MAX_BYTES=128*1024**2
MAX_PIXELS=64*1024**2
DEFAULT={'directory':'','shortcut':'C'}


def preferences(connection):
    with connection() as db:row=db.execute("SELECT value FROM preferences WHERE key='screenshots'").fetchone()
    try:return validate('screenshots',json.loads(row[0])) if row else dict(DEFAULT)
    except (HTTPException,ValueError,TypeError):return dict(DEFAULT)


def destination(data,settings,create=False):
    directory=Path(settings['directory']) if settings['directory'] else data/'screenshots'
    try:
        if not settings['directory'] and directory.resolve()!=data.resolve()/'screenshots':
            raise HTTPException(503,'默认截图目录含外部链接，请在设置中重新选择目录')
        if create and not settings['directory']:directory.mkdir(exist_ok=True)
        if settings['directory'] and not directory.is_dir():raise HTTPException(503,'截图保存目录已离线或不存在，请在设置中重新选择；未改存到其他目录')
        return directory.resolve()
    except OSError as exc:raise HTTPException(503,'无法访问截图目录，请检查磁盘和权限') from exc


def settings_info(data,connection):
    settings=preferences(connection)
    try:
        directory=destination(data,settings)
        available=directory.is_dir() or not settings['directory'];warning=''
    except HTTPException as exc:
        directory=Path(settings['directory']) if settings['directory'] else data/'screenshots'
        available=False;warning=exc.detail
    return {**settings,'effective_directory':str(directory),'default_directory':str(data/'screenshots'),'available':available,'warning':warning}


def validate_png(path):
    """Check streamed chunks/CRC and bounded inflation, without resizing/re-encoding."""
    try:
        with path.open('rb') as image:
            if image.read(8)!=b'\x89PNG\r\n\x1a\n':raise ValueError()
            width=height=expected=inflated=0;decoder=None;seen_idat=False;ended_idat=False
            while True:
                header=image.read(8)
                if len(header)!=8:raise ValueError()
                length,kind=struct.unpack('>I4s',header)
                if kind==b'IEND' and length:raise ValueError()
                if length>MAX_BYTES or kind not in (b'IHDR',b'IDAT',b'IEND',b'sRGB',b'gAMA',b'cHRM',b'pHYs'):raise ValueError()
                if not width and kind!=b'IHDR':raise ValueError()
                if kind!=b'IDAT' and seen_idat:ended_idat=True
                if kind==b'IHDR':
                    if width or length!=13:raise ValueError()
                    content=image.read(13);width,height,depth,color,compression,filtering,interlace=struct.unpack('>IIBBBBB',content)
                    if not width or not height or width*height>MAX_PIXELS or depth!=8 or color not in (2,6) or compression or filtering or interlace:raise ValueError()
                    expected=height*(1+width*(3 if color==2 else 4));decoder=zlib.decompressobj();crc=zlib.crc32(content,zlib.crc32(kind));length=0
                else:
                    if kind==b'IDAT':
                        if ended_idat:raise ValueError()
                        seen_idat=True
                    elif length>32:raise ValueError()
                    crc=zlib.crc32(kind)
                while length:
                    block=image.read(min(length,1024*1024))
                    if not block:raise ValueError()
                    length-=len(block);crc=zlib.crc32(block,crc)
                    if kind==b'IDAT':
                        pending=block
                        while pending:
                            output=decoder.decompress(pending,min(1024*1024,expected-inflated+1));inflated+=len(output)
                            if inflated>expected or decoder.unused_data:raise ValueError()
                            pending=decoder.unconsumed_tail
                if image.read(4)!=struct.pack('>I',crc&0xffffffff):raise ValueError()
                if kind==b'IEND':
                    if not seen_idat or not decoder.eof or inflated!=expected or image.read(1):raise ValueError()
                    return width,height
    except (ValueError,struct.error,zlib.error) as exc:raise HTTPException(422,'截图 PNG 损坏、格式不支持或超过 6400 万像素；未保存图片') from exc


class ScreenshotStore:
    def __init__(self):self.lock=threading.RLock();self.slots=threading.BoundedSemaphore(2);self.running={};self.saved={}

    def prune(self):
        # Metadata only. User screenshots are NEVER deleted when records expire.
        now=time.monotonic()
        self.saved={key:value for key,value in self.saved.items() if now-value['created']<3600}
        while len(self.saved)>100:self.saved.pop(next(iter(self.saved)))

    def lookup(self,identity):
        with self.lock:
            self.prune()
            if identity in self.running:raise HTTPException(409,'截图仍在保存，请稍后重新检查')
            item=self.saved.get(identity)
            if not item:raise HTTPException(404,'未找到已完成的截图记录，请查看保存目录；记录最多保留一小时')
        path=Path(item['path'])
        if path.is_symlink() or path.resolve()!=Path(item['directory'])/item['filename'] or not path.is_file():raise HTTPException(404,'截图已移动或不可访问')
        return {key:value for key,value in item.items() if key!='created'}

    async def upload(self,request,data,connection,media_id,point,identity):
        if request.headers.get('content-type','').split(';')[0].strip().lower()!='image/png':raise HTTPException(415,'截图仅接受 PNG 图片')
        with self.lock:
            self.prune()
            if identity in self.saved:
                item=self.saved[identity]
                if item['media_id']!=media_id or item['time']!=point:raise HTTPException(409,'截图标识已使用，请重新截图')
                return self.lookup(identity)
            if identity in self.running or not self.slots.acquire(blocking=False):raise HTTPException(409,'正在保存截图，请稍后再试')
            self.running[identity]=True
        temporary=None
        try:
            def metadata():
                with connection() as db:row=db.execute('SELECT title FROM media WHERE id=?',(media_id,)).fetchone()
                return row,preferences(connection)
            row,settings=await run_in_threadpool(metadata)
            if not row:raise HTTPException(404,'视频索引不存在')
            directory=await run_in_threadpool(destination,data,settings,True)
            parent=data/'screenshot-staging'
            if parent.resolve()!=data.resolve()/'screenshot-staging':raise HTTPException(503,'截图暂存目录含外部链接，已停止保存')
            parent.mkdir(exist_ok=True);temporary=parent/f'{uuid.uuid4().hex}.pending'
            total=0
            with temporary.open('xb') as output:
                async for chunk in request.stream():
                    total+=len(chunk)
                    if total>MAX_BYTES:raise HTTPException(413,'截图不能超过 128 MB，未保存图片')
                    # A slow screenshot target/staging disk must not block the
                    # API event loop that also serves playback/progress requests.
                    await run_in_threadpool(output.write,chunk)
            result=await run_in_threadpool(self.publish,temporary,directory,row[0],media_id,point,identity)
            with self.lock:self.saved[identity]={**result,'created':time.monotonic()};self.prune()
            return result
        except OSError as exc:raise HTTPException(503,'截图保存失败，请检查目录权限、剩余空间或网络磁盘；未改存到其他目录') from exc
        finally:
            if temporary:
                try:temporary.unlink(missing_ok=True)
                except OSError:pass
            with self.lock:self.running.pop(identity,None)
            self.slots.release()

    def publish(self,temporary,directory,title,media_id,point,identity):
        width,height=validate_png(temporary)
        name=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',title or f'video-{media_id}').strip(' .')[:70] or f'video-{media_id}'
        ms=round(point*1000);clock=f'{ms//3600000:02d}-{ms//60000%60:02d}-{ms//1000%60:02d}.{ms%1000:03d}'
        filename=f'AVHub_{name}_{clock}_{datetime.now():%Y%m%d-%H%M%S-%f}_{identity[:8]}.png'
        target=directory/filename;created=False
        try:
            # Exclusive create: never overwrite a photo, another capture or video.
            with target.open('xb') as output:
                created=True
                with temporary.open('rb') as source:shutil.copyfileobj(source,output,1024*1024)
            return {'id':identity,'media_id':media_id,'time':point,'filename':filename,'path':str(target),'directory':str(directory),'width':width,'height':height,'bytes':target.stat().st_size}
        except BaseException:
            if created:
                try:target.unlink(missing_ok=True)
                except OSError:pass
            raise
