"""Read-only process liveness checks for crash-cache recovery."""
import ctypes
import json
import os
from pathlib import Path


def running(pid: int) -> bool:
    if pid <= 0 or pid >= 2**32: return True  # Unknown ownership must not be removed.
    if os.name != 'nt':
        try: os.kill(pid, 0); return True
        except ProcessLookupError: return False
        except PermissionError: return True
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION only.
    if not handle: return ctypes.get_last_error() != 87  # Access denied != dead.
    try:
        code = ctypes.c_ulong()
        return not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value == 259
    finally: kernel.CloseHandle(handle)


def orphaned(folder: Path) -> bool:
    try:
        marker = folder / 'owner.json'
        if marker.stat().st_size > 1024: return False
        pid = json.loads(marker.read_text(encoding='utf-8')).get('pid')
        return type(pid) is int and not running(pid)
    except (OSError, ValueError, TypeError, AttributeError): return False
