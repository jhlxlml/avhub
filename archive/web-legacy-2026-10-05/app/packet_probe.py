"""Bounded, owned line-stream probing; never accumulate all packet output."""
import subprocess
import threading
import time
from contextlib import suppress
from .process_owner import own_encoder


def stream_packets(command, timeout, cancelled, consume):
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) | getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, creationflags=flags)
    owner = None
    failures = []
    error = bytearray()
    readers = []
    try:
        owner = own_encoder(process)

        def stdout():
            try:
                while True:
                    line = process.stdout.readline(8193)
                    if not line: break
                    if cancelled.is_set(): return
                    if len(line) > 8192: raise ValueError('TS 探测输出行过长')
                    consume(line)
            except BaseException as exc:
                failures.append(exc)

        def stderr():
            try:
                while True:
                    chunk = process.stderr.read(4096)
                    if not chunk: break
                    error.extend(chunk[:max(0, 65536-len(error))])
            except OSError:
                pass

        for reader in (stdout, stderr):
            thread = threading.Thread(target=reader, daemon=True, name='avhub-ts-packet-pipe')
            readers.append(thread); thread.start()
        deadline = time.monotonic() + timeout
        while True:
            if cancelled.is_set(): raise ValueError('已取消 TS 索引')
            if failures: raise failures[0]
            if time.monotonic() >= deadline: raise TimeoutError('TS 流式索引超时')
            if process.poll() is not None and not readers[0].is_alive(): break
            cancelled.wait(.02)
        if failures: raise failures[0]
        readers[1].join(timeout=1)
        return process.returncode, bytes(error)
    finally:
        if process.poll() is None:
            with suppress(OSError): process.kill()
        if owner: owner.close()
        with suppress(subprocess.TimeoutExpired): process.wait(timeout=1)
        for thread in readers: thread.join(timeout=1)
        for pipe, thread in zip((process.stdout, process.stderr), readers):
            if not thread.is_alive(): pipe.close()
        if not readers:
            process.stdout.close(); process.stderr.close()
