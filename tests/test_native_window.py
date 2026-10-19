import unittest
from fastapi import HTTPException
from app.native_window import raise_owned_surface,WindowsSurface


class Windows:
    def __init__(self):
        self.rows={10:(100,0,'host'),20:(200,10,'mpv'),30:(300,10,'Intermediate D3D Window')}
        self.raised=[]
        self.success=True
    def pid(self,window):return self.rows.get(window,(0,0,''))[0]
    def parent(self,window):return self.rows[window][1]
    def class_name(self,window):return self.rows[window][2]
    def children(self,window):return [key for key in self.rows if key!=window]
    def raise_child(self,window):self.raised.append(window);return self.success


class NativeWindowTest(unittest.TestCase):
    def test_current_dpi_scales_client_and_clip_once_with_negative_desktop_origin(self):
        # Explicit Win32 contract simulation, not a physical mixed-DPI display.
        class API:
            dpi=96
            def __init__(self):self.positions=[];self.contexts=[];self.regions=[]
            def SetThreadDpiAwarenessContext(self,value):self.contexts.append(value);return 7
            def GetDpiForWindow(self,window):return self.dpi
            def GetWindowLongPtrW(self,window,index):return 0x46000000 if window==20 else 0x80000000
            def ClientToScreen(self,window,point):point._obj.x-=1920;point._obj.y+=80;return True
            def SetWindowPos(self,*args):self.positions.append(args);return True
            def SetWindowRgn(self,*args):return True
            def ShowWindowAsync(self,*args):return True
            def CreateRectRgn(self,*args):self.regions.append(args);return len(self.regions)
        surface=object.__new__(WindowsSurface);api=API();surface.api=api;surface.gdi=api
        surface.pid=lambda window:123;surface.parent=lambda window:10;surface.owner=lambda window:10
        rect={'x':24.4,'y':100.2,'width':1000.8,'height':560.4,'clip':{'x':1.1,'y':22.5,'width':999,'height':520},'visible':True}
        for dpi in (96,120,144,96):
            api.dpi=dpi;scale=dpi/96
            self.assertEqual(surface.embed(10,20,30,123,rect),{'embedded':True})
            host,overlay=api.positions[-2:]
            expected=[round(rect[key]*scale) for key in ('x','y','width','height')]
            self.assertEqual(list(host[2:6]),expected)
            self.assertEqual(list(overlay[2:6]),[expected[0]-1920,expected[1]+80,*expected[2:]])
            clip=rect['clip'];self.assertEqual(api.regions[-1],tuple(round(value*scale) for value in (clip['x'],clip['y'],clip['x']+clip['width'],clip['y']+clip['height'])))
            self.assertEqual(api.contexts[-1],7,'restore caller DPI context even across scale changes')

    def test_embed_rejects_foreign_or_aliased_windows_before_os_calls(self):
        surface=object.__new__(WindowsSurface)
        surface.pid=lambda window: 123 if window!=30 else 999
        for values in [(10,20,30,123),(10,10,20,123),(10,20,40,999)]:
            with self.assertRaises(HTTPException):surface.embed(*values,{})

    def test_raise_only_exact_owned_decoder_child(self):
        windows=Windows()
        self.assertEqual(raise_owned_surface(windows,10,100,200),{'raised':True})
        self.assertEqual(windows.raised,[20])

    def test_stale_host_foreign_process_parent_and_class_are_rejected(self):
        for row in [(201,10,'mpv'),(200,99,'mpv'),(200,10,'other')]:
            windows=Windows();windows.rows[20]=row
            with self.assertRaises(HTTPException):raise_owned_surface(windows,10,100,200)
            self.assertEqual(windows.raised,[])
        windows=Windows()
        with self.assertRaises(HTTPException):raise_owned_surface(windows,10,999,200)
        self.assertEqual(windows.raised,[])

    def test_ambiguous_child_and_failed_os_operation_are_not_success(self):
        windows=Windows();windows.rows[40]=(200,10,'mpv')
        with self.assertRaises(HTTPException):raise_owned_surface(windows,10,100,200)
        self.assertEqual(windows.raised,[])
        windows=Windows();windows.success=False
        with self.assertRaises(HTTPException):raise_owned_surface(windows,10,100,200)


if __name__=='__main__':unittest.main()
