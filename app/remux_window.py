"""Owned stream-copy producer: publish closed short segments before window EOF."""
import csv
from contextlib import suppress
from pathlib import Path
import subprocess
import threading
import time
from .process_owner import own_encoder


def run_remux_window(command,timeout,cancelled,publish):
    listing=Path(command[command.index('-segment_list')+1])
    process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,
        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)|getattr(subprocess,'BELOW_NORMAL_PRIORITY_CLASS',0))
    owner=None;error=bytearray();reader=None;published=set()
    try:
        owner=own_encoder(process)
        def errors():
            try:
                while chunk:=process.stderr.read(4096):error.extend(chunk[:max(0,65536-len(error))])
            except OSError:pass
        reader=threading.Thread(target=errors,daemon=True,name='avhub-remux-window-errors');reader.start()
        def drain():
            try:raw=listing.read_text(encoding='utf-8')
            except (FileNotFoundError,PermissionError):return
            if len(raw)>65536:raise ValueError('分片列表超过安全限制')
            raw=raw[:raw.rfind('\n')+1]
            for row in csv.reader(raw.splitlines()):
                if len(row)!=3:raise ValueError('分片列表无效')
                name=row[0]
                if name in published:continue
                publish(name,float(row[1]),float(row[2]));published.add(name)
        deadline=time.monotonic()+timeout
        while True:
            if cancelled.is_set():raise ValueError('封装窗口已取消')
            drain()
            if process.poll() is not None:
                drain();reader.join(timeout=1)
                return process.returncode,bytes(error)
            if time.monotonic()>=deadline:raise TimeoutError('封装窗口超时')
            cancelled.wait(.01)
    finally:
        if process.poll() is None:
            with suppress(OSError):process.kill()
        if owner:owner.close()
        with suppress(subprocess.TimeoutExpired):process.wait(timeout=1)
        if reader:reader.join(timeout=1)
        if not reader or not reader.is_alive():process.stderr.close()


def first_video_pts(path,require_idr=False):
    # Our MPEG-TS producer puts a complete video PES header in its first PUSI
    # packet. Validate its real 90 kHz timestamp, without another ffprobe per
    # segment. Never expose a segment mapped to the wrong index time.
    with path.open('rb') as reader:raw=reader.read(188*512)
    pts=None;video_pid=None;frame=bytearray()
    for at in range(0,len(raw)-187,188):
        packet=raw[at:at+188]
        if packet[0]!=0x47:raise ValueError('封装包未对齐')
        control=(packet[3]>>4)&3
        if control not in (1,3):continue
        offset=4 if control==1 else 5+packet[4]
        payload=packet[offset:]
        pid=((packet[1]&31)<<8)|packet[2]
        if video_pid is not None:
            if pid!=video_pid:continue
            if packet[1]&0x40:break
            frame.extend(payload);continue
        if not packet[1]&0x40:continue
        if len(payload)<14 or payload[:3]!=b'\x00\x00\x01' or not 0xe0<=payload[3]<=0xef:continue
        if not payload[7]&0x80 or payload[8]<5:continue
        p=payload[9:14]
        if not(p[0]&1 and p[2]&1 and p[4]&1):raise ValueError('封装时间戳无效')
        pts=(((p[0]>>1)&7)<<30|(p[1]<<22)|((p[2]>>1)<<15)|(p[3]<<7)|(p[4]>>1))/90000
        if not require_idr:return pts
        video_pid=pid;frame.extend(payload[9+payload[8]:])
    if pts is None:raise ValueError('分片缺少视频时间戳')
    # A keyframe flag alone can describe an open GOP. Only independently
    # decodable IDR starts are safe for this optimized multi-file producer.
    at=0
    while True:
        at=frame.find(b'\x00\x00\x01',at)
        if at<0:break
        if at+3<len(frame) and frame[at+3]&31==5:return pts
        at+=3
    raise ValueError('分片不是可独立解码的 IDR')
