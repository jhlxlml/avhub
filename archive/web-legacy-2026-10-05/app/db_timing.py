"""Bounded, source-path-free timing evidence for local diagnostics."""
from collections import deque
import threading
import time
from contextlib import contextmanager


class ReadGate:
    """Concurrent readers; exclusive, starvation-free library replacement."""
    def __init__(self):
        self.condition=threading.Condition();self.readers=0;self.writer=False;self.waiting=0

    @contextmanager
    def read(self):
        with self.condition:
            self.condition.wait_for(lambda:not self.writer and not self.waiting)
            self.readers+=1
        try:yield
        finally:
            with self.condition:self.readers-=1;self.condition.notify_all()

    @contextmanager
    def write(self):
        with self.condition:
            self.waiting+=1
            try:self.condition.wait_for(lambda:not self.writer and self.readers==0);self.writer=True
            finally:self.waiting-=1;self.condition.notify_all()
        try:yield
        finally:
            with self.condition:self.writer=False;self.condition.notify_all()


class DatabaseTiming:
    def __init__(self,on_slow=None):
        self.lock=threading.Lock();self.samples=deque(maxlen=512);self.slow=deque(maxlen=32)
        self.on_slow=on_slow;self.last_capture=float('-inf')

    def record(self,kind,stages):
        sample={'kind':kind,**{key:round(value*1000,3) for key,value in stages.items()}}
        capture=False
        with self.lock:
            self.samples.append(sample)
            if sample['total']>=100:
                self.slow.append({**sample,'at':round(time.time(),3),'thread':threading.current_thread().name})
            if self.on_slow and sample['total']>=1000 and time.monotonic()-self.last_capture>=60:
                self.last_capture=time.monotonic();capture=True
        if capture:
            # Never save a diagnostic file under the SQLite transaction lock.
            threading.Thread(target=self.on_slow,args=(sample,),name='avhub-slow-query-evidence',daemon=True).start()

    def report(self):
        with self.lock:samples=list(self.samples);slow=list(self.slow)
        groups={}
        for kind in sorted({row['kind'] for row in samples}):
            rows=[row for row in samples if row['kind']==kind];summary={}
            for stage in rows[0]:
                if stage=='kind':continue
                values=sorted(row[stage] for row in rows)
                summary[stage]={'p95_ms':values[min(len(values)-1,int(len(values)*.95))],'max_ms':values[-1]}
            groups[kind]={'count':len(rows),'stages':summary}
        return {'capacity':512,'groups':groups,'slowest':sorted(samples,key=lambda row:row['total'],reverse=True)[:8],
                'slow_threshold_ms':100,'slow_capacity':32,'slow_operations':slow}


timing=DatabaseTiming()
