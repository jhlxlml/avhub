"""Demand-first MKV windows; shared requests, bounded speculative work."""
from bisect import bisect_right
from dataclasses import dataclass,field
import math
import os
from pathlib import Path
import re
import threading
import time
import uuid
from .indexed_ts import fingerprint
from .remux_window import first_video_pts


@dataclass(eq=False)
class Window:
    indexes:tuple
    revision:int
    uid:str=field(default_factory=lambda:uuid.uuid4().hex)
    stop:threading.Event=field(default_factory=threading.Event)
    consumers:dict=field(default_factory=dict)
    served:bool=False
    error:Exception|None=None
    done:bool=False
    started:float=0
    published:dict=field(default_factory=dict)
    thread:threading.Thread|None=None


class Cancellation:
    poll_interval=.01
    def __init__(self,scheduler,job):self.scheduler=scheduler;self.job=job
    def is_set(self):
        s=self.scheduler;j=self.job
        if s.host.cancelled.is_set() or j.stop.is_set():return True
        with s.condition:
            # Completion of the first HTTP response is NOT a producer cancel.
            # But aborting every waiter before a usable piece is served is.
            return not j.served and bool(j.consumers) and all(e is not None and e.is_set() for e in j.consumers.values())
    def wait(self,timeout=None):
        deadline=None if timeout is None else time.monotonic()+timeout
        while not self.is_set():
            remaining=.01 if deadline is None else min(.01,deadline-time.monotonic())
            if remaining<=0:return self.is_set()
            self.job.stop.wait(remaining)
        return True


