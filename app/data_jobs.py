"""Bounded, private backup jobs. Cancellation never interrupts installation."""
import json
import os
import re
import shutil
import sqlite3
import threading
import time
import uuid
from contextlib import closing
from pathlib import Path
from fastapi import HTTPException
from .cache_owner import running

MIN_FREE=128*1024**2
MAX_JOB_BYTES=7*1024**3  # upload + unpack + old thumbnails/new covers + rollback DB
MAX_TOTAL_BYTES=8*1024**3


def tree_bytes(folder,strict=False):
    """Bounded ownership walk; never follow links or unknown recovery entries."""
    total=0;pending=[folder];count=0
    while pending:
        parent=pending.pop()
        for path in parent.iterdir():
            count+=1
            if count>450010:raise ValueError('任务文件数量超出安全限制')
            relative=path.relative_to(folder).as_posix()
            if path.is_symlink() or path.resolve()!=folder.resolve()/relative:raise ValueError('任务目录含链接')
            if strict and not re.fullmatch(r'(?:owner\.json|\.owner\.tmp|library\.db|avhub-library\.zip|avhub-backup\.db|upload|unpacked|previous-thumbnails|\.backup-images-[a-zA-Z0-9_-]+)(?:/(?:library\.db|covers|thumbnails|[a-f0-9]{32}\.jpg|[1-9][0-9]{0,18}\.jpg)){0,2}',relative):
                raise ValueError('任务目录含未知文件')
            if path.is_dir():pending.append(path)
            elif path.is_file():
                info=path.stat()
                if info.st_nlink!=1:raise ValueError('任务文件含硬链接')
                total+=info.st_size
            else:raise ValueError('未知任务文件类型')
    return total


class Cancelled(Exception):pass


class Job:
    def __init__(self,kind,folder,budget=None):
        self.id=folder.name;self.folder=folder;self.kind=kind;self.state='running';self.stage='queued'
        self.done=0;self.total=0;self.error='';self.result=None;self.cancelled=threading.Event();self.touched=time.monotonic()
        self.lock=threading.RLock();self.pins=0;self.thread=None;self.database=None;self.images=None
        self.used=0;self.budget=budget
        self.needs_review=False

    def persist(self):
        payload={'format':'avhub-data-job','version':1,'id':self.id,'pid':os.getpid(),'kind':self.kind,'state':self.state,'stage':self.stage,'needs_review':self.needs_review}
        temporary=self.folder/'.owner.tmp'
        with temporary.open('w',encoding='utf-8') as output:
            json.dump(payload,output);output.flush()
            if self.stage=='committing':os.fsync(output.fileno())
        temporary.replace(self.folder/'owner.json')

    def reserve(self,size):
        self.check()
        if self.budget:self.budget(self,size)

    def check(self):
        if self.cancelled.is_set():raise Cancelled()

    def progress(self,stage,done=0,total=0):
        self.check()
        with self.lock:
            changed=self.stage!=stage
            self.stage=stage;self.done=done;self.total=total
            if changed:self.persist()

    def public(self):
        with self.lock:
            self.touched=time.monotonic()
            return {'id':self.id,'kind':self.kind,'state':self.state,'stage':self.stage,'done':self.done,'total':self.total,
                    'cancellable':self.state=='running' and self.stage!='committing','error':self.error,'result':self.result}


