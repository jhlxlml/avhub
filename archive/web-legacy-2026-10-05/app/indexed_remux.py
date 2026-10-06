"""Keyframe-indexed, on-demand lossless H.264 VOD fragments for other containers."""
from dataclasses import dataclass, field
import hashlib
import json
import math
from pathlib import Path
import threading
import time
import uuid
from collections import OrderedDict

from .indexed_ts import IndexedTs, fingerprint

VERSION=3


class FragmentCancellation:
    """A disconnected request cancels its work, not the whole playback session."""
    def __init__(self, session, request):
        self.session=session
        self.request=request

    poll_interval=.05

    def is_set(self):
        return self.session.is_set() or (self.request is not None and self.request.is_set())

    def wait(self,timeout=None):
        deadline=None if timeout is None else time.monotonic()+timeout
        while not self.is_set():
            remaining=self.poll_interval if deadline is None else min(self.poll_interval,deadline-time.monotonic())
            if remaining<=0:return self.is_set()
            self.session.wait(remaining)
        return True


def validate(data,stamp):
    if data.get('version')!=VERSION or data.get('source')!=stamp:raise ValueError('封装索引已失效')
    duration=data['duration'];fragments=data['fragments'];expected=0.
    if not isinstance(duration,(float,int)) or not math.isfinite(duration) or not 0<duration<86400 or not fragments:
        raise ValueError('无效封装时间轴')
    previous=-math.inf
    epoch=fragments[0][2]
    for start,dts,origin,seconds in fragments:
        if (not all(isinstance(x,(float,int)) and math.isfinite(x) for x in (start,dts,origin,seconds)) or
                origin!=epoch or dts<=previous or abs(start-expected)>.001 or seconds<=0 or dts>start+origin+.1 or start+origin-dts>5):
            raise ValueError('无效关键帧区间')
        expected=start+seconds
        previous=dts
    if abs(expected-duration)>.001 or len(fragments)>50000:raise ValueError('不完整封装时间轴')
    if 'first_pts' in data and (not isinstance(data['first_pts'],(int,float)) or not math.isfinite(data['first_pts']) or not -.5<=data['first_pts']<1.5):
        raise ValueError('无效首视频时间戳')
    return data


def build_remux_index(source,cache,ffprobe,run,cancelled):
    stamp=fingerprint(source)
    digest=hashlib.sha256(json.dumps(stamp,ensure_ascii=False).encode()).hexdigest()
    destination=cache/f'{digest}.json'
    safe=not cache.is_symlink() and cache.resolve()==cache.parent.resolve()/cache.name
    try:
        if safe and not destination.is_symlink() and destination.stat().st_size<=8*1024**2:
            return validate(json.loads(destination.read_text(encoding='utf-8')),stamp)
    except (OSError,ValueError,KeyError,TypeError):pass
    if cancelled.is_set():raise ValueError('已取消封装索引')
    code,raw,_=run([ffprobe,'-v','error','-fflags','+genpts','-select_streams','v:0','-show_packets',
        '-show_entries','packet=pts_time,dts_time,flags:format=start_time,duration','-of','json',str(source)],30,cancelled)
    if code or len(raw)>64*1024**2:raise ValueError('无法探测关键帧')
    probe=json.loads(raw);origin=float(probe.get('format',{}).get('start_time',0));duration=float(probe.get('format',{}).get('duration',0))
    if not math.isfinite(origin) or not math.isfinite(duration):raise ValueError('无效封装时间轴')
    keys=[p for p in probe.get('packets',[]) if 'K' in p.get('flags','')]
    delays=[float(p['pts_time'])-float(p['dts_time']) for p in keys if 'pts_time' in p and 'dts_time' in p]
    reorder=max(delays,default=0)
    points=[];previous=-math.inf
    for packet in keys:
        if cancelled.is_set():raise ValueError('已取消封装索引')
        point=float(packet['pts_time'])-origin
        if not math.isfinite(point) or point<=previous:raise ValueError('关键帧时间戳跳变')
        if previous==-math.inf and not -.5<=point<1.5:raise ValueError('首关键帧偏离起点')
        previous=point
        # Stream-copy output seeking uses DTS, not PTS. Without this trim an
        # input -ss can preserve the previous GOP, or skip a whole GOP of B frames.
        dts=float(packet['dts_time']) if 'dts_time' in packet else float(packet['pts_time'])-reorder
        if not points:points.append((0.,dts))
        elif point-points[-1][0]>=1.9 and point<duration:points.append((point,dts))
    if previous==-math.inf:raise ValueError('缺少关键帧')
    if fingerprint(source)!=stamp:raise ValueError('索引期间源文件变更')
    data=validate({'version':VERSION,'source':stamp,'duration':duration,'first_pts':float(keys[0]['pts_time'])-origin,
        'fragments':[[start,dts,origin,(points[i+1][0] if i+1<len(points) else duration)-start] for i,(start,dts) in enumerate(points)]},stamp)
    if cancelled.is_set():raise ValueError('已取消封装索引')
    if not safe or destination.is_symlink():return data
    temporary=cache/f'{digest}.{uuid.uuid4().hex}.tmp'
    try:
        cache.mkdir(parents=True,exist_ok=True)
        temporary.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8');temporary.replace(destination)
    except OSError:pass
    finally:
        try:temporary.unlink(missing_ok=True)
        except OSError:pass
    return data


