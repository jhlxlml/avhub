"""Admission budget for background metadata/cover reads, not video delivery.

At most two jobs globally, two per local drive and one per UNC share. Brief playback preparation
reservations delay NEW background jobs only; running jobs are never killed here.
Reservations expire and cannot extend beyond 15 seconds without a quiet edge.
No source paths are retained in diagnostics or caches.
"""
import ntpath
import threading
import time
from contextlib import contextmanager


class ReadCancelled(Exception):
    pass


class ReadBudget:
    def __init__(self, limit=2, clock=time.monotonic, per_drive=2):
        self.limit=limit;self.per_drive=per_drive;self.clock=clock;self.condition=threading.Condition()
        self.running=0;self.drives={};self.waiting=[];self.urgent={}
        self.admitted=0;self.delayed=0

    def activity(self, owner, urgent):
        with self.condition:
            now=self.clock()
            self.urgent={key:value for key,value in self.urgent.items() if now-value[2]<20}
            if not urgent:self.urgent.pop(owner,None)
            elif owner in self.urgent:
                first,_,_=self.urgent[owner];self.urgent[owner]=(first,min(first+15,now+4),now)
            elif len(self.urgent)<128:self.urgent[owner]=(now,now+4,now)
            self.condition.notify_all()

    def yielding(self):
        now=self.clock()
        # Keep exhausted owners until a quiet edge; a stuck heartbeat must not
        # keep re-creating an infinite high-priority reservation.
        return any(expiry>now for _,expiry,_ in self.urgent.values())

    def snapshot(self):
        with self.condition:
            return dict(active=self.running,waiting=len(self.waiting),yielding=self.yielding(),admitted=self.admitted,delayed=self.delayed,global_limit=self.limit,per_drive_limit=self.per_drive,per_share_limit=1)

    @contextmanager
    def slot(self, path, cancelled=None):
        drive=ntpath.splitdrive(str(path))[0].casefold() or 'local'
        ticket=(object(),drive);acquired=False;delayed=False
        with self.condition:
            self.waiting.append(ticket)
            try:
                while True:
                    if cancelled and cancelled.is_set():raise ReadCancelled()
                    eligible=next((entry for entry in self.waiting if self.drives.get(entry[1],0)<(1 if entry[1].startswith('\\\\') else self.per_drive)),None)
                    if self.running<self.limit and not self.yielding() and eligible is ticket:
                        self.running+=1;self.drives[drive]=self.drives.get(drive,0)+1;self.admitted+=1;acquired=True;break
                    if not delayed:self.delayed+=1;delayed=True
                    self.condition.wait(.1)
            finally:
                self.waiting.remove(ticket);self.condition.notify_all()
        try:yield
        finally:
            if acquired:
                with self.condition:
                    self.running-=1;self.drives[drive]-=1
                    if not self.drives[drive]:self.drives.pop(drive)
                    self.condition.notify_all()
