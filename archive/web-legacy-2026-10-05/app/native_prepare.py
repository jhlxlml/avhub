"""Optional, byte-copy MKV preparation. Never encode or mutate source media."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import threading
import time
from fastapi import HTTPException
from starlette.responses import Response
from .indexed_ts import fingerprint
from .cache_owner import orphaned
from .video_color import color_metadata

VERSION=1
KIND='avhub-native-copy'
KNOWN={'owner.json','metadata.json','metadata.tmp','media.mkv','preparing.mkv'}


def digest(stamp):return hashlib.sha256(json.dumps([VERSION,stamp],ensure_ascii=False).encode()).hexdigest()


def signatures(raw):
    data=json.loads(raw)
    streams=data.get('streams',[])
    if not streams or len(streams)>128:raise ValueError('媒体轨道数量无法安全验证')
    result=[]
    for stream in streams:
        item={key:stream.get(key) for key in ['codec_type','codec_name','profile','width','height','pix_fmt','sample_rate','channels','channel_layout']}
        if stream.get('codec_type')=='video':
            color=color_metadata(stream)
            item['color']={key:color.get(key) for key in ['bit_depth','transfer','primaries','matrix','range','hdr','peak_nits','dynamic_hdr','dolby_vision_profile']}
            item['display']={key:stream.get(key) for key in ['sample_aspect_ratio','display_aspect_ratio','field_order','chroma_location']}
            # Container-side HDR mastering/light metadata and display matrices
            # must survive too; retaining dimensions alone is not sufficient.
            relevant=('mastering display','content light','dovi','dolby','hdr10+','display matrix')
            item['side_data']=sorted([entry for entry in stream.get('side_data_list',[])
                if any(name in entry.get('side_data_type','').lower() for name in relevant)],key=lambda item:json.dumps(item,sort_keys=True))
        item['language']=stream.get('tags',{}).get('language','und')
        item['disposition']=stream.get('disposition',{})
        result.append(item)
    return result


class CopySignal:
    def __init__(self,cache,job):self.cache=cache;self.job=job
    def is_set(self):return self.job['cancelled'].is_set() or self.cache.playing()
    def wait(self,timeout):
        end=time.monotonic()+timeout
        while not self.is_set():
            left=end-time.monotonic()
            if left<=0:return False
            self.job['cancelled'].wait(min(.02,left))
        return True


class NativePrepare:
    def __init__(self,directory,protected=lambda:set(),budget=8*1024**3):
        self.directory=directory;self.protected=protected;self.budget=budget
        self.lock=threading.RLock();self.jobs={};self.active=None;self.pins={};self.leases={};self.closed=False

    def root(self,create=False):
        data=Path(self.directory()).resolve();root=data/'native-cache'
        if root.is_symlink() or root.resolve()!=data/'native-cache':raise HTTPException(503,'无损缓存目录含外部链接，操作已停止')
        if create:root.mkdir(parents=True,exist_ok=True)
        return root

    def folder(self,key):
        if not re.fullmatch(r'[a-f0-9]{64}',key):raise HTTPException(404)
        folder=self.root()/key
        if folder.is_symlink() or folder.resolve()!=self.root()/key:raise HTTPException(503,'无损缓存路径含链接')
        return folder

    def owned(self,path):return not path.is_symlink() and path.resolve()==self.root()/path.parent.name/path.name

    def metadata(self,key):
        try:
            folder=self.folder(key);path=folder/'metadata.json'
            if not self.owned(path) or path.stat().st_size>256*1024:return None
            value=json.loads(path.read_text(encoding='utf-8'))
            stamp=value['source']
            if value.get('version')!=VERSION or digest(stamp)!=key or Path(stamp[0]).resolve().is_relative_to(self.root()):return None
            return value
        except (OSError,ValueError,KeyError,TypeError,HTTPException):return None

    def ready(self,source,touch=False):
        with self.lock:
            try:
                stamp=fingerprint(source);key=digest(stamp);value=self.metadata(key)
                if not value or value['source']!=stamp:return None
                path=self.folder(key)/'media.mkv'
                if not self.owned(path) or path.stat().st_size!=value['size'] or path.stat().st_mtime_ns!=value['modified']:return None
                if touch:
                    value['used']=time.time();self.write_metadata(key,value)
                return key,path
            except OSError:return None

    def write_metadata(self,key,value):
        folder=self.folder(key);target=folder/'metadata.json';temporary=folder/'metadata.tmp'
        if not self.owned(target) or not self.owned(temporary):raise ValueError('缓存记录路径不安全')
        temporary.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');temporary.replace(target)

    def activity(self,owner,source,playing,present=True,prepared=False):
        with self.lock:
            if not present or source is None:self.leases.pop(owner,None);return
            try:key=digest(fingerprint(source)) if prepared else None
            except OSError:key=None
            self.leases[owner]=(key,bool(playing),time.monotonic()+120)

    def playing(self):
        with self.lock:
            now=time.monotonic();self.leases={owner:value for owner,value in self.leases.items() if value[2]>now}
            return any(value[1] for value in self.leases.values())

    def protected_keys(self):
        self.playing()
        return {value[0] for value in self.leases.values()}|{key for key,count in self.pins.items() if count}|({self.active} if self.active else set())

    def entries(self):
        root=self.root()
        if not root.exists():return []
        return [(folder.name,value) for folder in root.iterdir() if re.fullmatch(r'[a-f0-9]{64}',folder.name)
                and (value:=self.metadata(folder.name)) is not None]

    def catalog(self):
        root=self.root()
        if not root.exists():return []
        result=[]
        for folder in root.iterdir():
            if not re.fullmatch(r'[a-f0-9]{64}',folder.name):continue
            try:
                folder=self.folder(folder.name);marker=folder/'owner.json'
                if not self.owned(marker) or marker.stat().st_size>4096:continue
                owner=json.loads(marker.read_text(encoding='utf-8'))
                if owner.get('kind')!=KIND or owner.get('key')!=folder.name or digest(owner['source'])!=folder.name:continue
                children=list(folder.iterdir())
                if any(child.name not in KNOWN or not self.owned(child) or not child.is_file() for child in children):continue
                value=self.metadata(folder.name)
                job=self.jobs.get(folder.name)
                reclaimable=bool(value) or orphaned(folder) or bool(job and job['state'] in ('failed','cancelled'))
                size=sum(child.stat().st_size for child in children if child.name in ('media.mkv','preparing.mkv'))
                result.append((folder.name,size,value.get('used',0) if value else 0,reclaimable))
            except (OSError,ValueError,KeyError,TypeError,HTTPException):continue
        return result

    def remove(self,key):
        # Exact known, owned files only. Never recursive-delete a directory or
        # anything referenced as a media source, even if it sits inside cache.
        folder=self.folder(key)
        if not folder.exists():return 0
        children=list(folder.iterdir());sources={str(Path(path).resolve()) for path in self.protected()}
        if key in self.protected_keys():raise HTTPException(409,'该缓存正在使用或准备，暂不能清理')
        if any(child.name not in KNOWN or not self.owned(child) or not child.is_file() or str(child.resolve()) in sources for child in children):
            raise HTTPException(409,'缓存含未知、链接或源视频文件，已跳过')
        # Verify ownership rather than treating an arbitrary .mkv as a cache.
        marker=folder/'owner.json'
        try:
            if marker.stat().st_size>4096:raise ValueError()
            owner=json.loads(marker.read_text(encoding='utf-8'))
            if owner.get('kind')!=KIND or owner.get('key')!=key or digest(owner['source'])!=key:raise ValueError()
        except (OSError,ValueError,KeyError,TypeError):raise HTTPException(409,'缓存所有权无法确认')
        size=sum(child.stat().st_size for child in children)
        # A pinned Windows data file must fail BEFORE ownership metadata is
        # removed. Otherwise a partially cleaned entry becomes unrecoverable.
        for child in sorted(children,key=lambda p:({'preparing.mkv':0,'media.mkv':1,'metadata.tmp':2,'metadata.json':3,'owner.json':4}[p.name])):child.unlink()
        folder.rmdir();return size

    def room(self,required):
        if required>self.budget:raise HTTPException(422,'原画缓存预计超过 8 GB 上限；不会通过降低质量减小文件')
        entries=self.catalog();used=sum(item[1] for item in entries)
        for key,size,_,reclaimable in sorted(entries,key=lambda item:item[2]):
            if used+required<=self.budget:break
            if key in self.protected_keys() or not reclaimable:continue
            try:self.remove(key);used-=size
            except (OSError,HTTPException):continue
        if used+required>self.budget:raise HTTPException(409,'无损缓存空间不足，正在使用的缓存不会被删除')
        if shutil.disk_usage(self.root()).free<required+256*1024**2:raise HTTPException(507,'磁盘可用空间不足；不会降低画质继续准备')

    def info(self,source):
        with self.lock:
            stamp=fingerprint(source);key=digest(stamp)
            job=self.jobs.get(key)
            base={'source_size':stamp[1],'budget':self.budget,'in_use':key in self.protected_keys()}
            if job and job['state'] in ('running','waiting','validating'):return self.public(job)|base
            if self.ready(source):return {'key':key,'state':'ready','percent':100,'size':(self.folder(key)/'media.mkv').stat().st_size,'error':'','cancellable':False}|base
            return (self.public(job) if job else {'key':key,'state':'idle','percent':0,'size':0,'error':'','cancellable':False})|base

    def public(self,job):
        return {name:job[name] for name in ['key','state','percent','size','error']}|{'cancellable':job['state'] in ('running','waiting','validating')}

    def start(self,source,ffmpeg,ffprobe,run,stream):
        with self.lock:
            if self.closed:raise HTTPException(503,'应用正在退出')
            source=source.resolve(strict=True)
            if source.suffix.lower()!='.mkv' or source.is_relative_to(self.root()):raise HTTPException(422,'只支持原始 MKV 的无损准备')
            if self.ready(source):return self.info(source)
            if self.active:raise HTTPException(409,'已有无损准备任务，请等待或取消')
            if self.playing():raise HTTPException(409,'请先暂停播放，再开始无损准备')
            stamp=fingerprint(source);key=digest(stamp);self.root(True)
            required=int(stamp[1]*1.15)+2*1024**2;self.room(required)
            folder=self.folder(key)
            if folder.exists():self.remove(key)
            folder.mkdir();(folder/'owner.json').write_text(json.dumps({'kind':KIND,'key':key,'source':stamp,'pid':os.getpid()}),encoding='utf-8')
            job={'key':key,'source':str(source),'state':'running','percent':0,'size':0,'error':'','cancelled':threading.Event(),'thread':None}
            self.jobs[key]=job;self.active=key
            while len(self.jobs)>8:
                old=next((k for k,v in self.jobs.items() if k!=self.active and v['state'] not in ('running','waiting','validating')),None)
                if old is None:break
                del self.jobs[old]
            job['thread']=threading.Thread(target=self.work,args=(job,source,stamp,ffmpeg,ffprobe,run,stream),daemon=True,name='avhub-native-prepare')
            job['thread'].start();return self.public(job)

    def probe(self,source,ffprobe,run,cancelled):
        code,raw,_=run([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(source)],30,cancelled)
        if code or len(raw)>4*1024**2:raise ValueError('媒体信息无法完整验证')
        return signatures(raw),float(json.loads(raw).get('format',{}).get('duration',0))

    def work(self,job,source,stamp,ffmpeg,ffprobe,run,stream):
        folder=self.folder(job['key']);part=folder/'preparing.mkv';final=folder/'media.mkv'
        try:
            before,duration=self.probe(source,ffprobe,run,job['cancelled'])
            command=[ffmpeg,'-hide_banner','-v','error','-nostdin','-nostats','-y','-i',str(source),'-map','0',
                '-map_metadata','0','-map_chapters','0','-c','copy','-default_mode','passthrough',
                '-reserve_index_space',str(2*1024**2),'-cues_to_front','1','-progress','pipe:1','-f','matroska',str(part)]
            while True:
                if job['cancelled'].is_set():raise ValueError('已取消准备')
                if self.playing():
                    with self.lock:job['state']='waiting';job['percent']=0
                    job['cancelled'].wait(.2);continue
                with self.lock:job['state']='running'
                def progress(line):
                    key,_,value=line.strip().partition(b'=')
                    with self.lock:
                        if key==b'out_time_us' and duration>0:
                            try:job['percent']=max(0,min(95,int(value)/1000000/duration*95))
                            except ValueError:pass
                        if key==b'total_size':
                            try:job['size']=int(value)
                            except ValueError:pass
                    if part.exists() and part.stat().st_size>self.budget:raise ValueError('输出超过原画缓存容量上限，已停止')
                signal=CopySignal(self,job)
                try:
                    code,error=stream(command,1800,signal,progress)
                    if code:raise ValueError('无损封装失败：'+error.decode('utf-8',errors='replace')[-240:])
                    break
                except Exception:
                    if self.playing() and not job['cancelled'].is_set():
                        part.unlink(missing_ok=True);continue
                    raise
            if job['cancelled'].is_set():raise ValueError('已取消准备')
            with self.lock:job['state']='validating';job['percent']=98
            after,after_duration=self.probe(part,ffprobe,run,job['cancelled'])
            if before!=after:raise ValueError('原编码、分辨率、色彩或轨道信息不一致，拒绝发布')
            if duration<=0 or abs(duration-after_duration)>.5:raise ValueError('无损副本时间轴无法确认，拒绝发布')
            if fingerprint(source)!=stamp:raise ValueError('准备期间源视频发生变化，拒绝使用旧副本')
            if part.stat().st_size>self.budget:raise ValueError('无损副本超过容量上限，拒绝降质或发布')
            with self.lock:
                if job['cancelled'].is_set():raise ValueError('已取消准备')
                part.replace(final);info=final.stat()
                self.write_metadata(job['key'],{'version':VERSION,'source':stamp,'size':info.st_size,'modified':info.st_mtime_ns,'used':time.time(),'signature':after})
                job.update(state='ready',percent=100,size=info.st_size)
        except Exception as exc:
            with self.lock:
                job.update(state='cancelled' if job['cancelled'].is_set() else 'failed',error='' if job['cancelled'].is_set() else str(exc))
        finally:
            with self.lock:
                if self.active==job['key']:self.active=None
                if job['state']!='ready':
                    try:self.remove(job['key'])
                    except (OSError,HTTPException):pass

    def cancel(self,source):
        with self.lock:
            try:job=self.jobs.get(digest(fingerprint(source)))
            except OSError:job=next((job for job in self.jobs.values() if job['source']==str(source.resolve())),None)
            if job:job['cancelled'].set()
            return self.public(job) if job else self.info(source)

    def pin(self,source):
        with self.lock:
            ready=self.ready(source,touch=True)
            if not ready:raise HTTPException(404,'无损缓存已失效，请重新准备或使用原片')
            key,path=ready;self.pins[key]=self.pins.get(key,0)+1;return key,path

    def unpin(self,key):
        with self.lock:self.pins[key]=max(0,self.pins.get(key,1)-1)

    def clear(self,source):
        with self.lock:return {'ok':True,'freed_bytes':self.remove(digest(fingerprint(source)))}

    def cancel_pending(self):
        # Disabling the feature stops unfinished work, but never removes a
        # completed copy or marks the manager closed (it may be re-enabled).
        with self.lock:
            for job in self.jobs.values():
                if job['state'] in ('running','waiting','validating'):job['cancelled'].set()

    def close(self):
        with self.lock:
            self.closed=True;jobs=list(self.jobs.values())
            for job in jobs:job['cancelled'].set()
        deadline=time.monotonic()+3
        for job in jobs:
            if job['thread']:job['thread'].join(max(0,deadline-time.monotonic()))


class PinnedPreparedResponse(Response):
    def __init__(self,response,cache,key):
        super().__init__();self.response=response;self.cache=cache;self.key=key
    async def __call__(self,scope,receive,send):
        try:await self.response(scope,receive,send)
        finally:self.cache.unpin(self.key)
