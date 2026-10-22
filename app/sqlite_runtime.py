"""Pinned process-local SQLite. Never replace a Python/system DLL or download at startup."""
import ctypes
import hashlib
import json
import re
import struct
import sys
import threading
from pathlib import Path

_lock=threading.RLock()
_library=None
_info=None


def manifest():
    value=json.loads(Path(__file__).with_name('sqlite-runtime.json').read_text(encoding='utf-8'))
    if (value.get('schema')!=1 or value.get('architecture')!='x64'
        or not re.fullmatch(r'3\.\d+\.\d+',value.get('version',''))
        or not re.fullmatch(r'https://sqlite\.org/\d{4}/sqlite-dll-win-x64-\d{7}\.zip',value.get('url',''))
        or any(not re.fullmatch('[a-f0-9]{64}',value.get(key,'')) for key in ('archive_sha3_256','dll_sha256'))
        or not re.fullmatch(r'\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [a-f0-9]{64}',value.get('source_id',''))
        or type(value.get('dll_bytes')) is not int or not 1024**2<value['dll_bytes']<16*1024**2):
        raise RuntimeError('Invalid pinned SQLite manifest')
    return value


def runtime_path(info):
    root=Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parents[1])).resolve()
    folder=root if getattr(sys,'frozen',False) else root/'bin'/'sqlite'/info['version']
    target=folder/'sqlite3.dll'
    if target.is_symlink() or not target.resolve().is_relative_to(root):
        raise RuntimeError('SQLite runtime must stay inside the application directory')
    return target


def validate_binary(target,info):
    target=Path(target)
    if target.is_symlink() or not target.is_file():
        raise RuntimeError('SQLite 运行库缺失，请执行 npm run prepare:sqlite 后重新启动')
    with target.open('rb') as file:
        if target.stat().st_size!=info['dll_bytes'] or hashlib.file_digest(file,'sha256').hexdigest()!=info['dll_sha256']:
            raise RuntimeError('SQLite 运行库校验失败，已阻止加载；请核查项目运行库')
        file.seek(0);header=file.read(64)
        if header[:2]!=b'MZ':raise RuntimeError('Invalid SQLite PE header')
        file.seek(struct.unpack_from('<I',header,60)[0]);pe=file.read(6)
        if pe[:4]!=b'PE\0\0' or pe[4:]!=b'\x64\x86':raise RuntimeError('SQLite runtime must be Windows x64')


def _kernel():
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.GetModuleHandleW.argtypes=[ctypes.c_wchar_p];kernel.GetModuleHandleW.restype=ctypes.c_void_p
    kernel.GetModuleFileNameW.argtypes=[ctypes.c_void_p,ctypes.c_wchar_p,ctypes.c_uint32]
    kernel.GetModuleFileNameW.restype=ctypes.c_uint32
    return kernel


def _loaded_path(kernel,handle):
    name=ctypes.create_unicode_buffer(32768)
    length=kernel.GetModuleFileNameW(handle,name,len(name))
    if not 0<length<len(name):raise RuntimeError('Cannot identify the loaded SQLite runtime')
    return Path(name.value).resolve()


def initialize():
    """Must run before anything imports sqlite3; reject an already-loaded host DLL."""
    global _library,_info
    with _lock:
        if _info is not None:return {**_info,'compile_options':list(_info['compile_options'])}
        if sys.platform!='win32' or struct.calcsize('P')!=8:
            raise RuntimeError('AVHub SQLite runtime requires Windows x64')
        expected=manifest();target=runtime_path(expected);validate_binary(target,expected)
        kernel=_kernel();existing=kernel.GetModuleHandleW('sqlite3.dll')
        if existing and _loaded_path(kernel,existing)!=target.resolve():
            raise RuntimeError('SQLite 已由其他路径加载；请通过 AVHub 启动入口或 scripts/python-runtime.py 重启进程')
        # Absolute path + safe dependent-DLL search. Keep the handle for the
        # process lifetime; _sqlite3.pyd must bind the already-loaded pinned DLL.
        _library=ctypes.CDLL(str(target.resolve()),winmode=0x1100)
        if _loaded_path(kernel,_library._handle)!=target.resolve():raise RuntimeError('SQLite loaded path mismatch')
        import sqlite3
        from contextlib import closing
        with closing(sqlite3.connect(':memory:')) as db:
            version,source=db.execute('SELECT sqlite_version(),sqlite_source_id()').fetchone()
            options=[row[0] for row in db.execute('PRAGMA compile_options')]
            sync=db.execute('PRAGMA synchronous').fetchone()[0]
            checkpoint=db.execute('PRAGMA wal_autocheckpoint').fetchone()[0]
        if (version!=expected['version'] or source!=expected['source_id'] or 'THREADSAFE=1' not in options
            or sync!=2 or checkpoint!=1000 or sqlite3.threadsafety!=3
            or _loaded_path(kernel,kernel.GetModuleHandleW('sqlite3.dll'))!=target.resolve()):
            raise RuntimeError('SQLite actual engine/source/thread/durability validation failed')
        _info={'policy':'pinned-private-runtime','version':version,'source_id':source,'architecture':'x64',
            'sha256':expected['dll_sha256'],'verified':True,'threadsafety':sqlite3.threadsafety,
            'compile_options':options}
        return {**_info,'compile_options':list(_info['compile_options'])}


def status():
    with _lock:
        if _info is not None:return {**_info,'compile_options':list(_info['compile_options'])}
    # Direct unit/module harnesses may deliberately test the host engine. They
    # cannot claim desktop runtime acceptance; run.py always initializes first.
    import sqlite3
    return {'policy':'host-module-harness','version':sqlite3.sqlite_version,'verified':False}
