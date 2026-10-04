"""Bounded ASS/SSA text conversion, never burning subtitles into source video."""
import tempfile
import threading
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

MAX_SUBTITLE_BYTES = 4 * 1024 * 1024
_slots = threading.BoundedSemaphore(2)


def decode_text(data):
    if data.startswith((b'\xff\xfe', b'\xfe\xff')): return data.decode('utf-16')
    try: return data.decode('utf-8-sig')
    except UnicodeDecodeError: return data.decode('gb18030')


def convert_ass(text, cache: Path, ffmpeg, process):
    if len(text.encode('utf-8')) > MAX_SUBTITLE_BYTES:
        raise HTTPException(413, '字幕文件不能超过 4 MB')
    if not _slots.acquire(blocking=False): raise HTTPException(429, '字幕转换繁忙，请稍后重试')
    temporary = None
    try:
        cache.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix='ass-',dir=cache)
        source = Path(temporary.name) / 'source.ass'
        output = Path(temporary.name) / 'subtitle.vtt'
        source.write_text(text,encoding='utf-8')
        code, _, _ = process([ffmpeg,'-hide_banner','-loglevel','error','-nostdin','-y',
                              '-protocol_whitelist','file,pipe','-f','ass','-i',str(source),
                              '-map','0:s:0','-c:s','webvtt','-f','webvtt',str(output)],30)
        if code or not output.is_file() or '-->' not in output.read_text(encoding='utf-8'):
            raise HTTPException(422, 'ASS/SSA 字幕无法转换或没有有效对白，请检查格式')
        return FileResponse(output,media_type='text/vtt; charset=utf-8',background=BackgroundTask(temporary.cleanup))
    except HTTPException:
        if temporary: temporary.cleanup()
        raise
    except Exception as exc:
        if temporary: temporary.cleanup()
        raise HTTPException(422, 'ASS/SSA 字幕转换失败，请检查 FFmpeg 和字幕编码') from exc
    finally:
        _slots.release()
