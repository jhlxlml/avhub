"""Bounded shutdown evidence. Never capture frame locals or source paths."""
import json
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path


class RuntimeEvidence:
    def __init__(self, directory):
        self.directory=directory;self.lock=threading.Lock();self.events=[];self.error=''

    def capture(self, component, state):
        previous=self.report()['events']
        event={'at':time.time(),'component':component,'state':state,'threads':[]}
        frames=sys._current_frames()
        threads=sorted(threading.enumerate(),key=lambda thread:not thread.name.startswith('avhub'))
        event['omitted_threads']=max(0,len(threads)-32)
        for thread in threads[:32]:
            frame=frames.get(thread.ident)
            if frame:
                event['threads'].append({'name':thread.name,'alive':thread.is_alive(),
                    'stack':[{'file':Path(item.filename).name,'line':item.lineno,'function':item.name}
                             for item in traceback.extract_stack(frame,limit=16)]})
        with self.lock:
            self.events=((self.events or previous)+[event])[-8:]
            temporary=None
            try:
                parent=Path(self.directory())/'diagnostics';parent.mkdir(parents=True,exist_ok=True)
                temporary=parent/f'.worker-{uuid.uuid4().hex}.json'
                temporary.write_text(json.dumps({'version':1,'events':self.events},ensure_ascii=False,indent=2),encoding='utf-8')
                temporary.replace(parent/'worker-timeouts.json');self.error=''
            except OSError:
                self.error='退出现场无法保存，请检查数据目录权限或磁盘空间'
            finally:
                if temporary:
                    try:temporary.unlink(missing_ok=True)
                    except OSError:pass

    def report(self):
        with self.lock:events=list(self.events);error=self.error
        if not events:
            try:
                path=Path(self.directory())/'diagnostics'/'worker-timeouts.json'
                if path.stat().st_size<=1024*1024:
                    data=json.loads(path.read_text(encoding='utf-8'))
                    if data.get('version')==1 and isinstance(data.get('events'),list):events=data['events'][-8:]
            except (OSError,ValueError,AttributeError):pass
        return {'capacity':8,'events':events,'error':error}
