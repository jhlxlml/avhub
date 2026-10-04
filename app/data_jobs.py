"""Bounded, private backup jobs. Cancellation never interrupts installation."""
import json
import shutil
import sqlite3
import threading
import time
import uuid
from contextlib import closing
from pathlib import Path
from fastapi import HTTPException


class Cancelled(Exception):pass


class Job:
    def __init__(self,kind,folder):
        self.id=folder.name;self.folder=folder;self.kind=kind;self.state='running';self.stage='queued'
        self.done=0;self.total=0;self.error='';self.result=None;self.cancelled=threading.Event();self.touched=time.monotonic()
        self.lock=threading.RLock();self.pins=0;self.thread=None;self.database=None;self.images=None

    def check(self):
        if self.cancelled.is_set():raise Cancelled()

    def progress(self,stage,done=0,total=0):
        self.check()
        with self.lock:self.stage=stage;self.done=done;self.total=total

    def public(self):
        with self.lock:
            self.touched=time.monotonic()
            return {'id':self.id,'kind':self.kind,'state':self.state,'stage':self.stage,'done':self.done,'total':self.total,
                    'cancellable':self.state=='running' and self.stage!='committing','error':self.error,'result':self.result}


class DataJobs:
    def __init__(self,directory):self.directory=directory;self.jobs={};self.lock=threading.RLock();self.active=None

    def allocate(self,kind):
        with self.lock:
            self.sweep()
            if self.active:raise HTTPException(409,'已有数据任务，请等待完成或取消')
            # Failed/cancelled tasks have no downloadable artifact. Reclaim a
            # terminal slot at capacity; retain recent outcomes for polling.
            if len(self.jobs)>=8:
                retired=next((job for job in self.jobs.values() if job.state in ('cancelled','failed') and not job.pins),None)
                if retired:self.remove_files(retired);del self.jobs[retired.id]
            if len(self.jobs)>=8:raise HTTPException(409,'数据任务数量已达上限，请关闭旧任务或稍后重试')
            parent=Path(self.directory())/'backups'/'jobs'
            if parent.resolve()!=Path(self.directory()).resolve()/'backups'/'jobs':raise HTTPException(503,'数据任务目录含外部链接，操作已取消')
            folder=parent/uuid.uuid4().hex;folder.mkdir(parents=True)
            job=Job(kind,folder);self.jobs[job.id]=job;self.active=job.id
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
                if state in ('failed','cancelled'):self.remove_files(job)
                # Publish terminal state and release the slot atomically. A
                # confirm cannot reuse the same job before old cleanup ends.
                with self.lock,job.lock:
                    if self.active==job.id:self.active=None
                    job.state=state;job.stage=state;job.result=result;job.error=error
        job.thread=threading.Thread(target=worker,name='avhub-data-job',daemon=True);job.thread.start()

    def commit(self,identity,callback):
        with self.lock:
            job=self.get(identity)
            with job.lock:
                if self.active or job.kind!='inspect' or job.state!='ready':raise HTTPException(409,'备份尚未准备好，或有其他数据任务')
                self.active=job.id;job.kind='restore';job.state='running';job.stage='committing';job.done=0;job.total=0;job.result=None
        self.run(job,callback);return job

    def cancel(self,identity):
        with self.lock:
            job=self.get(identity)
            with job.lock:
                if job.stage=='committing':raise HTTPException(409,'正在提交恢复，不能取消；请等待完成')
                if job.pins:raise HTTPException(409,'正在下载备份，不能取消')
                job.cancelled.set()
                if job.state!='running':job.state='cancelled';job.stage='cancelled';self.remove_files(job)
        return job.public()

    def remove_files(self,job):
        parent=Path(self.directory()).resolve()/'backups'/'jobs'
        if job.folder.resolve().parent==parent and job.folder.name==job.id:
            shutil.rmtree(job.folder,ignore_errors=True)

    def sweep(self):
        with self.lock:
            now=time.monotonic()
            for identity,job in list(self.jobs.items()):
                if job.state!='running' and not job.pins and now-job.touched>1200:
                    self.remove_files(job);del self.jobs[identity]

    def close(self):
        # Commit cannot be cancelled safely; preserve its staging if forced exit.
        with self.lock:jobs=list(self.jobs.values())
        for job in jobs:
            with job.lock:
                if job.stage!='committing':job.cancelled.set()
        deadline=time.monotonic()+5
        for job in jobs:
            if job.thread:job.thread.join(max(0,deadline-time.monotonic()))
            if job.state!='running' and not job.pins:self.remove_files(job)


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
