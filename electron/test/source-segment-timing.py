"""Read-only timestamp diagnostics for an explicitly authorized local MP4."""
import argparse
import json
import statistics
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('--start', type=float, required=True)
parser.add_argument('--end', type=float, required=True)
parser.add_argument('--decoded-frames', action='store_true', help='Also inspect timestamps in actual FFmpeg decoded-output order')
args = parser.parse_args()
source = args.source.resolve(strict=True)
root = Path(__file__).resolve().parents[2]
if not source.is_relative_to(Path('E:/downloads').resolve()) or source.suffix.lower() != '.mp4':
    raise ValueError('Explicit authorized E:/downloads MP4 required')
if not 0 <= args.start < args.end <= args.start + 1200:
    raise ValueError('Bounded segment required')
before = source.stat()
command = [str(root/'bin/ffprobe.exe'), '-v', 'warning', '-read_intervals',
           f'{max(0, args.start-10)}%{args.end+10}', '-select_streams', 'v:0',
           '-show_packets', '-show_entries', 'packet=pts_time,dts_time,duration_time,flags,pos,size',
           '-of', 'json', str(source)]
result = subprocess.run(command, capture_output=True, encoding='utf-8', errors='replace', timeout=90)
if result.returncode:
    raise RuntimeError(result.stderr)
packets = json.loads(result.stdout).get('packets', [])
points = [p for p in packets if args.start <= float(p.get('pts_time', '-1')) < args.end]
pts = sorted(float(p['pts_time']) for p in points)
dts = [float(p['dts_time']) for p in points if 'dts_time' in p]
gaps = [b-a for a, b in zip(pts, pts[1:])]
def stats(values):
    values = sorted(values)
    return dict(count=len(values), median=statistics.median(values) if values else None,
                p95=values[int((len(values)-1)*.95)] if values else None, maximum=max(values) if values else None)
large = [dict(from_time=a, to_time=b, gap_seconds=b-a) for a, b in zip(pts, pts[1:]) if b-a > .05]
decoded = None
if args.decoded_frames:
    frame_command = [str(root/'bin/ffprobe.exe'), '-v', 'warning', '-read_intervals',
                     f'{max(0, args.start-10)}%{args.end+10}', '-select_streams', 'v:0',
                     '-show_frames', '-show_entries', 'frame=pts_time,best_effort_timestamp_time,pkt_dts_time,pict_type',
                     '-of', 'json', str(source)]
    frame_result = subprocess.run(frame_command, capture_output=True, encoding='utf-8', errors='replace', timeout=90)
    if frame_result.returncode:
        raise RuntimeError(frame_result.stderr)
    frames = [f for f in json.loads(frame_result.stdout).get('frames', [])
              if args.start <= float(f.get('pts_time', f.get('best_effort_timestamp_time', '-1'))) < args.end]
    def frame_order(key):
        values = [float(f[key]) for f in frames if key in f]
        backwards = [dict(previous=a, current=b, delta=b-a) for a, b in zip(values, values[1:]) if b < a]
        return dict(count=len(values), backwards=len(backwards), duplicates=sum(a == b for a, b in zip(values, values[1:])),
                    examples=backwards[:20])
    decoded = dict(frames=len(frames), pts_in_decoder_output_order=frame_order('pts_time'),
                   best_effort_in_decoder_output_order=frame_order('best_effort_timestamp_time'),
                   warnings=frame_result.stderr[:8192],
                   limitation='FFmpeg decoded output order, not packet ordering, Electron rendering or physical scanout.')
after = source.stat()
print(json.dumps(dict(start=args.start, end=args.end, packets=len(points),
    presentation_gap=stats(gaps), nonincreasing_dts=sum(b <= a for a, b in zip(dts, dts[1:])),
    duplicate_pts=sum(b == a for a, b in zip(pts, pts[1:])),
    large_presentation_gaps=large[:200], large_gap_count=len(large),
    packet_bytes=sum(int(p.get('size', 0)) for p in points), warnings=result.stderr[:8192], decoded=decoded,
    source_stat_unchanged=(before.st_size, before.st_mtime_ns)==(after.st_size, after.st_mtime_ns),
    limitations=['Packet timestamps are not decoded frames or physical disk I/O.',
                  'PTS sorted for presentation; B-frame decode ordering is not treated as a timestamp defect.']), indent=2))
