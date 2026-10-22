"""Bounded observation of the existing reentrant publication mutex, not a scheduler."""
from collections import deque
from contextlib import contextmanager
import threading
import time
from .db_timing import OPERATIONS


class PublicationGate:
    def __init__(self,scope=None):
        self.mutex=threading.RLock();self.state=threading.Lock();self.local=threading.local()
        self.scope=scope or (lambda:{})
        self.sequence=0;self.active=None;self.waiting=0;self.peak_waiting=0;self.reentrant=0
        self.groups={};self.recent=deque(maxlen=32);self.slow=deque(maxlen=32);self.worst=[]

    @contextmanager
    def hold(self):
        depth=getattr(self.local,'depth',0)
        if depth:
            with self.mutex:
                self.local.depth=depth+1
                with self.state:self.reentrant+=1
                try:yield self
                finally:self.local.depth=depth
            return
        started=time.perf_counter();scope=self.scope() or {};label=scope.get('operation','unlabelled')
        if label not in OPERATIONS:label='unlabelled'
        with self.state:
            self.sequence+=1;ticket={'gate_id':self.sequence,'operation':label}
            if type(scope.get('scope_id')) is int and scope['scope_id']>0:ticket['scope_id']=scope['scope_id']
            if self.active:
                for key in ('gate_id','operation','scope_id'):
                    if key in self.active:ticket['observed_holder_'+key]=self.active[key]
        acquired=self.mutex.acquire(blocking=False);contended=not acquired
        if not acquired:
            with self.state:self.waiting+=1;self.peak_waiting=max(self.peak_waiting,self.waiting)
            try:self.mutex.acquire()
            finally:
                with self.state:self.waiting-=1
        entered=time.perf_counter();self.local.depth=1;outcome='failed'
        with self.state:self.active={**ticket,'entered':entered}
        try:
            yield self
            outcome='completed'
        finally:
            ended=time.perf_counter();self.local.depth=0
            sample={**ticket,'contended':contended,'outcome':outcome,
                'wait_ms':round((entered-started)*1000,3),
                'hold_ms':round((ended-entered)*1000,3),'total_ms':round((ended-started)*1000,3)}
            # Release under the small stats mutex so the next owner cannot
            # publish itself and then be erased by this owner's cleanup.
            with self.state:
                self.active=None;self.mutex.release()
                group=self.groups.setdefault(label,{'count':0,'contended':0,'failed':0,'max_ms':{},'sum_ms':{}})
                group['count']+=1;group['contended']+=int(contended);group['failed']+=int(outcome=='failed')
                for key in ('wait_ms','hold_ms','total_ms'):
                    stage=key[:-3];group['max_ms'][stage]=max(group['max_ms'].get(stage,0),sample[key])
                    group['sum_ms'][stage]=group['sum_ms'].get(stage,0)+sample[key]
                self.recent.append(sample)
                if sample['total_ms']>=100:self.slow.append(sample)
                self.worst=sorted([*self.worst,sample],key=lambda row:row['total_ms'],reverse=True)[:8]

    def __enter__(self):
        context=self.hold();value=context.__enter__()
        stack=getattr(self.local,'contexts',None)
        if stack is None:stack=[];self.local.contexts=stack
        stack.append(context);return value

    def __exit__(self,*args):return self.local.contexts.pop().__exit__(*args)

    def report(self):
        with self.state:
            active={key:value for key,value in self.active.items() if key!='entered'} if self.active else None
            if active:active['held_ms']=round((time.perf_counter()-self.active['entered'])*1000,3)
            return {'policy':'observe-existing-rlock','group_capacity':len(OPERATIONS)+1,
                'groups':{label:{**row,'max_ms':dict(row['max_ms']),
                    'sum_ms':{key:round(value,3) for key,value in row['sum_ms'].items()}}
                    for label,row in self.groups.items()},
                'active':active,'waiting':self.waiting,'peak_waiting':self.peak_waiting,
                'reentrant_entries':self.reentrant,'recent_capacity':32,'recent':[dict(row) for row in self.recent],
                'slow_threshold_ms':100,'slow_capacity':32,'slow':[dict(row) for row in self.slow],
                'worst_capacity':8,'worst':[dict(row) for row in self.worst],
                'semantics':'outermost holds only; wait includes entry bookkeeping; holder observed at entry is not exclusive cause; not added to database total'}
