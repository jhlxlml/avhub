import unittest
from contextlib import contextmanager
from fastapi import HTTPException
from app.native_playback import NativeReadLeases
import threading


class Service:
    def __init__(self):
        self.lock=threading.RLock();self.readers={};self.blocked=False

    @contextmanager
    def reader(self,media_id):
        if self.blocked:raise HTTPException(409,'busy')
        self.readers[media_id]=self.readers.get(media_id,0)+1
        try:yield
        finally:
            self.readers[media_id]-=1
            if not self.readers[media_id]:del self.readers[media_id]


class NativeLeasesTest(unittest.TestCase):
    def test_non_expiring_reader_and_exact_owner_release(self):
        service=Service();leases=NativeReadLeases(service)
        self.assertEqual(leases.acquire('owner',4,lambda _: 'indexed path'),'indexed path')
        leases.release('other');self.assertEqual(service.readers,{4:1})
        with self.assertRaises(HTTPException):leases.acquire('other',5,lambda _: 'other')
        leases.release('owner');leases.release('owner');self.assertEqual(service.readers,{})

    def test_failed_resolution_and_busy_never_leak(self):
        service=Service();leases=NativeReadLeases(service)
        def fail(_):raise HTTPException(404,'missing')
        with self.assertRaises(HTTPException):leases.acquire('owner',4,fail)
        self.assertEqual(service.readers,{})
        service.blocked=True
        with self.assertRaises(HTTPException):leases.acquire('owner',4,lambda _: 'path')
        self.assertEqual(leases.leases,{})

    def test_engine_preference_allowlist(self):
        from app.preferences import validate
        self.assertEqual(validate('playerEngine','mpv'),'mpv')
        self.assertEqual(validate('playerEngine','chromium'),'chromium')
        for value in ['auto','external',{},True,None]:
            with self.assertRaises(HTTPException):validate('playerEngine',value)
        for value in ['embedded','independent']:
            self.assertEqual(validate('mpvWindowMode',value),value)
        for value in ['auto','external',{},True,None,1]:
            with self.assertRaises(HTTPException):validate('mpvWindowMode',value)
        for value in ('exact','fast','smart'):
            self.assertEqual(validate('mpvSeekPolicy',value),value)
        for value in ('auto','keyframe',None,True,{},1):
            with self.assertRaises(HTTPException):validate('mpvSeekPolicy',value)
        for key in ('nativeRenderEnabled','playbackSessionCoordinatorEnabled'):
            for value in (True, False):
                self.assertEqual(validate(key,value),value)
            for value in (1,'true',None,{}):
                with self.assertRaises(HTTPException):validate(key,value)

    def test_late_acquisition_after_cancellation_is_rejected(self):
        service=Service();leases=NativeReadLeases(service)
        leases.release('cancelled')
        with self.assertRaises(HTTPException):leases.acquire('cancelled',4,lambda _: 'path')
        self.assertEqual(service.readers,{})


if __name__=='__main__':unittest.main()
