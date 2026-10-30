"""Pin generated cover paths from response construction through disconnect."""
import threading
import weakref
from contextlib import contextmanager
from pathlib import Path
from starlette.responses import FileResponse

lock=threading.RLock()
_readers={}


def key(path):return str(Path(path).resolve()).casefold()


def active(path):
    with lock:return bool(_readers.get(key(path)))


@contextmanager
def pin(paths):
    """Protect a snapshot's paths without retaining one OS handle per image."""
    tokens={key(path) for path in paths}
    with lock:
        for token in tokens:_readers[token]=_readers.get(token,0)+1
    try:yield
    finally:
        with lock:
            for token in tokens:
                count=_readers[token]-1
                if count:_readers[token]=count
                else:del _readers[token]


class PinnedArtworkResponse(FileResponse):
    def __init__(self,path,**kwargs):
        super().__init__(path,**kwargs)
        token=key(path)
        with lock:_readers[token]=_readers.get(token,0)+1
        def release():
            with lock:
                count=_readers.get(token,1)-1
                if count:_readers[token]=count
                else:_readers.pop(token,None)
        # Direct route unit tests may inspect .path without invoking ASGI.
        self._release=weakref.finalize(self,release)

    async def __call__(self,scope,receive,send):
        try:return await super().__call__(scope,receive,send)
        finally:self._release()
