"""Bounded, path-free evidence for maintenance and best-effort service cleanup."""
import asyncio
import logging
import threading
import time


class ServiceLifecycle:
    def __init__(self):
        self.lock=threading.Lock();self.steps={};self.logger=logging.getLogger('avhub.lifecycle')

    def outcome(self,name,error=None):
        # Names come only from the fixed internal step list, never user input.
        with self.lock:
            if name not in self.steps and len(self.steps)>=24:return
            row=self.steps.setdefault(name,{'attempts':0,'failures':0,'consecutive_failures':0,
                'error':None,'last_error':None,'last_failure_at':None,'last_success_at':None,'logged_at':float('-inf')})
            row['attempts']+=1
            if error is None:
                row['consecutive_failures']=0;row['error']=None;row['last_success_at']=round(time.time(),3)
                return
            row['failures']+=1;row['consecutive_failures']+=1
            row['error']=row['last_error']=type(error).__name__;row['last_failure_at']=round(time.time(),3)
            emit=time.monotonic()-row['logged_at']>=60
            if emit:row['logged_at']=time.monotonic()
        if emit:self.logger.warning('Service step %s failed (%s)',name,type(error).__name__)

    async def attempt(self,name,operation,*,threaded=True,require_completed=False):
        try:
            result=await asyncio.to_thread(operation) if threaded else operation()
            if require_completed and result is False:raise RuntimeError('Worker cleanup did not complete')
        except Exception as error:
            self.outcome(name,error)
            return error
        # CancelledError is deliberately not swallowed or marked successful.
        self.outcome(name)
        return None

    def report(self):
        with self.lock:
            return {'capacity':24,'steps':{name:{key:value for key,value in row.items() if key!='logged_at'}
                for name,row in self.steps.items()}}
