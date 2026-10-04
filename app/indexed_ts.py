"""Read-only TS range-backed VOD indexes: random access without restarting MSE."""
from dataclasses import dataclass, field
import hashlib
import json
import math
from pathlib import Path
import threading
import uuid

PACKET = 188
VERSION = 2


class UnsupportedTs(ValueError):
    pass


def fingerprint(source):
    info = source.stat()
    return [str(source.resolve()), info.st_size, info.st_mtime_ns]


def section(packet):
    if len(packet) != PACKET or packet[0] != 0x47 or not packet[1] & 0x40 or packet[1] & 0x80:
        return None
    control = (packet[3] >> 4) & 3
    if control not in (1, 3): return None
    offset = 4 if control == 1 else 5 + packet[4]
    if offset >= PACKET: return None
    offset += 1 + packet[offset]
    if offset >= PACKET: return None
    return packet[offset:]


def pmt_pid(packet):
    data = section(packet)
    if not data or len(data) < 12 or data[0] != 0: return None
    end = 3 + (((data[1] & 15) << 8) | data[2]) - 4
    if end > len(data): return None
    programs = [((data[i + 2] & 31) << 8) | data[i + 3]
                for i in range(8, end, 4) if i + 3 < end and (data[i] or data[i + 1])]
    if len(programs) != 1: raise UnsupportedTs('TS 需要单节目 PAT')
    return programs[0]


