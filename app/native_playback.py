"""Desktop-only read leases: held until the owned native process has exited.

Unlike expiring activity heartbeats, these prevent rename/recycle/restore even
while the renderer is suspended. No video copies or source writes.
"""
from fastapi import HTTPException
import time
import json
from .video_color import color_metadata


def probe_original_color(source,run,ffprobe):
    """Bounded header/packet probe for old indexes, never a full-file index build."""
    try:
        code,output,_=run([ffprobe,'-v','error','-analyzeduration','2000000','-probesize','2097152','-select_streams','v:0','-read_intervals','%+#32','-show_streams','-of','json',str(source)],5)
        streams=json.loads(output).get('streams',[]) if code==0 else []
        color=color_metadata(streams[0]) if streams else {}
        if color.get('verified') and color.get('pix_fmt'):return color
    except (TimeoutError,ValueError,IndexError,TypeError):pass
    raise HTTPException(422,'未能在原生起播期限内验证色彩与位深，请使用现有原画链路；不会假定为 SDR 或降位深')


def verify_original_color(color):
    if not isinstance(color,dict) or color.get('verified') is not True or not color.get('pix_fmt') or type(color.get('bit_depth')) is not int or color['bit_depth']<1:
        raise HTTPException(422,'视频色彩与位深信息尚未验证，暂不能进入原生试用；请使用现有原画链路')
    if color.get('hdr') or color.get('dynamic_hdr') or color.get('transfer') in ('smpte2084','arib-std-b67'):
        raise HTTPException(422,'此 HDR 视频尚未完成原生色彩验收，请使用现有原画链路；不会自动映射为 SDR')
    if color['bit_depth']>8:
        raise HTTPException(422,'此高位深视频尚未完成原生显示验收，请使用现有原画链路；不会自动降为 8-bit')


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
