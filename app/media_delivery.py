"""Read-only original-file delivery with explicit video types and standard Range handling."""
from pathlib import Path
import mimetypes
import stat

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