class RemuxScheduler:
    def __init__(self,host):
        self.host=host;self.condition=threading.Condition(threading.RLock());self.producer=host.generation
        self.active=None;self.workers=set();self.revision=0;self.disabled=False
        self.starts=[f[0] for f in host.data['fragments']]
        fragments=host.data['fragments']
        # Segment muxer normalizes against the first video PTS, not its DTS
        # reorder delay. Keep that offset even when audio defines format start.
        # Older caches can be inferred; every published PES is still checked.
        self.first_shift=host.data.get('first_pts',fragments[1][0]+fragments[0][1]-fragments[1][1] if len(fragments)>1 else 0)
        self.metrics={'processes':0,'cache_hits':0,'cache_misses':0,'published':0,'cancelled':0,'batch_failures':0}

    def window(self,index):
        # The head and long GOPs retain the exact existing single-fragment path.
        # Average source bitrate bounds speculation in addition to cache quota.
        if index==0:return ()
        estimate=self.host.data['source'][1]/self.host.data['duration']
        # High-bitrate clips should not spend speculative I/O on an eight-second
        # window while the user is rapidly seeking somewhere else.
        target=4 if estimate>2*1024**2 else 8
        indexes=[];seconds=0.;limit=min(32*1024**2,self.host.budget/2)
        for i in range(index,min(index+8,len(self.starts))):
            duration=self.host.data['fragments'][i][3]
            if seconds+duration>12 or (seconds+duration)*estimate>limit:break
            indexes.append(i);seconds+=duration
            if seconds>=target:break
        return tuple(indexes) if len(indexes)>1 else ()

    def seek(self,position,revision):
        with self.condition:
            if revision<=self.revision:return
            self.revision=revision
            index=max(0,bisect_right(self.starts,position)-1)
            if self.active and index not in self.active.indexes:self.active.stop.set()
            self.condition.notify_all()

    def cancel(self):
        with self.condition:
            for job in self.workers:job.stop.set()
            self.condition.notify_all()

    def threads(self):
        with self.condition:return [job.thread for job in self.workers if job.thread]

    def stats(self):
        with self.condition:return {**self.metrics,'workers':len(self.workers)}

    def open_cached(self,index,arrival,hit,job=None):
        destination=self.host.folder/f'segment_{index:06d}.ts'
        if not destination.is_file():return None
        reader=destination.open('rb')
        try:
            self.host.cached[index]=os.fstat(reader.fileno()).st_size;self.host.cached.move_to_end(index)
            self.evict({index})
        except BaseException:
            reader.close();raise
        now=time.monotonic();started=job.started if job else now
        reader.avhub_timing={'cache_hit':hit,'queue_ms':max(0,started-arrival)*1000,
            'generation_ms':0 if hit else max(0,now-max(started,arrival))*1000,'server_ms':(now-arrival)*1000}
        if job:job.served=True
        return reader

    def evict(self,protected):
        size=sum(self.host.cached.values())
        for old in list(self.host.cached):
            if size<=self.host.budget:break
            if old in protected:continue
            try:
                (self.host.folder/f'segment_{old:06d}.ts').unlink(missing_ok=True);size-=self.host.cached.pop(old)
            except OSError:pass
        self.host.cache_bytes=size

    def open(self,index,request_cancelled,revision):
        arrival=time.monotonic();waiter=object()
        with self.condition:
            if self.host.cancelled.is_set() or request_cancelled is not None and request_cancelled.is_set():raise ValueError('分片请求已取消')
            if fingerprint(self.host.source)!=self.host.data['source']:raise ValueError('源视频已变更')
            reader=self.open_cached(index,arrival,True)
            if reader:self.metrics['cache_hits']+=1;return reader
            if revision<self.revision:raise ValueError('跳播请求已过期')
            self.revision=max(revision,self.revision)
            self.metrics['cache_misses']+=1
            indexes=self.window(index)
            if self.disabled or not indexes:return None
            job=self.active
            if not job or job.done or job.stop.is_set() or index not in job.indexes:
                if job:job.stop.set()
                job=Window(indexes,revision);self.active=job
                # Window is mutable and intentionally tracked by object identity.
                self.workers.add(job)
                job.consumers[waiter]=request_cancelled
                job.thread=threading.Thread(target=self.generate,args=(job,),daemon=True,name=f'avhub-remux-{job.uid[:8]}')
                job.thread.start()
            else:job.consumers[waiter]=request_cancelled
            deadline=time.monotonic()+32
            try:
                while True:
                    if self.host.cancelled.is_set() or request_cancelled is not None and request_cancelled.is_set():raise ValueError('分片请求已取消')
                    if job.stop.is_set():raise ValueError('跳播窗口已过期')
                    reader=self.open_cached(index,arrival,False,job)
                    if reader:return reader
                    if job.error:
                        # Unusual muxing/rounding falls back for this session,
                        # not to video transcoding and never to a guessed piece.
                        self.disabled=True;return None
                    if job.done:raise ValueError('窗口未生成所需分片')
                    if time.monotonic()>=deadline:job.stop.set();raise TimeoutError('等待分片超时')
                    self.condition.wait(.02)
            finally:
                job.consumers.pop(waiter,None)
                if not job.served and not job.consumers:job.stop.set()

    def command(self,job):
        h=self.host;index=job.indexes[0];last=job.indexes[-1]+1
        start,dts,origin,_=h.data['fragments'][index]
        end=h.data['fragments'][last][1] if last<len(self.starts) else h.data['duration']+origin
        delay=self.first_shift
        times=','.join(f'{h.data["fragments"][i][0]-start:.9f}' for i in job.indexes[1:])
        audio=f'0:{h.audio_index}' if h.audio_index is not None else '0:a:0?'
        return [h.ffmpeg,'-hide_banner','-v','error','-nostdin','-y','-copyts','-ss',str(start),'-fflags','+genpts','-i',str(h.source),
            '-ss',str(dts),'-t',str(end-dts),'-map','0:v:0','-map',audio,'-c:v','copy','-c:a','copy',
            '-output_ts_offset',str(dts-origin),'-avoid_negative_ts','disabled','-muxdelay','0',
            '-f','segment','-segment_format','mpegts','-segment_format_options',f'mpegts_copyts=1:avoid_negative_ts=disabled:output_ts_offset={delay:.9f}',
            '-segment_times',times,'-segment_time_delta','0.00002','-reset_timestamps','0','-segment_start_number',str(index),
            '-segment_list',str(h.folder/f'window_{job.uid}.csv'),'-segment_list_type','csv',
            str(h.folder/f'window_{job.uid}_%06d.part.ts')]

    def generate(self,job):
        cancelled=Cancellation(self,job);h=self.host;acquired=False
        try:
            while not self.producer.acquire(timeout=.02):
                if cancelled.is_set():raise ValueError('窗口已取消')
            acquired=True
            if cancelled.is_set():raise ValueError('窗口已取消')
            with self.condition:
                if self.disabled:
                    job.error=ValueError('窗口模式已回退');return
            job.started=time.monotonic()
            with self.condition:self.metrics['processes']+=1
            def publish(name,start,end):
                match=re.fullmatch(f'window_{job.uid}_(\\d{{6}})\\.part\\.ts',Path(name).name)
                if not match:raise ValueError('封装分片名称无效')
                index=int(match[1]);path=h.folder/Path(name).name
                if index not in job.indexes or not math.isfinite(end):raise ValueError('封装区间无效')
                if cancelled.is_set():raise ValueError('窗口已取消')
                expected=h.data['fragments'][index][0]
                if not path.is_file() or path.stat().st_size%188 or abs(first_video_pts(path,require_idr=True)-expected)>.002:
                    raise ValueError('封装关键帧偏离索引')
                delay=self.first_shift
                if index+1<len(self.starts) and abs(end+delay-self.starts[index+1])>.003:raise ValueError('封装边界偏离索引')
                if fingerprint(h.source)!=h.data['source']:raise ValueError('源视频已变更')
                with self.condition:
                    if cancelled.is_set():raise ValueError('窗口已取消')
                    destination=h.folder/f'segment_{index:06d}.ts'
                    if destination.is_file():
                        # A new window may overlap already valid cached pieces.
                        # Never replace a reader-pinned Windows cache file.
                        path.unlink(missing_ok=True)
                    else:
                        path.replace(destination);self.metrics['published']+=1
                    h.cached[index]=destination.stat().st_size;h.cached.move_to_end(index)
                    job.published[index]=time.monotonic()
                    protected={i for i in job.indexes if any(e is None or not e.is_set() for e in job.consumers.values())}
                    self.evict(protected|{index});self.condition.notify_all()
            code,error=h.batch_run(self.command(job),30,cancelled,publish)
            if code:raise ValueError('窗口封装失败：'+error.decode('utf-8',errors='replace')[-200:])
        except Exception as exc:
            with self.condition:
                job.error=exc
                if cancelled.is_set():self.metrics['cancelled']+=1
                else:
                    self.metrics['batch_failures']+=1;self.disabled=True
        finally:
            # Only our uniquely named files; never remove source media.
            for path in [h.folder/f'window_{job.uid}.csv',*(h.folder.glob(f'window_{job.uid}_*.part.ts'))]:
                try:path.unlink(missing_ok=True)
                except OSError:pass
            if acquired:self.producer.release()
            with self.condition:
                job.done=True;self.workers.discard(job);self.condition.notify_all()
            if h.cleanup_callback:h.cleanup_callback()
