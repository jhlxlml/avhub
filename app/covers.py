"""Local JPEG/PNG cover imports. Cache-owned files only; videos stay read-only."""
import json
import re
import time
import uuid
from pathlib import Path
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

MAX_BYTES=8*1024**2
MAX_PIXELS=20000000


def cleanup(path):
    try:path.unlink(missing_ok=True)
    except OSError:pass


def owned_path(data,relative):
    if not isinstance(relative,str) or not re.fullmatch(r'covers/[a-f0-9]{32}\.jpg',relative):return None
    path=data/relative
    return path if path.resolve().parent==(data/'covers').resolve() and path.parent.resolve().parent==data.resolve() else None


def discard(db,data,relative):
    if not relative or db.execute('SELECT 1 FROM media WHERE custom_cover=? LIMIT 1',(relative,)).fetchone():return
    path=owned_path(data,relative)
    if path:
        try:path.unlink(missing_ok=True)
        except OSError:pass  # An active reader must not turn a successful edit into failure.


def publish(uploaded,data,media_id,connection,ffmpeg,ffprobe,runner,convert):
    identity=uuid.uuid4().hex
    output=data/'covers'/f'{identity}.jpg'
    temporary=output.with_suffix('.pending.jpg')
    committed=False
    try:
        _,result,_=runner([ffprobe,'-v','error','-show_streams','-of','json',str(uploaded)],8)
        streams=json.loads(result).get('streams',[])
        image=next((s for s in streams if s.get('codec_type')=='video'),{})
        width,height=image.get('width',0),image.get('height',0)
        if image.get('codec_name') not in ('mjpeg','png') or width<=0 or height<=0 or width*height>MAX_PIXELS:
            raise HTTPException(422,'请选择有效的 JPEG/PNG 图片，最多 2000 万像素')
        runner([ffmpeg,'-v','error','-nostdin','-y','-max_pixels',str(MAX_PIXELS),'-i',str(uploaded),
            '-frames:v','1','-vf',"scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease",'-q:v','3',str(temporary)],15)
        if not temporary.is_file() or temporary.stat().st_size<4:raise HTTPException(422,'封面图片无法解码')
        temporary.replace(output)
        with connection() as db:
            row=db.execute('SELECT custom_cover FROM media WHERE id=?',(media_id,)).fetchone()
            if not row:raise HTTPException(404,'视频索引已不存在')
            old=row['custom_cover']
            db.execute('UPDATE media SET custom_cover=?,updated_at=? WHERE id=?',(f'covers/{identity}.jpg',time.time(),media_id))
            value=convert(db.execute('SELECT m.*,g.title AS series_title FROM media m LEFT JOIN series_groups g ON g.id=m.series_id WHERE m.id=?',(media_id,)).fetchone())
        committed=True
        with connection() as db:discard(db,data,old)
        return value
    except HTTPException:raise
    except Exception as exc:raise HTTPException(422,'封面导入失败，请确认图片可读取且缓存磁盘可写') from exc
    finally:
        cleanup(temporary)
        if not committed:cleanup(output)


async def upload(request,data,media_id,connection,ffmpeg,ffprobe,runner,convert):
    with connection() as db:
        if not db.execute('SELECT 1 FROM media WHERE id=?',(media_id,)).fetchone():raise HTTPException(404,'视频不存在')
    parent=data/'covers'
    try:parent.mkdir(parents=True,exist_ok=True)
    except OSError as exc:raise HTTPException(503,'封面缓存目录不可写，请检查磁盘或应用目录权限') from exc
    source=parent/f'.upload-{uuid.uuid4().hex}'
    try:
        total=0;prefix=b''
        with source.open('xb') as file:
            async for chunk in request.stream():
                total+=len(chunk)
                if total>MAX_BYTES:raise HTTPException(413,'封面图片不能超过 8 MB')
                if len(prefix)<8:prefix=(prefix+chunk)[:8]
                file.write(chunk)
        if not prefix.startswith(b'\xff\xd8\xff') and prefix!=b'\x89PNG\r\n\x1a\n':raise HTTPException(422,'封面仅支持 JPEG/PNG，不支持 SVG、网页或远程链接')
        return await run_in_threadpool(publish,source,data,media_id,connection,ffmpeg,ffprobe,runner,convert)
    except OSError as exc:raise HTTPException(503,'封面缓存目录不可写，请检查磁盘或应用目录权限') from exc
    finally:cleanup(source)


def reset(data,media_id,connection,convert):
    with connection() as db:
        row=db.execute('SELECT custom_cover FROM media WHERE id=?',(media_id,)).fetchone()
        if not row:raise HTTPException(404,'视频不存在')
        db.execute('UPDATE media SET custom_cover=NULL,updated_at=? WHERE id=?',(time.time(),media_id))
        value=convert(db.execute('SELECT m.*,g.title AS series_title FROM media m LEFT JOIN series_groups g ON g.id=m.series_id WHERE m.id=?',(media_id,)).fetchone())
    with connection() as db:discard(db,data,row['custom_cover'])
    return value
