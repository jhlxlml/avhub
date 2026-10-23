"""Bounded, source-path-free timing evidence for local diagnostics."""
from collections import deque
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar

OPERATIONS=frozenset({'progress-save','scan-media','cover-publish','schema-bootstrap',
    'cover-queue','scan-checkpoint','scan-reconcile'})


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
        self.lifetime={};self.worst=[];self.omitted_groups=0
        self.operations={}
        self.on_slow=on_slow;self.last_capture=float('-inf')
        self.sequence=0;self.active_writer=None;self.saves=deque(maxlen=32)
        self.context=ContextVar('avhub_database_operation',default=None)

    @contextmanager
    def scope(self,operation):
        # Fixed code-owned labels only: never request URLs, file paths, media
        # titles, SQL text or arbitrary client-provided strings.
        if operation not in OPERATIONS:raise ValueError('Unknown database operation')
        with self.lock:self.sequence+=1;scope={'scope_id':self.sequence,'operation':operation}
        token=self.context.set(scope)
        try:yield dict(scope)
        finally:self.context.reset(token)

    def begin_serialized(self):
        with self.lock:
            self.sequence+=1
            ticket={'connection_id':self.sequence,**(self.context.get() or {'operation':'unlabelled'})}
            # A wait can span several writers. This is the writer observed at
            # queue entry, NOT proof that it caused the whole wait.
            if self.active_writer:
                for key in ('connection_id','operation','scope_id'):
                    if key in self.active_writer:ticket['observed_writer_'+key]=self.active_writer[key]
            return ticket

    def current_scope(self):
        """Copy fixed operation/correlation labels; no mutation of the context."""
        return dict(self.context.get() or {})

    @contextmanager
    def writer(self,ticket):
        with self.lock:previous=self.active_writer;self.active_writer=ticket
        try:yield
        finally:
            with self.lock:self.active_writer=previous

    def record(self,kind,stages,trace=None):
        sample={'kind':kind,**{key:round(value*1000,3) for key,value in stages.items()}}
        capture=False
        with self.lock:
            self.samples.append(sample)
            details=trace or self.context.get() or {}
            # Fixed labels only; never group by request URLs, SQL or paths.
            if kind in {'serialized','read'}:
                label=details.get('operation','unlabelled')
                if label not in OPERATIONS:label='unlabelled'
                key=kind+':'+label
                group=self.operations.setdefault(key,{'kind':kind,'operation':label,'count':0,
                    'slow_count':0,'changed_rows':0,'open_transactions':0,'attempted_commits':0,'max_ms':{},'sum_ms':{},'worst_commit':None})
                group['count']+=1;group['slow_count']+=int(sample['total']>=100)
                group['changed_rows']+=max(0,details.get('changed_rows',0))
                group['open_transactions']+=int(details.get('transaction_open_at_commit',False))
                group['attempted_commits']+=int(details.get('commit_attempted',False))
                for stage,value in sample.items():
                    if stage!='kind':
                        group['max_ms'][stage]=max(group['max_ms'].get(stage,0),value)
                        group['sum_ms'][stage]=group['sum_ms'].get(stage,0)+value
                if kind=='serialized' and (group['worst_commit'] is None or sample.get('commit',0)>group['worst_commit'].get('commit',0)):
                    group['worst_commit']={**sample,**{name:details[name] for name in ('connection_id','scope_id',
                        'changed_rows','transaction_open_at_commit','transaction_outcome','commit_attempted') if name in details}}
            saving=kind=='serialized' and details.get('operation')=='progress-save'
            if saving or sample['total']>=100:
                evidence={**sample,**details,'at':round(time.time(),3),'thread':threading.current_thread().name}
                if saving:self.saves.append(evidence)
            # Rolling percentiles cannot describe the whole run. Keep bounded
            # all-run counters/maxima and the worst operations, so early slow
            # commits do not disappear after 512 fast reads or 32 later events.
            if kind in self.lifetime or len(self.lifetime)<8:
                group=self.lifetime.setdefault(kind,{'count':0,'slow_count':0,'max_ms':{}})
                group['count']+=1;group['slow_count']+=int(sample['total']>=100)
                for stage,value in sample.items():
                    if stage!='kind':group['max_ms'][stage]=max(group['max_ms'].get(stage,0),value)
            else:self.omitted_groups+=1
            if sample['total']>=100:
                self.slow.append(evidence)
                self.worst=sorted([*self.worst,evidence],key=lambda row:row['total'],reverse=True)[:8]
            if self.on_slow and sample['total']>=1000 and time.monotonic()-self.last_capture>=60:
                self.last_capture=time.monotonic();capture=True
        if capture:
            # Never save a diagnostic file under the SQLite transaction lock.
            threading.Thread(target=self.on_slow,args=(dict(evidence),),name='avhub-slow-query-evidence',daemon=True).start()

    def report(self):
        with self.lock:
            samples=list(self.samples);slow=list(self.slow)
            lifetime={kind:{**row,'max_ms':dict(row['max_ms'])} for kind,row in self.lifetime.items()}
            worst=[dict(row) for row in self.worst];omitted=self.omitted_groups
            saves=[dict(row) for row in self.saves]
            operations={key:{**row,'max_ms':dict(row['max_ms']),
                'sum_ms':{stage:round(value,3) for stage,value in row['sum_ms'].items()},
                'worst_commit':dict(row['worst_commit']) if row['worst_commit'] else None}
                for key,row in self.operations.items()}
        groups={}
        for kind in sorted({row['kind'] for row in samples}):
            rows=[row for row in samples if row['kind']==kind];summary={}
            for stage in rows[0]:
                if stage=='kind':continue
                values=sorted(row[stage] for row in rows)
                summary[stage]={'p95_ms':values[min(len(values)-1,int(len(values)*.95))],'max_ms':values[-1]}
            groups[kind]={'count':len(rows),'stages':summary}
        return {'capacity':512,'groups':groups,'slowest':sorted(samples,key=lambda row:row['total'],reverse=True)[:8],
                'slow_threshold_ms':100,'slow_capacity':32,'slow_operations':slow,
                'save_trace':{'capacity':32,'operations':saves,'writer_observation':'at-queue-entry-not-exclusive-cause'},
                'operation_lifetime':{'capacity':2*(len(OPERATIONS)+1),'groups':operations,
                    'changes_semantics':'SQLite total_changes at commit attempt; not durable rows, body-aborted attempts are not measured'},
                'lifetime':{'group_capacity':8,'groups':lifetime,'worst_capacity':8,'worst_operations':worst,'omitted_operations':omitted}}


timing=DatabaseTiming()