def initialization(reader):
    # Some recordings emit PAT/PMT only at the start, not before every GOP.
    # Prepend these original PSI packets to each virtual segment. Encoded
    # video/audio packets are copied unchanged and need no FFmpeg per seek.
    reader.seek(0)
    raw = reader.read(64 * 1024 // PACKET * PACKET)
    packets = [raw[i:i + PACKET] for i in range(0, len(raw), PACKET)]
    for i in range(len(packets)):
        packet = packets[i]
        if len(packet) != PACKET or packet[0] != 0x47: raise UnsupportedTs('TS 包未对齐')
        pid = ((packet[1] & 31) << 8) | packet[2]
        if pid != 0: continue
        program = pmt_pid(packet)
        if program is None: continue
        for candidate in packets[i + 1:]:
            if (((candidate[1] & 31) << 8) | candidate[2]) == program:
                data = section(candidate)
                if data and data[0] == 2: return packet + candidate
    raise UnsupportedTs('缺少 PAT/PMT，使用兼容封装')


def validate(data, stamp):
    if data.get('version') != VERSION or data.get('source') != stamp: raise UnsupportedTs('索引已失效')
    duration = data['duration']
    fragments = data['fragments']
    headers = bytes.fromhex(data['headers'])
    if len(headers) != 2 * PACKET or headers[0] != 0x47 or headers[PACKET] != 0x47:
        raise UnsupportedTs('TS 初始化包无效')
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0 or not fragments:
        raise UnsupportedTs('索引无有效片长')
    previous_time = -1
    previous_end = 0
    expected_time = 0.
    for start, length, position, seconds in fragments:
        if (not isinstance(start, (int, float)) or not math.isfinite(start) or start <= previous_time or
                not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= 0 or
                type(length) is not int or type(position) is not int or length <= 0 or
                abs(start-expected_time) > .001 or position != previous_end or position % PACKET or length % PACKET or position + length > stamp[1]):
            raise UnsupportedTs('索引范围无效')
        previous_time = start
        previous_end = position + length
        expected_time = start + seconds
    if fragments[0][0] != 0 or abs(fragments[-1][0] + fragments[-1][3] - duration) > .001:
        raise UnsupportedTs('索引时间轴无效')
    return data


def build_index(source, cache, ffprobe, run, cancelled):
    stamp = fingerprint(source)
    if stamp[1] < PACKET or stamp[1] % PACKET: raise UnsupportedTs('仅索引完整 188 字节 TS')
    digest = hashlib.sha256(json.dumps(stamp, ensure_ascii=False).encode()).hexdigest()
    destination = cache / f'{digest}.json'
    safe_cache=not cache.is_symlink() and cache.resolve()==cache.parent.resolve()/cache.name
    try:
        if safe_cache and not destination.is_symlink() and destination.stat().st_size <= 8 * 1024**2:
            return validate(json.loads(destination.read_text(encoding='utf-8')), stamp)
    except (OSError, ValueError, KeyError, TypeError): pass
    if cancelled.is_set(): raise UnsupportedTs('已取消 TS 索引')
    code, output, _ = run([ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_packets',
                          '-show_entries', 'packet=pts_time,pos,flags:format=start_time,duration',
                          '-of', 'json', str(source)], 30, cancelled)
    if code or len(output) > 64 * 1024**2: raise UnsupportedTs('无法构建 TS 索引')
    probe = json.loads(output)
    origin = float(probe.get('format', {}).get('start_time', 0))
    duration = float(probe.get('format', {}).get('duration', 0))
    if not math.isfinite(origin) or not math.isfinite(duration) or duration <= 0: raise UnsupportedTs('TS 时间轴无效')
    points = [(0., 0)]
    previous_pts = -math.inf
    first_key_seen = False
    with source.open('rb') as reader:
        headers = initialization(reader).hex()
        for packet in probe.get('packets', []):
            if cancelled.is_set(): raise UnsupportedTs('已取消 TS 索引')
            if 'K' not in packet.get('flags', ''): continue
            pts = float(packet['pts_time']) - origin
            position = int(packet['pos'])
            if not math.isfinite(pts) or pts <= previous_pts or position < 0 or position % PACKET:
                raise UnsupportedTs('TS 有时间戳跳变或无有效关键帧位置')
            previous_pts = pts
            # The first keyframe belongs to segment zero, including its original
            # stream tables/audio preamble. Later ranges start at a full key PES.
            if not first_key_seen:
                if pts < -.5 or pts >= 1.5: raise UnsupportedTs('TS 首关键帧偏离起点')
                first_key_seen = True
                continue
            cut = position
            if pts - points[-1][0] < 1.9 or pts >= duration or cut <= points[-1][1]: continue
            points.append((pts, cut))
    if previous_pts == -math.inf: raise UnsupportedTs('TS 缺少关键帧')
    if fingerprint(source) != stamp: raise UnsupportedTs('索引期间视频发生变更')
    fragments = [[start, (points[i + 1][1] if i + 1 < len(points) else stamp[1]) - position,
                  position, (points[i + 1][0] if i + 1 < len(points) else duration) - start]
                 for i, (start, position) in enumerate(points)]
    data = validate({'version': VERSION, 'source': stamp, 'duration': duration,
                     'headers':headers, 'fragments': fragments}, stamp)
    if cancelled.is_set(): raise UnsupportedTs('已取消 TS 索引')
    if not safe_cache or destination.is_symlink():return data
    # A read-only cache disk need not prevent playback; retain the in-memory index.
    temporary = cache / f'{digest}.{uuid.uuid4().hex}.tmp'
    try:
        cache.mkdir(parents=True, exist_ok=True)
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        temporary.replace(destination)
    except OSError: pass
    finally:
        try: temporary.unlink(missing_ok=True)
        except OSError: pass
    return data


@dataclass
class IndexedTs:
    source: Path
    cancelled: threading.Event = field(default_factory=threading.Event)
    data: dict | None = None

    def manifest(self):
        if self.data is None: raise UnsupportedTs('TS 索引尚未完成')
        fragments = self.data['fragments']
        lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-PLAYLIST-TYPE:VOD',
                 f'#EXT-X-TARGETDURATION:{math.ceil(max(f[3] for f in fragments))}', '#EXT-X-MEDIA-SEQUENCE:0']
        for i, (_, length, position, seconds) in enumerate(fragments):
            lines.extend([f'#EXTINF:{seconds:.6f},', f'segment_{i:06d}.ts'])
        lines.append('#EXT-X-ENDLIST')
        return ('\n'.join(lines) + '\n').encode()
