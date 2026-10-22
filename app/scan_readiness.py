"""Passive, bounded scan-stage observations. Never queue or delay real work."""
from collections import deque
from contextlib import contextmanager
import threading
import time


class Observation:
    def __init__(self,owner,key):self.owner=owner;self.key=key
    def probed(self):self.owner.mark(self.key,'probed')
    def ready(self):self.owner.mark(self.key,'ready')
    def writing(self,scope_id=None):self.owner.mark(self.key,'writing',scope_id)
    def committed(self):self.owner.mark(self.key,'committed')


class ScanReadiness:
    CAPACITY=8
    def __init__(self,cancelled_type=(),enabled=True):
        self.cancelled_type=cancelled_type;self.enabled=enabled
        self.lock=threading.Lock();self.active={};self.sequence=0;self.omitted=0;self.invalid=0
        self.peak_active=0;self.peak_ready=0;self.arrivals=[0]*9;self.writer_peers=[0]*9
        self.outcomes={key:0 for key in ('committed','cancelled','failed','abandoned')}
        self.stages={};self.recent=deque(maxlen=128);self.worst_wait=[]

    @contextmanager
    def item(self):
        if not self.enabled:
            yield Observation(self,None)
            return
        started=time.perf_counter()
        with self.lock:
            self.sequence+=1;key=self.sequence
            if len(self.active)>=self.CAPACITY:self.omitted+=1;key=None
            else:
                self.active[key]={'started':started,'stage':'probing'}
                self.peak_active=max(self.peak_active,len(self.active))
        error=None
        try:yield Observation(self,key)
        except BaseException as exc:error=exc;raise
        finally:self.finish(key,error)

    def mark(self,key,stage,scope_id=None):
        if key is None:return
        now=time.perf_counter()
        expected={'probed':'probing','ready':'preparing','writing':'ready','committed':'writing'}
        with self.lock:
            row=self.active.get(key)
            if row is None or row['stage']!=expected.get(stage):self.invalid+=1;return
            row[stage]=now
            row['stage']={'probed':'preparing','ready':'ready','writing':'writing','committed':'committed'}[stage]
            if stage=='ready':
                count=sum(r['stage']=='ready' for r in self.active.values())
                self.arrivals[count]+=1;self.peak_ready=max(self.peak_ready,count)
            elif stage=='writing':
                peers=[r for k,r in self.active.items() if k!=key and r['stage']=='ready']
                row['others_ready']=len(peers);self.writer_peers[len(peers)]+=1
                row['oldest_other_ms']=round(max((now-r['ready'] for r in peers),default=0)*1000,3)
                if type(scope_id) is int and scope_id>0:row['scope_id']=scope_id

    def finish(self,key,error):
        if key is None:return
        ended=time.perf_counter()
        with self.lock:
            row=self.active.pop(key)
            outcome='committed' if 'committed' in row else 'cancelled' if isinstance(error,self.cancelled_type) else 'failed' if error is not None else 'abandoned'
            self.outcomes[outcome]+=1
            sample={'item_id':key,'outcome':outcome,'last_stage':row['stage'],
                **{name:row[name] for name in ('scope_id','others_ready','oldest_other_ms') if name in row}}
            for stage,start,end in [('probe_and_budget','started','probed'),('prepare','probed','ready'),
                                    ('ready_wait','ready','writing'),('write','writing','committed')]:
                if end in row:
                    value=round((row[end]-row[start])*1000,3);sample[stage+'_ms']=value
                    group=self.stages.setdefault(stage,{'count':0,'sum_ms':0,'max_ms':0})
                    group['count']+=1;group['sum_ms']+=value;group['max_ms']=max(group['max_ms'],value)
            sample['total_ms']=round((ended-row['started'])*1000,3)
            self.recent.append(sample)
            self.worst_wait=sorted([*self.worst_wait,sample],key=lambda r:r.get('ready_wait_ms',0),reverse=True)[:8]

    def report(self):
        with self.lock:
            return {'policy':'observe-only-no-batching','enabled':self.enabled,'active_capacity':self.CAPACITY,
                'started':self.sequence,'omitted':self.omitted,'invalid_transitions':self.invalid,
                'active':{stage:sum(r['stage']==stage for r in self.active.values())
                    for stage in ('probing','preparing','ready','writing','committed')},
                'peak_active':self.peak_active,'peak_ready':self.peak_ready,
                'ready_at_arrival_counts':list(self.arrivals),'other_ready_at_writer_entry_counts':list(self.writer_peers),
                'outcomes':dict(self.outcomes),'stages':{key:{**row,'sum_ms':round(row['sum_ms'],3)} for key,row in self.stages.items()},
                'recent_capacity':128,'recent':[dict(row) for row in self.recent],
                'worst_wait_capacity':8,'worst_wait':[dict(row) for row in self.worst_wait],
                'semantics':'process lifetime; changed-file probes only; ready means validated metadata; entry after gate/writer/connect; stages overlap across workers; peers are an opportunity upper bound, not an implemented batch'}
