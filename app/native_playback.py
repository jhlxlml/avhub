"""Desktop-only read leases: held until the owned native process has exited.

Unlike expiring activity heartbeats, these prevent rename/recycle/restore even
while the renderer is suspended. No video copies or source writes.
"""
from fastapi import HTTPException
import time
import json
from .video_color import color_metadata
import math


def render_source_contract(probe):
    """Describe the source, not an encoder/pixel-format acceptance whitelist."""
    from fractions import Fraction
    streams = probe.get('streams') or []
    if not streams:
        raise ValueError('missing video stream')
    stream = dict(streams[0])
    frame = next((f for f in probe.get('frames', []) if f.get('media_type') == 'video'), {})
    # Decoded frame metadata is authoritative when the container differs.
    for key in ('width', 'height', 'pix_fmt', 'color_primaries', 'color_transfer', 'color_space', 'color_range'):
        if frame.get(key) not in (None, '', 'unknown'):
            stream[key] = frame[key]
    stream['side_data_list'] = stream.get('side_data_list', []) + frame.get('side_data_list', [])
    color = color_metadata(stream)
    width, height = stream.get('width'), stream.get('height')
    if any(type(v) is not int or v < 1 for v in (width, height)):
        raise ValueError('invalid original dimensions')
    aspect = stream.get('sample_aspect_ratio')
    ratio = Fraction(aspect.replace(':', '/')) if aspect not in (None, '', 'N/A', '0:1') else Fraction(1)
    if ratio <= 0:
        raise ValueError('invalid pixel aspect ratio')
    output_width = math.ceil(width * ratio) if ratio >= 1 else width
    output_height = math.ceil(height / ratio) if ratio < 1 else height
    rotations = [s['rotation'] for s in stream['side_data_list'] if 'rotation' in s]
    rotation = float(rotations[-1] if rotations else stream.get('tags', {}).get('rotate', 0))
    if not math.isfinite(rotation):
        raise ValueError('invalid rotation')
    angle = math.radians(rotation)
    # Preserve the full rotated picture, expanding rather than shrinking it.
    output_width, output_height = (math.ceil(round(abs(output_width * math.cos(angle)) + abs(output_height * math.sin(angle)), 8)),
                                   math.ceil(round(abs(output_width * math.sin(angle)) + abs(output_height * math.cos(angle)), 8)))
    # This is the actual D3D11 2D texture dimension limit, not a media whitelist.
    if max(output_width, output_height) > 16384:
        raise ValueError('D3D11 texture dimensions exceeded')
    return {'width': output_width, 'height': output_height, 'sourceWidth': width, 'sourceHeight': height,
            'depth': color['bit_depth'], **{key: color[key] for key in ('primaries', 'transfer', 'matrix', 'range')},
            'hdr': bool(color['hdr'] or color['dynamic_hdr'])}


def probe_render_source(source, run, ffprobe):
    """Bounded read-only geometry probe; MPV owns codec and color interpretation."""
    try:
        code, output, _ = run([ffprobe, '-v', 'error', '-analyzeduration', '2000000',
                              '-probesize', '2097152', '-select_streams', 'v:0', '-read_intervals', '%+#32',
                              '-show_streams', '-of', 'json', str(source)], 5)
        if code != 0 or len(output) > 2 * 1024**2:
            raise ValueError('source probe failed or exceeded bound')
        return render_source_contract(json.loads(output))
    except (TimeoutError, ValueError, KeyError, IndexError, TypeError, OverflowError, ZeroDivisionError) as error:
        reason = {
            'missing video stream': '未读取到视频流',
            'source probe failed or exceeded bound': '未能在读取限制内完成视频探测',
            'invalid original dimensions': '未读取到有效画面尺寸',
            'invalid pixel aspect ratio': '像素比例无效',
            'invalid rotation': '旋转信息无效',
            'D3D11 texture dimensions exceeded': '完整画面超过 D3D11 单张纹理尺寸上限',
        }.get(str(error), '探测超时' if isinstance(error, TimeoutError) else '视频信息无法读取')
        raise HTTPException(422, '当前嵌入播放路径不可用：' + reason + '。可切换其他原画播放路径；不会自动转码或降低画质')



class NativeReadLeases:
    def __init__(self, service):
        self.service = service
        self.leases = {}
        self.retired = {}

    def acquire(self, owner, media_id, resolve):
        with self.service.lock:
            now=time.monotonic()
            self.retired={key:expiry for key,expiry in self.retired.items() if expiry>now}
            if owner in self.retired:
                raise HTTPException(409,'原生播放启动已取消')
            if self.leases:
                raise HTTPException(409, '请先关闭当前原生播放器')
            context = self.service.reader(media_id)
            context.__enter__()
            try:
                source = resolve(media_id)
            except BaseException:
                context.__exit__(None, None, None)
                raise
            self.leases[owner] = context
            return source

    def release(self, owner):
        with self.service.lock:
            now=time.monotonic()
            self.retired={key:expiry for key,expiry in self.retired.items() if expiry>now}
            # A timed-out desktop acquisition can finish after its cancellation
            # request. Remember cancellation so it cannot leave a late lease.
            self.retired[owner]=now+120
            context = self.leases.pop(owner, None)
            if context is not None:
                context.__exit__(None, None, None)
