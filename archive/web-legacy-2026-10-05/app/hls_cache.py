"""HLS snapshot parsing and rolling retention. No source-file operations."""
from dataclasses import dataclass
import re
import math


@dataclass(frozen=True)
class Fragment:
    name: str
    start: float
    end: float
    lines: tuple[str, ...]


def parse_manifest(content: bytes) -> tuple[list[str], list[Fragment], list[str]]:
    headers, fragments, pending, tail = [], [], [], []
    position = 0.0
    for line in content.decode('utf-8').splitlines():
        if line.startswith('#EXTINF:'):
            pending.append(line)
        elif re.fullmatch(r'segment_\d+\.ts', line):
            duration = next((float(item.split(':', 1)[1].split(',')[0]) for item in pending if item.startswith('#EXTINF:')), None)
            if duration is None or not math.isfinite(duration) or duration <= 0:
                raise ValueError('Invalid segment duration')
            fragments.append(Fragment(line, position, position + duration, tuple([*pending, line])))
            position += duration
            pending = []
        elif line == '#EXT-X-ENDLIST':
            tail.append(line)
        elif line.startswith(('#EXT-X-DISCONTINUITY', '#EXT-X-PROGRAM-DATE-TIME', '#EXT-X-BYTERANGE')) and not line.startswith('#EXT-X-DISCONTINUITY-SEQUENCE'):
            pending.append(line)
        elif pending:
            pending.append(line)
        else:
            headers.append(line)
    return headers, fragments, tail


def window_manifest(content: bytes, first_sequence: int) -> bytes:
    if first_sequence == 0:
        return content
    headers, fragments, tail = parse_manifest(content)
    removed = fragments[:first_sequence]
    sequence = next((int(line.split(':')[1]) for line in headers if line.startswith('#EXT-X-MEDIA-SEQUENCE:')), 0)
    discontinuities = sum(line == '#EXT-X-DISCONTINUITY' for part in removed for line in part.lines)
    original_discontinuities = next((int(line.split(':')[1]) for line in headers if line.startswith('#EXT-X-DISCONTINUITY-SEQUENCE:')), 0)
    headers = [line for line in headers if not line.startswith(('#EXT-X-MEDIA-SEQUENCE:', '#EXT-X-PLAYLIST-TYPE:', '#EXT-X-DISCONTINUITY-SEQUENCE:'))]
    headers += [f'#EXT-X-MEDIA-SEQUENCE:{sequence + first_sequence}', f'#EXT-X-DISCONTINUITY-SEQUENCE:{original_discontinuities + discontinuities}']
    return ('\n'.join([*headers, *(line for part in fragments[first_sequence:] for line in part.lines), *tail]) + '\n').encode('utf-8')
