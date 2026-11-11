"""Desktop startup milestones; never print tokens, media paths or user metadata."""
import faulthandler
import json
import os
import sys
import time

_started=time.perf_counter()
_desktop=bool(os.environ.get('AVHUB_SESSION_TOKEN'))
_armed=False
_ready=False


def mark(stage):
    if _desktop and not _ready:
        print('backend-startup-stage '+json.dumps({'stage':stage,'elapsed_ms':round((time.perf_counter()-_started)*1000,1),'pid':os.getpid()}),file=sys.stderr,flush=True)


def begin():
    global _armed
    if _desktop and not _armed:
        faulthandler.dump_traceback_later(10,repeat=True,file=sys.stderr)
        _armed=True
    mark('python-entry')


def ready():
    global _armed,_ready
    if _ready:return
    mark('health-ready')
    _ready=True
    if _armed:
        faulthandler.cancel_dump_traceback_later()
        _armed=False