class DataJobs:
    def __init__(self,directory):
        self.directory=directory;self.jobs={};self.lock=threading.RLock();self.active=None
        self.last_recovery=None;self.recovery={'removed':0,'retained':0,'unknown':0};self.orphan_bytes=0

    def reserve(self,job,size):
        with self.lock:
            if size<0 or job.used+size>MAX_JOB_BYTES or self.orphan_bytes+sum(value.used for value in self.jobs.values())+size>MAX_TOTAL_BYTES:
                raise ValueError('数据任务临时空间达到上限，请关闭旧备份或核查遗留任务后重试')
            if shutil.disk_usage(job.folder).free<MIN_FREE+size:raise ValueError('磁盘剩余空间不足，数据任务已取消，请至少保留 128 MB')
            job.used+=size

    def allocate(self,kind):
        with self.lock:
            self.sweep()
            if self.active:raise HTTPException(409,'已有数据任务，请等待完成或取消')
            # Failed/cancelled tasks have no downloadable artifact. Reclaim a
            # terminal slot at capacity; retain recent outcomes for polling.
            if len(self.jobs)>=8:
                retired=next((job for job in self.jobs.values() if job.state in ('cancelled','failed') and not job.pins and not job.needs_review),None)
                if retired:self.remove_files(retired);del self.jobs[retired.id]
            if len(self.jobs)>=8:raise HTTPException(409,'数据任务数量已达上限，请关闭旧任务或稍后重试')
            parent=Path(self.directory())/'backups'/'jobs'
            if parent.resolve()!=Path(self.directory()).resolve()/'backups'/'jobs':raise HTTPException(503,'数据任务目录含外部链接，操作已取消')
            folder=parent/uuid.uuid4().hex;folder.mkdir(parents=True)
            job=Job(kind,folder,self.reserve)
            try:
                self.reserve(job,0);job.persist()
            except BaseException:
                shutil.rmtree(folder);raise
            self.jobs[job.id]=job;self.active=job.id
            return job

    def get(self,identity):
        with self.lock:
            job=self.jobs.get(identity)
            if not job:raise HTTPException(404,'数据任务已过期，请重新开始')
            job.touched=time.monotonic();return job

    def run(self,job,callback):
        def worker():
            state='ready';result=None;error=''
            try:
                job.check();result=callback(job);job.check()
            except Cancelled:
                state='cancelled'
            except Exception as exc:
                state='failed';error=str(exc.detail) if isinstance(exc,HTTPException) else str(exc) if isinstance(exc,ValueError) else '数据任务失败，请检查磁盘、权限或备份文件'
            finally:
                if state=='failed' and job.kind=='restore':job.needs_review=True
                if job.needs_review:error=(error+'；恢复暂存已保留，请导出诊断并核查恢复结果').lstrip('；')
                if state in ('failed','cancelled') and not job.needs_review:self.remove_files(job)
                # Publish terminal state and release the slot atomically. A
                # confirm cannot reuse the same job before old cleanup ends.
                with self.lock,job.lock:
                    if self.active==job.id:self.active=None
                    job.state=state;job.stage='review' if job.needs_review else state;job.result=result;job.error=error
                    if job.folder.exists():
                        try:job.persist()
                        except OSError:job.error='任务状态无法落盘，请检查磁盘与权限';job.state='failed';job.stage='failed'
        job.thread=threading.Thread(target=worker,name='avhub-data-job',daemon=True);job.thread.start()

    def commit(self,identity,callback):
        with self.lock:
            job=self.get(identity)
            with job.lock:
                if self.active or job.kind!='inspect' or job.state!='ready':raise HTTPException(409,'备份尚未准备好，或有其他数据任务')
                self.active=job.id;job.kind='restore';job.state='running';job.stage='committing';job.done=0;job.total=0;job.result=None
                try:job.persist()
                except OSError:
                    self.active=None;job.kind='inspect';job.state='ready';job.stage='ready';raise HTTPException(503,'恢复状态无法落盘，未开始恢复，请检查磁盘与权限')
        self.run(job,callback);return job

    def cancel(self,identity):
        with self.lock:
            job=self.get(identity)
            with job.lock:
                if job.stage=='committing':raise HTTPException(409,'正在提交恢复，不能取消；请等待完成')
                if job.needs_review:raise HTTPException(409,'恢复未完成，暂存文件已保留供核查，不允许直接清除')
                if job.pins:raise HTTPException(409,'正在下载备份，不能取消')
                job.cancelled.set()
                if job.state!='running':job.state='cancelled';job.stage='cancelled';self.remove_files(job)
        return job.public()

    def remove_files(self,job):
        parent=Path(self.directory()).resolve()/'backups'/'jobs'
        if job.folder.resolve().parent==parent and job.folder.name==job.id:
            shutil.rmtree(job.folder,ignore_errors=True)
            if not job.folder.exists():job.used=0

    def recover(self):
        now=time.monotonic()
        if self.last_recovery is not None and now-self.last_recovery<60:return
        self.last_recovery=now;report={'removed':0,'retained':0,'unknown':0};retained=0
        parent=Path(self.directory())/'backups'/'jobs'
        if not parent.exists():return
        if parent.resolve()!=Path(self.directory()).resolve()/'backups'/'jobs':return
        for folder in parent.iterdir():
            if folder.name in self.jobs:continue
            if not re.fullmatch(r'[a-f0-9]{32}',folder.name) or folder.is_symlink() or folder.resolve().parent!=parent.resolve():
                report['unknown']+=1;continue
            try:
                marker=folder/'owner.json'
                if marker.is_symlink() or marker.stat().st_size>4096:raise ValueError()
                record=json.loads(marker.read_text(encoding='utf-8'))
                if (record.get('format')!='avhub-data-job' or record.get('version')!=1 or record.get('id')!=folder.name or
                    type(record.get('pid')) is not int or record.get('kind') not in ('backup','inspect','restore') or
                    record.get('state') not in ('running','ready','failed','cancelled') or
                    record.get('stage') not in ('queued','snapshot','checksumming','packing','uploading','validating','database-check','directories','committing','review','ready','failed','cancelled')):raise ValueError()
                size=tree_bytes(folder,strict=True)
                if record.get('stage') in ('committing','review') or record.get('needs_review') is True or running(record['pid']):
                    report['retained']+=1;retained+=size;continue
                shutil.rmtree(folder);report['removed']+=1
            except (OSError,ValueError,TypeError,AttributeError):report['unknown']+=1
        self.recovery=report;self.orphan_bytes=retained

    def sweep(self):
        with self.lock:
            self.recover()
            now=time.monotonic()
            for identity,job in list(self.jobs.items()):
                if job.state!='running' and not job.pins and not job.needs_review and now-job.touched>1200:
                    self.remove_files(job);del self.jobs[identity]

    def close(self):
        # Commit cannot be cancelled safely; preserve its staging if forced exit.
        with self.lock:jobs=list(self.jobs.values())
        for job in jobs:
            with job.lock:
                if job.stage!='committing' and not job.needs_review:job.cancelled.set()
        deadline=time.monotonic()+5
        for job in jobs:
            if job.thread:job.thread.join(max(0,deadline-time.monotonic()))
            if job.state!='running' and not job.pins and not job.needs_review:self.remove_files(job)


