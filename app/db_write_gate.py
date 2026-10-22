"""Reentrant, serialized DB gate with bounded preference for durable saves."""
from collections import deque
from contextlib import contextmanager
import math
import threading
import time


class SavePriorityLock:
    def __init__(self,save_burst=4):
        if type(save_burst) is not int or not 1<=save_burst<=16:raise ValueError('Invalid save burst')
        self.condition=threading.Condition();self.owner=None;self.depth=0
        self.normal=deque();self.saves=deque();self.burst=0;self.limit=save_burst
        self.served_normal=0;self.served_saves=0;self.promotions=0

    def acquire(self,blocking=True,timeout=-1,*,save=False):
        if not blocking and timeout!=-1:raise ValueError('timeout with nonblocking acquire')
        if timeout!=-1 and (timeout<0 or not math.isfinite(timeout)):raise ValueError('Invalid timeout')
        if timeout>threading.TIMEOUT_MAX:raise OverflowError('Timeout too large')
        ident=threading.get_ident();deadline=time.monotonic()+timeout if timeout>=0 else None
        with self.condition:
            if self.owner==ident:self.depth+=1;return True
            if not blocking and (self.owner is not None or self.normal or self.saves):return False
            queue=self.saves if save else self.normal;ticket=object();queue.append(ticket)
            try:
                while True:
                    preferred=self.saves if self.saves and (not self.normal or self.burst<self.limit) else self.normal
                    if self.owner is None and preferred and preferred[0] is ticket:
                        queue.popleft();self.owner=ident;self.depth=1
                        if save:
                            self.served_saves+=1;self.promotions+=int(bool(self.normal))
                            self.burst=self.burst+1 if self.normal else 0
                        else:self.served_normal+=1;self.burst=0
                        return True
                    remaining=None if deadline is None else deadline-time.monotonic()
                    if not blocking or remaining is not None and remaining<=0:return False
                    self.condition.wait(remaining)
            finally:
                # Timeout/exception must not strand a dead ticket at the head.
                if ticket in queue:queue.remove(ticket);self.condition.notify_all()

    def release(self):
        with self.condition:
            if self.owner!=threading.get_ident():raise RuntimeError('Cannot release unowned DB gate')
            self.depth-=1
            if not self.depth:self.owner=None;self.condition.notify_all()

    def __enter__(self):self.acquire();return self
    def __exit__(self,*_):self.release()

    @contextmanager
    def save(self):
        self.acquire(save=True)
        try:yield self
        finally:self.release()

    def status(self):
        with self.condition:
            return {'policy':'serialized-save-priority','save_burst_limit':self.limit,
                'waiting_saves':len(self.saves),'waiting_normal':len(self.normal),
                'served_saves':self.served_saves,'served_normal':self.served_normal,
                'save_promotions':self.promotions}
