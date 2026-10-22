"""DB-spooled thumbnail work: bounded RAM, no backpressure on video indexing."""
import threading
import time
import uuid
from pathlib import Path
from contextlib import contextmanager
from typing import NamedTuple
from .publication_gate import PublicationGate


class CommittedThumbnail(NamedTuple):
    """Receipt issued only after cover metadata AND job completion commit.

    Retains the two-value success/error decoder contract. Unlike an ordinary
    decoder success, the worker must not finish this job in another transaction.
    """
    success: bool = True
    error: str = ''


def install(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS thumbnail_jobs (
        media_id INTEGER PRIMARY KEY,root_id INTEGER,path TEXT NOT NULL,size INTEGER,modified REAL,
        state TEXT NOT NULL DEFAULT 'pending',attempted_at REAL NOT NULL DEFAULT 0,revision TEXT NOT NULL DEFAULT '');
        CREATE INDEX IF NOT EXISTS thumbnail_pending ON thumbnail_jobs(root_id,media_id) WHERE state='pending';''')
    if 'revision' not in {row[1] for row in db.execute('PRAGMA table_info(thumbnail_jobs)')}:
        db.execute("ALTER TABLE thumbnail_jobs ADD COLUMN revision TEXT NOT NULL DEFAULT ''")
    columns={row[1] for row in db.execute('PRAGMA table_info(thumbnail_jobs)')}
    for name,definition in [('frame_time','REAL'),('priority','REAL NOT NULL DEFAULT 0'),
                            ('ready_at','REAL NOT NULL DEFAULT 0'),('last_error',"TEXT NOT NULL DEFAULT ''")]:
        if name not in columns:db.execute(f'ALTER TABLE thumbnail_jobs ADD COLUMN {name} {definition}')
    db.executescript('''CREATE INDEX IF NOT EXISTS thumbnail_priority ON thumbnail_jobs(priority DESC,media_id) WHERE state='pending';
        CREATE TABLE IF NOT EXISTS thumbnail_control(id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL DEFAULT 0);''')


class ThumbnailJobs:
    def __init__(self,connection,roots,read_connection=None):
        self.connection=connection;self.read_connection=read_connection or connection;self.all_roots=roots is None
        self.roots=list(dict.fromkeys(roots or []));self.root_set=set(self.roots);self.lock=threading.RLock()
        self.visible={}

    def prioritize(self,ids):
        # Viewport order is only a bounded scheduling hint, not durable user
        # data. Keep jobs/revisions/retries in SQLite, but never fsync on scroll
        # or compete with a progress save merely to change this hint.
        stamp=time.time()
        with self.lock:self.visible={value:stamp for value in list(dict.fromkeys(ids))[:120]}

    def scope(self):
        if self.all_roots:return '1',[]
        with self.lock:roots=self.roots.copy()
        return 'root_id IN ('+','.join('?' for _ in roots)+')',roots

    def activate(self,root_id):
        with self.lock:
            if root_id in self.root_set:return 0
            self.roots.append(root_id);self.root_set.add(root_id)
        with self.read_connection() as db:
            return db.execute("SELECT COUNT(*) FROM thumbnail_jobs WHERE state='pending' AND root_id=?",(root_id,)).fetchone()[0]

    def schedule(self,path,media_id,*_):
        with self.connection() as db:
            return self.schedule_in(db,media_id)

    def schedule_in(self,db,media_id):
        """Enqueue on the caller's transaction; never commit or wake a worker.

        The caller owns the publication gate and commits before signalling.
        Standalone scheduling above retains its original durable contract.
        """
        row=db.execute('SELECT root_id,path,size,modified FROM media WHERE id=?',(media_id,)).fetchone()
        if not row:return False
        old=db.execute('SELECT * FROM thumbnail_jobs WHERE media_id=?',(media_id,)).fetchone()
        same=old and all(old[key]==row[key] for key in ['root_id','path','size','modified'])
        if same and (old['state']=='pending' or time.time()-old['attempted_at']<300):return False
        db.execute('''INSERT INTO thumbnail_jobs(media_id,root_id,path,size,modified,revision) VALUES(?,?,?,?,?,?)
            ON CONFLICT(media_id) DO UPDATE SET root_id=excluded.root_id,path=excluded.path,size=excluded.size,
            modified=excluded.modified,state='pending',attempted_at=0,revision=excluded.revision,
            frame_time=NULL,priority=0,ready_at=0,last_error='' ''',
            (media_id,*[row[key] for key in ['root_id','path','size','modified']],uuid.uuid4().hex))
        with self.lock:already_counted=old and old['state']=='pending' and old['root_id'] in self.root_set
        return not already_counted

    def count(self):
        scope,roots=self.scope()
        with self.read_connection() as db:return db.execute("SELECT COUNT(*) FROM thumbnail_jobs WHERE state='pending' AND "+scope,roots).fetchone()[0]

    def next(self):
        scope,roots=self.scope()
        with self.lock:visible=self.visible.copy()
        with self.read_connection() as db:
            now=time.time()
            row=db.execute("SELECT * FROM thumbnail_jobs WHERE state='pending' AND ready_at<=? AND "+scope+' ORDER BY priority DESC,media_id LIMIT 1',[now,*roots]).fetchone()
            if visible:
                candidates=db.execute("SELECT * FROM thumbnail_jobs WHERE state='pending' AND ready_at<=? AND "+scope+
                    ' AND media_id IN ('+','.join('?' for _ in visible)+')',[now,*roots,*visible]).fetchall()
                # An explicit retry's persisted priority still competes with
                # viewport hints. The primary-key lookup touches <=120 jobs,
                # never sorts the full library by an in-memory expression.
                row=max(([row] if row else [])+candidates,key=lambda r:(max(r['priority'],visible.get(r['media_id'],0)),-r['media_id']),default=None)
            if not row:return None
            current=db.execute('SELECT root_id,path,size,modified,missing,duration,file_state FROM media WHERE id=?',(row['media_id'],)).fetchone()
            valid=current and not current['missing'] and current['file_state']=='normal' and all(row[key]==current[key] for key in ['root_id','path','size','modified'])
            return dict(row), (row['path'],row['media_id'],current['duration'] or 0,True,dict(row)) if valid else None

    def finish(self,key,success,error=''):
        with self.connection() as db:
            condition="media_id=? AND revision=? AND state='pending'"
            values=(key['media_id'],key['revision'])
            if success:cursor=db.execute('DELETE FROM thumbnail_jobs WHERE '+condition,values)
            else:cursor=db.execute("UPDATE thumbnail_jobs SET state='failed',attempted_at=?,last_error=? WHERE "+condition,(time.time(),error[:1600],*values))
            return cursor.rowcount > 0


class ThumbnailService:
    """Durable, independent lifecycle. No decoding or waiting in index requests.

    gate protects publication and source/index mutation, never the decode itself.
    Each decode owns its cancellation event (not the metadata scanner's event).
    """
    def __init__(self,connection,process,read_connection=None,on_timeout=None,scope=None):
        self.read_connection=read_connection or connection
        self.connection=connection;self.jobs=ThumbnailJobs(connection,None,self.read_connection);self.process=process
        self.gate=PublicationGate(scope);self.lock=threading.RLock()
        self.wake=threading.Event();self.stop=threading.Event();self.cancelled=threading.Event()
        self.thread=None;self.paused=False;self.current=None;self.published=0;self.error=''
        self.on_timeout=on_timeout;self.playback_leases={}

    def playback_activity(self,owner,playing):
        # Transient heartbeat leases, not the user's persisted pause setting.
        with self.gate,self.lock:
            self.playback_leases={key:value for key,value in self.playback_leases.items() if value>time.monotonic()}
            if playing:
                if owner not in self.playback_leases and len(self.playback_leases)>=128:return
                self.playback_leases[owner]=time.monotonic()+20;self.cancelled.set()
            else:self.playback_leases.pop(owner,None)
        self.wake.set()

    def yielding(self):
        with self.lock:
            self.playback_leases={key:value for key,value in self.playback_leases.items() if value>time.monotonic()}
            return bool(self.playback_leases)

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():return
            with self.read_connection() as db:
                row=db.execute('SELECT paused FROM thumbnail_control WHERE id=1').fetchone()
            self.paused=bool(row and row[0]);self.stop.clear();self.cancelled=threading.Event()
            self.thread=threading.Thread(target=self.run,name='avhub-cover-worker',daemon=True);self.thread.start()

    def reload_control(self):
        # Restore calls this while owning the exclusive read gate. Use its
        # reentrant serialized connection, not a snapshot read behind that gate.
        with self.connection() as db:row=db.execute('SELECT paused FROM thumbnail_control WHERE id=1').fetchone()
        self.jobs.prioritize([])
        with self.lock:self.paused=bool(row and row[0])
        self.wake.set()

    def submit(self,*job):
        with self.gate:self.jobs.schedule(*job)
        self.wake.set()

    @contextmanager
    def scan_write(self,connection):
        # Same lock order as publication/mutations: gate BEFORE writer. Never
        # wake on a rolled-back enqueue or hold this gate during FFprobe.
        with self.gate:
            with connection() as db:yield db
        self.wake.set()

    def activate(self,root_id):
        with self.connection() as db:
            db.execute("UPDATE thumbnail_jobs SET ready_at=0 WHERE root_id=? AND state='pending' AND ready_at<>0",(root_id,))
        self.wake.set()

    def pause(self,paused=True):
        with self.gate,self.lock:
            if paused:self.cancelled.set()
            with self.connection() as db:
                db.execute('INSERT INTO thumbnail_control(id,paused) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET paused=excluded.paused',(int(paused),))
            self.paused=paused
        self.wake.set();return self.snapshot()

    @contextmanager
    def mutation(self):
        with self.gate:
            with self.lock:self.cancelled.set()
            yield
        self.wake.set()

    def close(self,timeout=5):
        self.request_stop()
        with self.lock:thread=self.thread
        self.wake.set()
        if thread and thread is not threading.current_thread():thread.join(timeout)
        finished=not thread or not thread.is_alive()
        if not finished:
            state={'current_media_id':self.current,'paused':self.paused,'cancel_requested':self.cancelled.is_set()}
            self.error='封面工作者未在关闭期限内退出，已记录现场'
            if self.on_timeout:self.on_timeout('thumbnail-close-timeout',state)
        return finished

    def request_stop(self):
        with self.lock:self.stop.set();self.cancelled.set()
        self.wake.set()

    def prioritize(self,ids):
        self.jobs.prioritize(ids)
        self.wake.set()

    def snapshot(self):
        with self.read_connection() as db:
            counts={row['state']:row['n'] for row in db.execute('SELECT state,COUNT(*) AS n FROM thumbnail_jobs GROUP BY state')}
            blocked=db.execute("SELECT COUNT(*) FROM thumbnail_jobs WHERE state='pending' AND ready_at>?",(time.time(),)).fetchone()[0]
        with self.lock:
            return {'pending':counts.get('pending',0),'failed':counts.get('failed',0),'blocked':blocked,
                    'paused':self.paused,'yielding':self.yielding(),'current':self.current,'published':self.published,'error':self.error,
                    'publication_gate':self.gate.report()}

    def run(self):
        while not self.stop.is_set():
            self.wake.clear()
            try:
                with self.lock:paused=self.paused
                pending=None if paused or self.yielding() else self.jobs.next()
                if pending is None:self.wake.wait(2);continue
                key,job=pending
                with self.gate,self.lock:
                    if self.paused or self.yielding() or self.stop.is_set():continue
                    cancelled=threading.Event();self.cancelled=cancelled;self.current=key['media_id']
                error='';success=True;committed=False
                if job:
                    with self.read_connection() as db:root=db.execute('SELECT path FROM roots WHERE id=?',(key['root_id'],)).fetchone()
                    if root and not Path(root[0]).is_dir():
                        with self.connection() as db:
                            db.execute('UPDATE thumbnail_jobs SET ready_at=? WHERE media_id=? AND revision=?',(time.time()+30,key['media_id'],key['revision']))
                        continue
                    if root:
                        try:
                            result=self.process(key,cancelled,self.gate)
                            success,error=result
                            committed=isinstance(result,CommittedThumbnail) and success
                        except Exception as exc:
                            if not cancelled.is_set():success=False;error=str(exc)
                with self.gate:
                    if committed:
                        # A stop/retry may arrive AFTER the durable commit.
                        # Count that publication, but never finish/delete a
                        # newer revision or falsely leave this one pending.
                        with self.lock:self.published+=1
                    elif not cancelled.is_set() and not self.stop.is_set():
                        if self.jobs.finish(key,success,error) and success and job:
                            with self.lock:self.published+=1
                with self.lock:self.error=''
            except Exception as exc:
                with self.lock:self.error=f'封面任务暂时停止：{exc}'
                self.wake.wait(2)
            finally:
                with self.lock:self.current=None


class DeferredThumbnails:
    """One worker; jobs survive cancellation/exit without retaining source paths in RAM."""
    def __init__(self,manager,process,jobs):
        self.manager=manager;self.process=process;self.jobs=jobs
        self.wake=threading.Event();self.finished=threading.Event();self.failure=None
        self.thread=threading.Thread(target=self.run,name='avhub-thumbnails',daemon=True)

    def __enter__(self):
        self.manager.thumbnail_pending(self.jobs.count());self.thread.start();return self

    def submit(self,*job):
        if self.manager.cancelled.is_set():return
        # Count and publication are ordered under the manager lock so a fast
        # worker cannot complete before the pending counter is incremented.
        with self.manager.lock:
            if self.jobs.schedule(*job):self.manager.thumbnail_pending(1)
        self.wake.set()

    def activate(self,root_id):
        # Offline roots are deliberately not activated: their persisted jobs
        # survive, without touching disconnected disks from the image worker.
        with self.manager.lock:self.manager.thumbnail_pending(self.jobs.activate(root_id))
        self.wake.set()

    def run(self):
        try:
            while not self.manager.cancelled.is_set():
                self.wake.clear();pending=self.jobs.next()
                if pending is None:
                    if self.finished.is_set():return
                    self.wake.wait(.2);continue
                key,job=pending
                try:success=self.process(*job) if job else True
                except Exception as exc:
                    self.manager.error(key['path'],str(exc));success=False
                if self.manager.cancelled.is_set():return  # Keep the job for the next refresh/resume.
                with self.manager.lock:
                    if self.jobs.finish(key,bool(success)):
                        self.manager.thumbnail_pending(-1)
                        if not success:self.manager.error(key['path'],'预览图未生成；文件可能已变化、离线或无法解码。稍后刷新可重试')
        except Exception as exc:
            self.failure=exc;self.manager.cancelled.set()

    def __exit__(self,exc_type,*_):
        if exc_type:self.manager.cancelled.set()
        self.finished.set();self.wake.set();self.thread.join()
        if self.failure:raise RuntimeError('封面任务存储失败，请检查数据目录或重试扫描') from self.failure