def summary(database,full,build=None):
    build={key:value[:80] for key,value in build.items() if key in ('version','build_id') and isinstance(value,str)} if isinstance(build,dict) else None
    with closing(sqlite3.connect(database.absolute().as_uri()+'?mode=ro',uri=True)) as db:
        columns={row[1] for row in db.execute('PRAGMA table_info(media)')}
        result={'full':full,'format_version':1 if full else None,'build':build,
                'media':db.execute('SELECT COUNT(*) FROM media').fetchone()[0],
                'favorites':db.execute('SELECT COUNT(*) FROM media WHERE favorite=1').fetchone()[0],
                'playlists':db.execute('SELECT COUNT(*) FROM playlists').fetchone()[0],
                'covers':db.execute('SELECT COUNT(*) FROM media WHERE custom_cover IS NOT NULL').fetchone()[0] if 'custom_cover' in columns else 0,
                'thumbnails':db.execute('SELECT COUNT(*) FROM media WHERE thumbnail IS NOT NULL').fetchone()[0] if 'thumbnail' in columns else 0}
        roots=db.execute('SELECT path FROM roots ORDER BY id LIMIT 21').fetchall();root_count=db.execute('SELECT COUNT(*) FROM roots').fetchone()[0]
        result['roots']=[{'path':row[0],'available':Path(row[0]).is_dir()} for row in roots[:20]]
        result['root_count']=root_count;result['unchecked_roots']=max(0,root_count-20)
        return result
