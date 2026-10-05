"""Managed, local FFmpeg sessions. Only session-owned cache directories are removed."""
from __future__ import annotations

import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO
import math
import json
import os

from fastapi import HTTPException
from .video_color import transcode_color
from .hls_cache import parse_manifest, window_manifest
from .cache_owner import orphaned
from .process_owner import own_encoder
from .indexed_ts import IndexedTs, build_index, fingerprint
from .indexed_remux import IndexedRemux, build_remux_index

HLS_SEGMENT_SECONDS = 2
TRANSCODE_SEGMENT_SECONDS = 1


@dataclass
class Session:
    token: str
    folder: Path
    process: subprocess.Popen | None
    log: BinaryIO | None
    offset: float
    created: float
    touched: float
    error: str | None = None
    color: dict | None = None
    playhead: float = 0
    generated: float = 0
    first_sequence: int = 0
    window_start: float = 0
    window_end: float = 0
    cache_bytes: int = 0
    throttled: bool = False
    worker: threading.Thread | None = None
    expired_files: set[str] = field(default_factory=set)
    owner: object | None = None
    indexed: IndexedTs | None = None


class PlaybackManager:
    def __init__(self, cache: Path, idle_seconds: float = 120, *, ahead_seconds: float = 90,
                 back_seconds: float = 60, cache_bytes: int = 2 * 1024**3):
        self.cache = cache.resolve()
        self.idle_seconds = idle_seconds
        self.sessions: dict[str, Session] = {}
        self.pending_removals: set[Path] = set()
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.ahead_seconds = ahead_seconds
        self.back_seconds = back_seconds
        # Reserve space for the pipe, encoder and one not-yet-published GOP.
        # This is a target, not a strict quota for an individual oversized GOP.
        self.cache_target = int(cache_bytes * .75)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.cancelled_creations: dict[str, float] = {}
        for folder in self.cache.iterdir():
            if folder.is_dir() and folder.resolve().parent == self.cache and re.fullmatch(r'[a-f0-9]{32}', folder.name) and orphaned(folder):
                self._remove_folder(folder)

    def create(self, source: Path, ffmpeg: str, offset: float = 0, max_height: int | None = None,
               audio_track_index: int | None = None, copy_video: bool = False,
               copy_audio: bool = False, video_color: dict | None = None, client_token: str | None = None) -> dict:
        with self.lock:
            self.cancelled_creations = {key: expiry for key, expiry in self.cancelled_creations.items() if expiry > time.monotonic()}
            if client_token and client_token in self.cancelled_creations:
                raise HTTPException(409, '已取消本次播放准备，请重新播放')
            if client_token and (not re.fullmatch(r'[a-f0-9]{32}', client_token) or client_token in self.sessions):
                raise HTTPException(409, '播放请求标识无效或已使用')
            if len(self.sessions) >= 2:
                raise HTTPException(409, "已有两个转码任务，请先关闭其他播放器")
            color_plan = None if copy_video else transcode_color(video_color)
            token = client_token or uuid.uuid4().hex
            folder = self.cache / token
            created_folder = False
            try:
                folder.mkdir(parents=True)
                created_folder = True
                (folder / 'owner.json').write_text(json.dumps({'pid': os.getpid()}), encoding='utf-8')
                log = (folder / "ffmpeg.log").open("wb")
            except OSError as exc:
                if created_folder: self._remove_folder(folder)
                raise HTTPException(503, '无法创建播放缓存，请检查应用数据目录的磁盘空间与写入权限') from exc
            segment_seconds = HLS_SEGMENT_SECONDS if copy_video else TRANSCODE_SEGMENT_SECONDS
            audio_map = f"0:{audio_track_index}" if audio_track_index is not None else "0:a:0?"
            command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-nostats", "-y",
                       "-readrate", "16", "-readrate_catchup", "16", "-readrate_initial_burst", str(self.ahead_seconds),
                       "-ss", str(offset), "-i", str(source), "-map", "0:v:0", "-map", audio_map]
            if copy_video:
                command.extend(["-c:v", "copy"])
            else:
                # Auto transcodes are quality-first: keep the source dimensions (only trim
                # an odd trailing row/column required by 8-bit 4:2:0 H.264). Explicit
                # quality presets may downscale, but never upscale or exceed 1920px wide.
                scale = (f"scale=w='min(1920,iw)':h='min({max_height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
                         if max_height else "scale=w='trunc(iw/2)*2':h='trunc(ih/2)*2'")
                filters = ','.join(filter(None,[color_plan['filter'],scale]))
                command.extend(["-vf", filters, "-pix_fmt", "yuv420p",
                                "-c:v", "libx264", "-preset", "medium", "-tune", "zerolatency", "-crf", "18",
                                "-force_key_frames", f"expr:gte(t,n_forced*{segment_seconds})"])
                command.extend(color_plan['args'])
            if copy_audio:
                command.extend(["-c:a", "copy"])
            else:
                command.extend(["-c:a", "aac", "-ac", "2"])
            command.extend(["-f", "hls", "-hls_time", str(segment_seconds), "-hls_list_size", "0", "-hls_playlist_type", "event",
                            "-hls_flags", "independent_segments+temp_file", "-hls_segment_filename",
                            str(folder / "segment_%06d.ts"), "pipe:1"])
            try:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, bufsize=4096, stderr=log,
                                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except OSError as exc:
                log.close()
                self._remove_folder(folder)
                raise HTTPException(503, "无法启动转码，请检查 FFmpeg 是否安装或放在 bin 目录") from exc
            try:
                owner = own_encoder(process)
            except OSError as exc:
                # Do not leave an encoder behind if ownership protection fails.
                if process.poll() is None: process.kill()
                process.wait(timeout=3)
                if process.stdout: process.stdout.close()
                log.close()
                self._remove_folder(folder)
                raise HTTPException(503, '无法建立播放进程保护，请关闭旧服务后重试或查看运行诊断') from exc
            now = time.monotonic()
            self.sessions[token] = Session(token, folder, process, log, offset, now, now)
            self.sessions[token].owner = owner
            self.sessions[token].color = {'source':video_color or {},'label':'复制视频编码 · 不做色彩转换' if copy_video else color_plan['label'],
                                         'warning':'显示效果仍取决于浏览器、显卡与显示器支持' if copy_video else color_plan['warning']}
            if getattr(process, 'stdout', None) is not None:
                worker = threading.Thread(target=self._pace, args=(self.sessions[token],), name=f'avhub-hls-{token[:8]}', daemon=True)
                self.sessions[token].worker = worker
                worker.start()
            return self.status(token)

    def create_indexed_ts(self, source: Path, ffprobe: str, run, *, video_color=None, client_token=None, start=0, progressive=False, stream=None):
        return self._create_indexed(source,IndexedTs(source),
            lambda event,publish:build_index(source,self.cache.parent/'ts-index',ffprobe,run,event,
                                            publish=publish if progressive else None,start=start,stream=stream),
            video_color=video_color,client_token=client_token)

    def create_indexed_remux(self,source,ffprobe,ffmpeg,run,*,audio_track_index=None,copy_audio=True,video_color=None,client_token=None):
        indexed=IndexedRemux(source,ffmpeg=ffmpeg,run=run,audio_index=audio_track_index,copy_audio=copy_audio,
                             budget=min(self.cache_target,256*1024**2))
        return self._create_indexed(source,indexed,
            lambda event,publish:build_remux_index(source,self.cache.parent/'remux-index',ffprobe,run,event),
            video_color=video_color,client_token=client_token)

    def _create_indexed(self,source,indexed,build,*,video_color=None,client_token=None):
        with self.lock:
            now = time.monotonic()
            self.cancelled_creations = {key: expiry for key, expiry in self.cancelled_creations.items() if expiry > now}
            if client_token and client_token in self.cancelled_creations:
                raise HTTPException(409, '已取消本次播放准备，请重新播放')
            if client_token and (not re.fullmatch(r'[a-f0-9]{32}', client_token) or client_token in self.sessions):
                raise HTTPException(409, '播放请求标识无效或已使用')
            if len(self.sessions) >= 2: raise HTTPException(409, '已有两个播放任务，请先关闭其他播放器')
            token = client_token or uuid.uuid4().hex
            folder = self.cache / token
            created_folder=False
            try:
                folder.mkdir()
                created_folder=True
                (folder / 'owner.json').write_text(json.dumps({'pid': os.getpid()}), encoding='utf-8')
            except OSError as exc:
                if created_folder:self._remove_folder(folder)
                raise HTTPException(503, '无法创建播放索引，请检查缓存目录权限') from exc
            if isinstance(indexed,IndexedRemux):indexed.folder=folder
            session = Session(token, folder, None, None, 0, now, now, indexed=indexed)
            session.color = {'source': video_color or {}, 'label':('原视频编码按需封装 · 不重编码画面' if isinstance(indexed,IndexedRemux) else '原始 TS 按关键帧直读 · 不改视频/音频编码'),
                             'warning':'显示效果仍取决于浏览器、显卡与显示器支持'}
            self.sessions[token] = session
            def publish(data):
                with self.lock:
                    if self.sessions.get(token) is session and not indexed.cancelled.is_set():
                        indexed.progressive=True
                        indexed.target_duration=math.ceil(data['source_duration'])
                        indexed.data=data
                        session.window_end=data['duration']
            def index():
                try:
                    data = build(session.indexed.cancelled,publish)
                    with self.lock:
                        if self.sessions.get(token) is session and not session.indexed.cancelled.is_set():
                            session.indexed.data = data
                            session.window_end = data['duration']
                except Exception as exc:
                    with self.lock:
                        if self.sessions.get(token) is session:
                            session.error = f'关键帧索引不可用，需兼容封装：{str(exc)[:200]}'
            session.worker = threading.Thread(target=index, name=f'avhub-keyframe-index-{token[:8]}', daemon=True)
            session.worker.start()
            return self.status(token)

    def _maintain(self, session: Session):
        if session.indexed: return
        # Check before the first manifest too: a failing decoder can fill its
        # error log without ever publishing a playable segment.
        log = session.folder / 'ffmpeg.log'
        if log.is_file() and log.stat().st_size > 4 * 1024**2:
            self._fail(session, 'FFmpeg 持续大量报错，已停止播放准备；请检查视频或运行诊断后重试')
            return
        manifest = session.folder / 'index.m3u8'
        try:
            _, fragments, _ = parse_manifest(manifest.read_bytes())
        except FileNotFoundError:
            return
        sizes = {}
        for path in session.folder.iterdir():
            try:
                if path.is_file(): sizes[path.name] = path.stat().st_size
            except FileNotFoundError:
                pass
        size = sum(sizes.values())
        cutoff = max(0, session.playhead - self.back_seconds)
        if size >= self.cache_target:
            cutoff = max(cutoff, session.playhead - 10)
            available_end = fragments[-1].end if fragments else 0
            if available_end - session.playhead <= 2:
                cutoff = max(cutoff, session.playhead - 2)
        for index, fragment in enumerate(fragments):
            if index >= session.first_sequence and fragment.end <= cutoff:
                session.first_sequence = index + 1
                session.expired_files.add(fragment.name)
        for name in tuple(session.expired_files):
            try:
                (session.folder / name).unlink(missing_ok=True)
                session.expired_files.remove(name)
                size -= sizes.get(name, 0)
            except OSError:
                pass  # Active Windows HTTP handles are retried after release.
        session.cache_bytes = size
        if fragments:
            session.window_end = fragments[-1].end
            session.window_start = fragments[min(session.first_sequence, len(fragments) - 1)].start

    def _fail(self, session: Session, message: str):
        # A failed HTTP response is not enough: retire the encoder, including
        # one blocked on its manifest pipe. Keep the task for error reporting.
        session.error = session.error or message
        session.throttled = False
        self.condition.notify_all()
        self._stop_process(session)

    def _check_cache(self, session: Session):
        if session.error:
            return
        try:
            self._maintain(session)
        except (OSError, ValueError) as exc:
            self._fail(session, f'播放缓存不可读写，请检查缓存磁盘空间或权限：{exc}')

    def _should_throttle(self, session: Session) -> bool:
        ahead = session.generated - session.playhead
        # A capacity target must not prevent publishing enough data to consume
        # the next fragment. In-flight files can already exceed a tiny budget;
        # waiting for bytes to drop then waiting for playback is a deadlock.
        return ahead >= self.ahead_seconds or (
            session.cache_bytes >= self.cache_target and ahead > min(4, self.ahead_seconds))

    def _pace(self, session: Session):
        # Each HLS manifest update is written to a bounded pipe. Stop consuming
        # it when enough data is available: FFmpeg then blocks on the next
        # manifest, without OS-specific suspension or restarting the encoder.
        # Do not gate progress reports: FFmpeg can buffer those for a long time.
        lines = []
        last_sequence = -1
        try:
            for raw in iter(session.process.stdout.readline, b''):
                line = raw.decode('utf-8').strip()
                if line == '#EXTM3U': lines = []
                lines.append(line)
                ended = line == '#EXT-X-ENDLIST'
                match = re.fullmatch(r'segment_(\d+)\.ts', line)
                if not ended and (not match or int(match[1]) <= last_sequence): continue
                if match: last_sequence = int(match[1])
                with self.condition:
                    if self.sessions.get(session.token) is not session or session.error: break
                    # Publish a complete valid prefix immediately at each new
                    # URI, not one manifest late; initial playback still starts
                    # from the first segment. Atomic snapshot + pinned segment
                    # readers protects concurrent HTTP requests and eviction.
                    temporary = session.folder / 'index.m3u8.tmp'
                    temporary.write_bytes(('\n'.join(lines) + '\n').encode('utf-8'))
                    temporary.replace(session.folder / 'index.m3u8')
                    self._maintain(session)
                    session.generated = session.window_end
                    while self.sessions.get(session.token) is session and not session.error and not ended and self._should_throttle(session):
                        session.throttled = True
                        self.condition.wait(.5)
                        self._maintain(session)
                    session.throttled = False
                    if self.sessions.get(session.token) is not session or session.error: break
        except (OSError, ValueError, UnicodeError) as exc:
            with self.condition:
                if self.sessions.get(session.token) is session:
                    self._fail(session, f'播放缓存不可读写，请检查缓存磁盘空间或权限：{exc}')
        finally:
            session.process.stdout.close()

    def _get(self, token: str) -> Session:
        if not re.fullmatch(r"[a-f0-9]{32}", token) or token not in self.sessions:
            raise HTTPException(404, "播放任务已结束或过期，请重新播放")
        return self.sessions[token]

    def status(self, token: str, position: float | None = None) -> dict:
        with self.lock:
            session = self._get(token)
            session.touched = time.monotonic()
            if position is not None and math.isfinite(position):
                session.playhead = max(0, position - session.offset)
                self.condition.notify_all()
            self._check_cache(session)
            if session.indexed:
                state = 'failed' if session.error else 'ready' if session.indexed.data is not None else 'preparing'
                return {'token':token, 'state':state, 'offset':0, 'delivery':'indexed-remux' if isinstance(session.indexed,IndexedRemux) else 'indexed-ts',
                        'complete':state == 'ready' and session.indexed.data.get('complete',True), 'error':session.error, 'color':session.color,
                        'url':f'/media/hls/{token}/index.m3u8' if state == 'ready' else None,
                        'window_start':0, 'window_end':session.window_end,
                        'cache_bytes':session.indexed.cache_bytes if isinstance(session.indexed,IndexedRemux) else 0,
                        'cache_target_bytes':self.cache_target, 'throttled':False}
            code = session.process.poll()
            manifest = session.folder / "index.m3u8"
            ready = manifest.is_file() and any(session.folder.glob("segment_*.ts"))
            if code is not None and (code != 0 or not ready):
                session.error = session.error or "播放流生成失败，文件可能损坏或编码不受支持"
                try:
                    with (session.folder / 'ffmpeg.log').open('rb') as log:
                        log.seek(max(0, log.seek(0, 2) - 4096))
                        message = log.read().lower()
                    if b'no space left' in message or b'disk full' in message:
                        session.error = '播放缓存磁盘空间不足，请释放应用数据目录所在磁盘的空间后重试'
                except OSError: pass
                if session.color and 'HDR → SDR' in session.color['label'] and '无法映射时' not in session.error:
                    session.error += '；HDR 兼容映射需要 FFmpeg 的 zscale/tonemap，无法映射时不会回退为未处理的 HDR 转码'
            state = "failed" if session.error else "ready" if ready else "preparing"
            return {"token": token, "state": state, "offset": session.offset, 'complete': code == 0,
                    "url": f"/media/hls/{token}/index.m3u8" if state == "ready" else None,
                    "error": session.error, 'color':session.color,
                    'window_start': session.offset + session.window_start, 'window_end': session.offset + session.window_end,
                    'cache_bytes': session.cache_bytes, 'cache_target_bytes': self.cache_target, 'throttled': session.throttled}

    def manifest(self, token: str) -> bytes:
        with self.lock:
            session = self._get(token)
            if session.indexed:
                session.touched = time.monotonic()
                if session.error or session.indexed.data is None: raise HTTPException(503, session.error or '关键帧索引尚未完成')
                return session.indexed.manifest()
            path = self.file(token, 'index.m3u8')
            try: return window_manifest(path.read_bytes(), session.first_sequence)
            except FileNotFoundError as exc: raise HTTPException(404, '播放任务已结束') from exc
            except (OSError, ValueError) as exc: raise HTTPException(503, '播放清单暂时不可读，请重试') from exc

    def file(self, token: str, name: str) -> Path:
        with self.lock:
            session = self._get(token)
            if not re.fullmatch(r"index\.m3u8|segment_\d+\.ts", name):
                raise HTTPException(404)
            path = session.folder / name
            if name.startswith('segment_') and int(name[8:-3]) < session.first_sequence:
                raise HTTPException(410, '该播放分片已回收，请从当前位置重新播放')
            if not path.is_file():
                raise HTTPException(404, "播放分片尚未生成")
            session.touched = time.monotonic()
            return path

    def open_fragment(self, token: str, name: str):
        # Pin the file before releasing the manager lock: a rolling eviction
        # cannot race FileResponse's later open/stat or truncate an HTTP reader.
        with self.lock:
            try: return self.file(token, name).open('rb')
            except OSError as exc: raise HTTPException(410, '播放分片已回收，请重新取流') from exc

    def indexed_fragment(self, token: str, name: str):
        with self.lock:
            session = self._get(token)
            if not session.indexed or isinstance(session.indexed,IndexedRemux): return None
            match=re.fullmatch(r'segment_(\d{6})\.ts', name)
            if not match or session.indexed.data is None: raise HTTPException(404)
            index=int(match[1])
            if index >= len(session.indexed.data['fragments']): raise HTTPException(404)
            try:
                if fingerprint(session.indexed.source) != session.indexed.data['source']:
                    raise HTTPException(409, '源视频已变更，请刷新后重新播放')
            except OSError as exc: raise HTTPException(404, '源视频不可访问，请检查磁盘连接') from exc
            session.touched = time.monotonic()
            _, length, position, _ = session.indexed.data['fragments'][index]
            reader=None
            try:
                reader=session.indexed.source.open('rb')
                reader.seek(position)
            except OSError as exc:
                if reader:reader.close()
                raise HTTPException(404, '源视频不可访问') from exc
            prefix=bytes.fromhex(session.indexed.data['headers']) if index else b''
            return reader,prefix,length

    def remux_fragment(self,token,name,request_cancelled=None):
        with self.lock:
            session=self._get(token)
            if not isinstance(session.indexed,IndexedRemux):return None
            match=re.fullmatch(r'segment_(\d{6})\.ts',name)
            if not match or session.indexed.data is None or int(match[1])>=len(session.indexed.data['fragments']):raise HTTPException(404)
            session.touched=time.monotonic()
            indexed=session.indexed
        # Never hold the manager lock while FFmpeg seeks/remuxes one GOP.
        try:reader=indexed.open_fragment(int(match[1]),request_cancelled)
        except Exception as exc:raise HTTPException(503,f'按需封装不可用：{str(exc)[:300]}') from exc
        finally:
            # Cancellation can arrive while FFmpeg still owns a Windows .tmp
            # handle. Retry cleanup immediately once that short task releases it,
            # rather than leaving the folder until the next ten-second sweep.
            with self.lock:
                if indexed.cancelled.is_set():self._remove_folder(session.folder)
        with self.lock:
            if self.sessions.get(token) is not session:
                reader.close();self._remove_folder(session.folder);raise HTTPException(410,'播放任务已结束')
        return reader,b'',os.fstat(reader.fileno()).st_size

    def release_fragment(self,token,reader):
        try:reader.close()
        finally:
            with self.lock:
                folder=self.cache/token
                if folder in self.pending_removals:self._remove_folder(folder)

    def _stop_process(self, session: Session):
        if session.indexed:
            session.indexed.cancelled.set()
            return
        try:
            if session.process.poll() is None:
                session.process.terminate()
                try:
                    session.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    session.process.kill()
                    session.process.wait(timeout=3)
        finally:
            # Even an OS wait error must release the job's kill-on-close
            # protection and our log handle; no failed cleanup may leak them.
            if session.owner:
                session.owner.close()
                session.owner = None
            session.log.close()

    def _remove_folder(self, folder: Path):
        # Never follow a cache path outside the dedicated directory, including junctions.
        if folder.resolve().parent == self.cache and re.fullmatch(r"[a-f0-9]{32}", folder.name):
            # Windows can briefly hold an HTTP-reader/antivirus handle after a
            # task stops. Retry only this owned cache, then retain it for sweep.
            for delay in (0, .03, .08):
                if delay: time.sleep(delay)
                shutil.rmtree(folder, ignore_errors=True)
                if not folder.exists():
                    self.pending_removals.discard(folder)
                    return
            self.pending_removals.add(folder)
        else:
            self.pending_removals.discard(folder)

    def stop(self, token: str):
        with self.lock:
            if re.fullmatch(r'[a-f0-9]{32}', token):
                self.cancelled_creations[token] = time.monotonic() + 180
                # Bound even repeated authenticated cancellation traffic.
                if len(self.cancelled_creations) > 2048:
                    self.cancelled_creations.pop(next(iter(self.cancelled_creations)))
            session = self.sessions.pop(token, None)
            if session:
                self.condition.notify_all()
                self._stop_process(session)
                self._remove_folder(session.folder)

    def sweep(self):
        with self.lock:
            for folder in tuple(self.pending_removals):
                self._remove_folder(folder)
            now = time.monotonic()
            for token, session in list(self.sessions.items()):
                if now - session.touched > self.idle_seconds:
                    self.stop(token)
                    continue
                if session.error:
                    self._stop_process(session)
                    continue
                self._check_cache(session)
                if session.error:
                    continue
                if session.indexed:
                    if session.indexed.data is None and now - session.created > 35:
                        session.error = '关键帧索引准备超时'
                        self._stop_process(session)
                    continue
                ready = (session.folder / "index.m3u8").is_file()
                if not ready and now - session.created > 90:
                    session.error = "播放流准备超时，请重试"
                    self.condition.notify_all()
                    self._stop_process(session)

    def close(self):
        with self.lock:
            workers = [session.worker for session in self.sessions.values() if session.indexed and session.worker]
            for token in list(self.sessions):
                self.stop(token)
            for folder in tuple(self.pending_removals):
                self._remove_folder(folder)
        for worker in workers: worker.join(timeout=2)
