"""Narrow desktop bridge: raise only the owned MPV child within its host.

Electron's Views compositor creates an Intermediate D3D Window even for an
empty BaseWindow. It can sit above an embedded external renderer. No global
window ordering, focus, decoder settings or media files are changed here.
"""
import ctypes
import sys
from functools import lru_cache
from ctypes import wintypes
from fastapi import HTTPException


@lru_cache(maxsize=1)
def windows_surface():
    # Cache DLL bindings, not windows/regions; layout updates must not repeatedly
    # LoadLibrary or retain per-video native resources.
    return WindowsSurface()


def raise_owned_surface(api, host, host_pid, decoder_pid):
    if api.pid(host) != host_pid:
        raise HTTPException(409, '原生宿主窗口已失效')
    candidates = [child for child in api.children(host)
                  if api.parent(child) == host and api.pid(child) == decoder_pid
                  and api.class_name(child) == 'mpv']
    if len(candidates) != 1:
        raise HTTPException(409, '原生视频窗口尚未就绪')
    if not api.raise_child(candidates[0]):
        raise HTTPException(409, '无法调整原生视频显示层级')
    return {'raised': True}


class WindowsSurface:
    def __init__(self):
        if sys.platform != 'win32':
            raise HTTPException(409, '原生窗口桥接仅支持 Windows')
        api = ctypes.WinDLL('user32', use_last_error=True)
        self.api = api
        self.callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        api.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        api.GetWindowThreadProcessId.restype = wintypes.DWORD
        api.GetParent.argtypes = [wintypes.HWND]
        api.GetParent.restype = wintypes.HWND
        api.GetWindow.argtypes=[wintypes.HWND,wintypes.UINT]
        api.GetWindow.restype=wintypes.HWND
        api.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        api.GetClassNameW.restype = ctypes.c_int
        api.EnumChildWindows.argtypes = [wintypes.HWND, self.callback_type, wintypes.LPARAM]
        api.EnumChildWindows.restype = wintypes.BOOL
        api.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
        api.SetWindowPos.restype = wintypes.BOOL
        api.SetParent.argtypes = [wintypes.HWND,wintypes.HWND]
        api.SetParent.restype = wintypes.HWND
        api.ClientToScreen.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.POINT)]
        api.ClientToScreen.restype=wintypes.BOOL
        api.GetWindowLongPtrW.argtypes = [wintypes.HWND,ctypes.c_int]
        api.GetWindowLongPtrW.restype = ctypes.c_ssize_t
        api.SetWindowLongPtrW.argtypes = [wintypes.HWND,ctypes.c_int,ctypes.c_ssize_t]
        api.SetWindowLongPtrW.restype = ctypes.c_ssize_t
        api.GetDpiForWindow.argtypes = [wintypes.HWND]
        api.GetDpiForWindow.restype = wintypes.UINT
        api.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        api.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
        api.SetWindowRgn.argtypes = [wintypes.HWND,wintypes.HRGN,wintypes.BOOL]
        api.SetWindowRgn.restype = ctypes.c_int
        api.ShowWindowAsync.argtypes = [wintypes.HWND,ctypes.c_int]
        api.ShowWindowAsync.restype = wintypes.BOOL
        self.gdi=ctypes.WinDLL('gdi32',use_last_error=True)
        self.gdi.CreateRectRgn.argtypes=[ctypes.c_int]*4
        self.gdi.CreateRectRgn.restype=wintypes.HRGN
        self.gdi.DeleteObject.argtypes=[wintypes.HANDLE]
        self.gdi.DeleteObject.restype=wintypes.BOOL
        self.gdi.CreateRoundRectRgn.argtypes=[ctypes.c_int]*6
        self.gdi.CreateRoundRectRgn.restype=wintypes.HRGN
        self.gdi.CombineRgn.argtypes=[wintypes.HRGN,wintypes.HRGN,wintypes.HRGN,ctypes.c_int]
        self.gdi.CombineRgn.restype=ctypes.c_int

    def pid(self, window):
        pid = wintypes.DWORD()
        self.api.GetWindowThreadProcessId(window, ctypes.byref(pid))
        return pid.value

    def parent(self, window):
        return self.api.GetParent(window)

    def owner(self, window):
        return self.api.GetWindow(window,4) # GW_OWNER, unlike GetParent for non-WS_POPUP

    def class_name(self, window):
        value = ctypes.create_unicode_buffer(256)
        self.api.GetClassNameW(window, value, len(value))
        return value.value

    def children(self, window):
        result = []
        @self.callback_type
        def visit(child, _):
            result.append(child)
            return len(result) < 64
        self.api.EnumChildWindows(window, visit, 0)
        return result

    def raise_child(self, window):
        # HWND_TOP affects this parent's child Z order only. ASYNCWINDOWPOS
        # avoids blocking the service on the external decoder's UI thread.
        return bool(self.api.SetWindowPos(window, 0, 0, 0, 0, 0, 0x4013))

    def embed(self,parent,host,overlay,pid,rect):
        # Only the three windows belonging to this Electron process are eligible.
        if len({parent,host,overlay})!=3 or any(self.pid(w)!=pid for w in (parent,host,overlay)):
            raise HTTPException(409,'嵌入窗口已失效')
        old_context=self.api.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
        try:
            scale=(self.api.GetDpiForWindow(parent) or 96)/96
            x,y,width,height=[round(rect[k]*scale) for k in ('x','y','width','height')]
            clip=rect['clip']
            edges=[round(clip['x']*scale),round(clip['y']*scale),round((clip['x']+clip['width'])*scale),round((clip['y']+clip['height'])*scale)]
            for window in (host,overlay):
                style=self.api.GetWindowLongPtrW(window,-16)
                if window==host and not style & 0x40000000:
                    # SetParent alone does not convert a popup to a child.
                    self.api.SetWindowLongPtrW(window,-16,(style & ~0x80CF0000)|0x46000000)
                    self.api.SetParent(window,parent)
                if (self.parent(window) if window==host else self.owner(window))!=parent or bool(self.api.GetWindowLongPtrW(window,-16)&0x40000000)!=(window==host):
                    raise HTTPException(409,'无法绑定主窗口播放区域')
                # Chromium's transparent compositor is not reliably alpha
                # composited after converting its HWND to WS_CHILD. The video
                # remains a real child; controls stay an owned, taskbar-less
                # transparent window, cropped to exactly the same viewport.
                point=wintypes.POINT(x,y)
                if window==overlay and not self.api.ClientToScreen(parent,ctypes.byref(point)):
                    raise HTTPException(409,'无法定位播放控件区域')
                flags=0x4030 if window==host else 0x4234 # never raise a background owner's controls
                if not self.api.SetWindowPos(window,0,point.x,point.y,max(1,width),max(1,height),flags):
                    raise HTTPException(409,'无法更新原生播放区域')
                region=self.gdi.CreateRectRgn(*edges)
                if not region:raise HTTPException(409,'无法裁切原生播放区域')
                radius=round(rect.get('radius',0)*scale)
                if radius:
                    rounded=self.gdi.CreateRoundRectRgn(0,0,width+1,height+1,radius*2,radius*2)
                    if not rounded:
                        self.gdi.DeleteObject(region);raise HTTPException(409,'无法创建原生播放圆角')
                    combined=self.gdi.CombineRgn(region,region,rounded,1)
                    self.gdi.DeleteObject(rounded)
                    if not combined:
                        self.gdi.DeleteObject(region);raise HTTPException(409,'无法裁切原生播放圆角')
                if not self.api.SetWindowRgn(window,region,True):
                    self.gdi.DeleteObject(region)
                    raise HTTPException(409,'无法裁切原生播放区域')
                self.api.ShowWindowAsync(window,8 if rect['visible'] and clip['width']>0 and clip['height']>0 else 0)
            return {'embedded':True}
        finally:
            if old_context:self.api.SetThreadDpiAwarenessContext(old_context)
