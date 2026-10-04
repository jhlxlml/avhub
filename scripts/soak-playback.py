"""Isolated FFmpeg/cache soak test, not a browser decoding or NAS outage test."""
import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
# Deliberately do not import app.main: never open the user's library database.
from app.playback import PlaybackManager
from app.hls_cache import parse_manifest
from app.video_color import color_metadata


def tool(name):
    local = PROJECT / 'bin' / (name + '.exe')
    return str(local) if local.is_file() else shutil.which(name) or name


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Read-only source; omitted: generate a temporary 640x360 sample')
    parser.add_argument('--sample-4k', action='store_true', help='Generate a 15s 3840x2160 / 60 Mbps padded H.264 sample (~113MB); not a real film')
    parser.add_argument('--seconds', type=int, default=60, help='Wall-clock duration, 10..86400')
    parser.add_argument('--mode', choices=['remux', 'transcode'], default='remux')
    parser.add_argument('--speed', type=float, default=1, help='Simulated consumption rate, .25..16; not actual decoding')
    parser.add_argument('--pause-every', type=int, default=20)
    parser.add_argument('--pause-seconds', type=int, default=5)
    parser.add_argument('--cache-mib', type=int, default=2048, help='Budget; 75%% soft generation target, minimum 16 MiB')
    parser.add_argument('--temp-root', type=Path, help='Optional temporary cache parent on a disk to test')
    parser.add_argument('--verify-sha256', action='store_true', help='Read entire source before/after (expensive for NAS/large files)')
    args = parser.parse_args()
    if not 10 <= args.seconds <= 86400 or not math.isfinite(args.speed) or not .25 <= args.speed <= 16:
        parser.error('Invalid duration or consumption speed')
    if args.pause_seconds < 0 or args.pause_every <= args.pause_seconds or args.cache_mib < 16:
        parser.error('Pause interval must exceed pause duration; cache budget must be >=16 MiB')
    if args.temp_root and not args.temp_root.is_dir(): parser.error('--temp-root must already exist')
    if args.source and args.sample_4k: parser.error('--source and --sample-4k cannot be combined')
    report = {'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'running',
              'scope': 'FFmpeg + rolling cache; no browser/Electron decoding, no deliberate NAS disconnection',
              'mode': args.mode, 'requested_seconds': args.seconds, 'speed': args.speed,
              'samples': [], 'restarts': 0, 'pause_samples': 0, 'fragments_read': 0, 'peak_cache_bytes': 0}
    failure = None
    with tempfile.TemporaryDirectory(prefix='avhub-soak-', dir=args.temp_root) as temporary:
        folder = Path(temporary)
        manager = None
        source = args.source.resolve() if args.source else folder / 'sample.mkv'
        original = None
        original_hash = None
        try:
            if not args.source:
                sample = ['color=c=navy:s=3840x2160:r=25', '-t', '15'] if args.sample_4k else ['testsrc2=s=640x360:r=25', '-t', '120']
                command = [tool('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', *sample,
                           '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-pix_fmt', 'yuv420p']
                if args.sample_4k:
                    command += ['-b:v', '60M', '-minrate', '60M', '-maxrate', '60M', '-bufsize', '120M', '-x264-params', 'nal-hrd=cbr']
                subprocess.run([*command, str(source)], check=True, timeout=60)
            original = source.stat()
            if not source.is_file(): raise ValueError('Source must be a video file')
            if args.verify_sha256 or not args.source: original_hash = sha256(source)
            probe = subprocess.run([tool('ffprobe'), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)],
                                   check=True, capture_output=True, timeout=30)
            info = json.loads(probe.stdout)
            video = next(stream for stream in info['streams'] if stream.get('codec_type') == 'video')
            duration = float(info['format']['duration'])
            if not math.isfinite(duration) or duration < 10: raise ValueError('Source duration must be at least 10 seconds')
            report['source'] = {'name': source.name, 'bytes': original.st_size, 'duration': duration,
                                'codec': video['codec_name'], 'width': video['width'], 'height': video['height'],
                                'synthetic': not bool(args.source), 'padded_4k_sample': args.sample_4k}
            manager = PlaybackManager(folder / 'cache', cache_bytes=args.cache_mib * 1024**2)
            token = manager.create(source, tool('ffmpeg'), copy_video=args.mode == 'remux',
                                   video_color=color_metadata(video))['token']
            position = 0.0
            read = set()
            began = previous = time.monotonic()
            active_stall_seconds = 0.0
            next_sample = 0
            while time.monotonic() - began < args.seconds:
                now = time.monotonic(); elapsed = now - began
                paused = elapsed % args.pause_every >= args.pause_every - args.pause_seconds
                status = manager.status(token, position=position)
                if status['state'] == 'failed': raise RuntimeError(status['error'])
                if status['state'] == 'ready':
                    before_position = position
                    if not paused: position = max(position, min(status['window_end'] - .25, position + (now - previous) * args.speed))
                    if position > before_position + .01: active_stall_seconds = 0
                    elif not paused: active_stall_seconds += now - previous
                    if active_stall_seconds > 15:
                        raise RuntimeError('Playback consumption stalled for 15 seconds; encoder liveness is not sufficient')
                    _, fragments, _ = parse_manifest(manager.manifest(token))
                    for fragment in fragments:
                        # Read consumed fragments through the same pinning API;
                        # never load a complete movie into memory.
                        if fragment.name not in read and fragment.start <= position < fragment.end:
                            with manager.open_fragment(token, fragment.name) as stream:
                                for chunk in iter(lambda: stream.read(1024 * 1024), b''): pass
                            read.add(fragment.name); report['fragments_read'] += 1
                    if position >= duration - 1:
                        old = manager.sessions[token]
                        manager.stop(token)
                        if old.worker: old.worker.join(timeout=3)
                        if old.worker and old.worker.is_alive(): raise RuntimeError('Retired HLS worker did not exit')
                        token = manager.create(source, tool('ffmpeg'), copy_video=args.mode == 'remux',
                                               video_color=color_metadata(video))['token']
                        position = 0; read.clear(); report['restarts'] += 1
                        active_stall_seconds = 0
                report['peak_cache_bytes'] = max(report['peak_cache_bytes'], status['cache_bytes'])
                if elapsed >= next_sample:
                    sample = {'elapsed': round(elapsed, 1), 'position': round(position, 2), 'paused': paused,
                              **{key: status[key] for key in ('state', 'window_start', 'window_end', 'cache_bytes', 'throttled')}}
                    report['samples'].append(sample); report['pause_samples'] += int(paused)
                    print(json.dumps(sample), flush=True); next_sample += 2
                manager.sweep()
                previous = now
                time.sleep(.25)
            if report['fragments_read'] < 2: raise RuntimeError('Insufficient playback progress; test is incomplete')
            report['elapsed_seconds'] = round(time.monotonic() - began, 2)
            report['status'] = 'passed'
        except Exception as exc:
            failure = exc; report['status'] = 'failed'; report['error'] = str(exc)
        finally:
            if manager:
                sessions = list(manager.sessions.values())
                manager.close()
                for session in sessions:
                    if session.worker: session.worker.join(timeout=3)
                manager.sweep()
                report['cleanup_complete'] = not manager.sessions and not manager.pending_removals and all(
                    session.process.poll() is not None and (not session.worker or not session.worker.is_alive()) for session in sessions)
                if not report['cleanup_complete']:
                    failure = failure or RuntimeError('Encoder/cache cleanup incomplete')
                    report['status'] = 'failed'; report['error'] = str(failure)
            if original:
                try:
                    after = source.stat()
                    report['source_metadata_unchanged'] = (after.st_size, after.st_mtime_ns) == (original.st_size, original.st_mtime_ns)
                    if original_hash: report['source_sha256_unchanged'] = sha256(source) == original_hash
                    if not report['source_metadata_unchanged'] or report.get('source_sha256_unchanged') is False:
                        raise RuntimeError('Source changed during test; check other writers')
                except OSError as exc:
                    report['source_check_error'] = str(exc); failure = failure or exc
                    report['status'] = 'failed'
                except RuntimeError as exc:
                    failure = failure or exc; report['status'] = 'failed'; report['error'] = str(exc)
    output = PROJECT / 'build' / 'soak-reports'
    output.mkdir(parents=True, exist_ok=True)
    target = output / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8] + '.json')
    with target.open('x', encoding='utf-8') as file: json.dump(report, file, ensure_ascii=False, indent=2)
    print(json.dumps({'status': report['status'], 'report': str(target)}, ensure_ascii=False), flush=True)
    return 1 if failure else 0


if __name__ == '__main__': sys.exit(main())
