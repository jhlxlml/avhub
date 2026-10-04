"""Single background scan with observable progress and cooperative cancellation."""
import copy
import threading
import time
import uuid
from queue import Queue, Full
from fastapi import HTTPException


class ScanManager:
    def __init__(self, checkpoint=None,on_timeout=None):
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.thread = None
        self.job = None
        self.checkpoint = checkpoint
        self.preserve_checkpoint = False
        self.on_timeout=on_timeout

    def _save_checkpoint(self, root_id, state):
        if self.checkpoint:
            try:
                self.checkpoint(root_id, state)
            except Exception:
                # A diagnostics/recovery marker must never stop a library scan.
                pass

    def restore_interrupted(self, root_id):
        with self.lock:
            self.job = {'id': uuid.uuid4().hex, 'root_id': root_id, 'state': 'interrupted',
                        'total': 0, 'processed': 0, 'updated': 0, 'current': '', 'error_count': 0,
                        'errors': [], 'started_at': time.time(), 'finished_at': time.time()}

    def busy(self):
        return self.thread is not None and self.thread.is_alive()

    def require_idle(self):
        if self.busy():
            raise HTTPException(409, "扫描正在进行，请完成或取消后再修改目录")

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.job)

    def update(self, **values):
        with self.lock:
            self.job.update(values)

    def advance(self, updated=False):
        with self.lock:
            self.job['processed'] += 1
            self.job['updated'] += int(updated)

    def discovered(self):
        with self.lock:
            self.job['total'] += 1

    def thumbnail_pending(self, delta):
        with self.lock:
            self.job['thumbnails_pending'] = self.job.get('thumbnails_pending', 0) + delta

    def error(self, path, message):
        with self.lock:
            self.job['error_count'] += 1
            if len(self.job['errors']) < 20:
                self.job['errors'].append({'path': str(path), 'message': str(message)})

    def start(self, root_id, runner):
        with self.lock:
            self.require_idle()
            self.cancelled.clear()
            self.preserve_checkpoint = False
            self.job = {'id': uuid.uuid4().hex, 'root_id': root_id, 'state': 'discovering',
                        'total': 0, 'processed': 0, 'updated': 0, 'current': '', 'error_count': 0,
                        'errors': [], 'started_at': time.time(), 'finished_at': None,
                        'discovery_done': False, 'thumbnails_pending': 0}
            self._save_checkpoint(root_id, 'active')

            def run():
                try:
                    runner(self)
                    state = ('interrupted' if self.preserve_checkpoint else 'cancelled') if self.cancelled.is_set() else 'completed'
                    self.update(state=state)
                except Exception as exc:
                    self.error('', str(exc))
                    self.update(state='failed')
                finally:
                    self.update(finished_at=time.time(), current='')
                    self._save_checkpoint(root_id, 'interrupted' if self.preserve_checkpoint and self.cancelled.is_set() else 'finished')

            self.thread = threading.Thread(target=run, name='avhub-scan', daemon=True)
            self.thread.start()
            return copy.deepcopy(self.job)

    def cancel(self, preserve=False):
        with self.lock:
            if self.busy():
                self.preserve_checkpoint = self.preserve_checkpoint or preserve
                self.cancelled.set()
                self.job['state'] = 'cancelling'
            return copy.deepcopy(self.job)

    def pause_for_shutdown(self):
        return self.cancel(preserve=True)

    def close(self,timeout=5):
        self.pause_for_shutdown()
        thread=self.thread
        if thread and thread is not threading.current_thread():thread.join(timeout=timeout)
        finished=not thread or not thread.is_alive()
        if not finished and self.on_timeout:
            job=self.job or {}
            self.on_timeout('metadata-close-timeout',{'state':job.get('state'),'processed':job.get('processed'),
                'total':job.get('total'),'cancel_requested':self.cancelled.is_set()})
        return finished


class ScanThumbnailQueue:
    """One thumbnail worker with bounded backpressure, owned by a single scan."""
    def __init__(self, manager, process):
        self.manager = manager
        self.process = process
        self.queue = Queue(maxsize=32)
        self.thread = threading.Thread(target=self._run, name='avhub-thumbnails', daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def submit(self, *job):
        self.manager.thumbnail_pending(1)
        while not self.manager.cancelled.is_set():
            try:
                self.queue.put(job, timeout=.2)
                return
            except Full:
                pass
        self.manager.thumbnail_pending(-1)

    def _run(self):
        while True:
            job = self.queue.get()
            try:
                if job is None:
                    return
                if not self.manager.cancelled.is_set():
                    try:
                        self.process(*job)
                    except Exception as exc:
                        self.manager.error(job[0], str(exc))
                self.manager.thumbnail_pending(-1)
            finally:
                self.queue.task_done()

    def __exit__(self, exc_type, *_):
        if exc_type:
            self.manager.cancelled.set()
        self.queue.put(None)
        self.thread.join()