@dataclass
class IndexedRemux(IndexedTs):
    ffmpeg:str=''
    run:object=None
    audio_index:int|None=None
    copy_audio:bool=True
    folder:Path|None=None
    budget:int=256*1024**2
    generation:threading.Lock=field(default_factory=threading.Lock)
    cached:OrderedDict=field(default_factory=OrderedDict)
    cache_bytes:int=0
    batch_run:object=None
    cleanup_callback:object=None
    scheduler:object=None
    scheduler_lock:threading.Lock=field(default_factory=threading.Lock)

    def window_scheduler(self):
        with self.scheduler_lock:
            if self.scheduler is None:
                from .remux_scheduler import RemuxScheduler
                self.scheduler=RemuxScheduler(self)
            return self.scheduler

    def seek(self,position,revision):
        if self.batch_run and self.data is not None:self.window_scheduler().seek(position,revision)

    def cancel_windows(self):
        if self.scheduler:self.scheduler.cancel()

    def window_threads(self):return self.scheduler.threads() if self.scheduler else []

    def fragment_stats(self):return self.scheduler.stats() if self.scheduler else None

    def open_fragment(self,index,request_cancelled=None,seek_revision=0):
        if self.data is None or index>=len(self.data['fragments']) or index<0:raise ValueError('无效分片')
        if self.batch_run:
            scheduler=self.window_scheduler()
            reader=scheduler.open(index,request_cancelled,seek_revision)
            if reader is not None:return reader
        return self.open_single(index,request_cancelled)

    def open_single(self,index,request_cancelled=None):
        # Serialize this session's short remuxes, deduplicate identical HTTP
        # retries, and bound cache bytes. No long-running sequential encoder.
        cancelled=FragmentCancellation(self.cancelled,request_cancelled)
        arrival=time.monotonic()
        while not self.generation.acquire(timeout=.05):
            if cancelled.is_set():raise ValueError('分片请求已取消')
        try:
            if cancelled.is_set():raise ValueError('分片请求已取消')
            if self.data is None or index>=len(self.data['fragments']) or index<0:raise ValueError('无效分片')
            if fingerprint(self.source)!=self.data['source']:raise ValueError('源视频已变更，请重新播放')
            destination=self.folder/f'segment_{index:06d}.ts'
            cached=destination.is_file();started=time.monotonic()
            if not cached:
                if self.scheduler:
                    with self.scheduler.condition:self.scheduler.metrics['processes']+=1
                start,dts,origin,seconds=self.data['fragments'][index]
                decode_seconds=(self.data['fragments'][index+1][1] if index+1<len(self.data['fragments']) else self.data['duration']+origin)-dts
                temporary=self.folder/f'segment_{index:06d}.tmp'
                audio=f'0:{self.audio_index}' if self.audio_index is not None else '0:a:0?'
                command=[self.ffmpeg,'-hide_banner','-v','error','-nostdin','-y','-copyts']
                # Input -ss 0 is not a no-op for containers with nonzero stream
                # starts: some demuxers skip the first GOP. Read the real head.
                if index:command.extend(['-ss',str(start)])
                command.extend(['-fflags','+genpts','-i',str(self.source)])
                if index:command.extend(['-ss',str(dts)])
                command.extend(['-t',str(decode_seconds if index else decode_seconds+dts),'-map','0:v:0','-map',audio,'-c:v','copy',
                    '-c:a','copy' if self.copy_audio else 'aac'])
                if not self.copy_audio:command.extend(['-ac','2'])
                command.extend(['-output_ts_offset',str(dts-origin if index else -origin),'-avoid_negative_ts','disabled','-muxdelay','0','-f','mpegts',str(temporary)])
                try:
                    code,_,error=self.run(command,30,cancelled)
                    if cancelled.is_set():raise ValueError('分片请求已取消')
                    if code or not temporary.is_file() or temporary.stat().st_size==0:
                        raise ValueError('分片封装失败：'+error.decode('utf-8',errors='replace')[-300:])
                    if fingerprint(self.source)!=self.data['source']:raise ValueError('源视频已变更')
                    temporary.replace(destination)
                    if self.scheduler:
                        with self.scheduler.condition:self.scheduler.metrics['published']+=1
                finally:
                    try:temporary.unlink(missing_ok=True)
                    except OSError:pass
            if self.scheduler:
                with self.scheduler.condition:
                    reader=self.scheduler.open_cached(index,arrival,cached)
                    reader.avhub_timing={'cache_hit':cached,'queue_ms':(started-arrival)*1000,
                        'generation_ms':0 if cached else (time.monotonic()-started)*1000,'server_ms':(time.monotonic()-arrival)*1000}
                    return reader
            self.cached[index]=destination.stat().st_size;self.cached.move_to_end(index)
            # Pin before eviction/exit; Windows readers may defer a later unlink.
            reader=destination.open('rb')
            try:
                size=sum(self.cached.values())
                for old in list(self.cached):
                    if size<=self.budget or old==index:break
                    try:
                        (self.folder/f'segment_{old:06d}.ts').unlink(missing_ok=True);size-=self.cached.pop(old)
                    except OSError:pass
                self.cache_bytes=size
            except BaseException:
                reader.close();raise
            return reader
        finally:self.generation.release()
