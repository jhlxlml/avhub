"""Run either application's real UI against an isolated, single-video library."""
import argparse
import importlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import types

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', choices=['avhub', 'reference'], default='avhub')
    parser.add_argument('--source')
    parser.add_argument('--reference-root')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='avhub-seek-benchmark-') as temporary:
        folder = Path(temporary)
        os.environ['AVHUB_DATA_DIR'] = str(folder / 'avhub-data')
        os.environ.pop('AVHUB_SESSION_TOKEN', None)
        from app import main as avhub
        import uvicorn
        source = Path(args.source).resolve() if args.source else folder / 'benchmark.mkv'
        if not args.source:
            subprocess.run([avhub.executable('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i',
                            'testsrc2=s=640x360:r=25', '-f', 'lavfi', '-i', 'sine=frequency=440',
                            '-t', '120', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50',
                            '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(source)], check=True)
        if not source.is_file():
            raise ValueError('Benchmark source does not exist')
        original = source.stat()
        metadata = avhub.probe(source)
        if not metadata['video_codec'] or metadata['duration'] < 5:
            raise ValueError('Benchmark requires a valid video at least five seconds long')
        # Populate both profiles with a cached cover before timing playback.
        # Otherwise the reference UI launches a thumbnail FFmpeg during startup.
        preview = avhub.thumbnail(source, 1, metadata['duration'])
        if args.kind == 'avhub':
            with avhub.connection() as db:
                db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)', (str(source.parent),))
                db.execute('''INSERT INTO media(id,path,root_id,name,title,ext,duration,width,height,
                    video_codec,audio_tracks,subtitles,size,created_at,updated_at)
                    VALUES(1,?,1,?,'播放基准样本',?,?,?,?,?,?,?,?,0,0)''',
                           (str(source), source.name, source.suffix, metadata['duration'], metadata['width'],
                            metadata['height'], metadata['video_codec'], json.dumps(metadata['audio_tracks']),
                            json.dumps(metadata['subtitles']), original.st_size))
                if preview: db.execute('UPDATE media SET thumbnail=? WHERE id=1', (preview,))
            app = avhub.app
        else:
            reference = Path(args.reference_root).resolve()
            if not (reference / 'app' / 'main.py').is_file() or not (reference / 'static' / 'index.html').is_file():
                raise ValueError('Reference application directory is invalid')
            # Import the reference source without running its launcher or config.
            # Redirect EVERY database/thumbnail write into this temporary profile.
            package = types.ModuleType('benchmark_reference')
            package.__path__ = [str(reference / 'app')]
            sys.modules[package.__name__] = package
            config = types.ModuleType('benchmark_reference.config')
            config.STATIC_DIR = reference / 'static'
            config.DATA_DIR = folder / 'reference-data'; config.DATA_DIR.mkdir()
            config.THUMB_DIR = config.DATA_DIR / 'thumbnails'; config.THUMB_DIR.mkdir()
            config.DB_PATH = config.DATA_DIR / 'player.db'
            config.FFMPEG = avhub.executable('ffmpeg'); config.FFPROBE = avhub.executable('ffprobe')
            config.DEFAULT_SCAN_ROOTS = []
            config.NATIVE_VIDEO = {'h264','avc1','vp9','av01','vp8','theora','mpeg4'}
            config.SUB_EXT = {'.srt','.ass','.ssa','.vtt','.sub'}
            config.VIDEO_EXTS = avhub.VIDEO_EXTENSIONS
            config.TRANSCODE_OUTPUT_H = 1080
            sys.modules[config.__name__] = config
            module = importlib.import_module('benchmark_reference.main')
            module.db.upsert_media({
                'path':str(source), 'name':'播放基准样本', 'size':original.st_size,
                'mtime':original.st_mtime, 'duration':metadata['duration'], 'width':metadata['width'],
                'height':metadata['height'], 'video_codec':metadata['video_codec'],
                'audio_codec':next((track['codec'] for track in metadata['audio_tracks']), None),
                'audio_tracks':len(metadata['audio_tracks']), 'sub_tracks':len(metadata['subtitles']),
                'has_native':metadata['video_codec'] in config.NATIVE_VIDEO,
                'thumb':str(avhub.THUMBS / '1.jpg') if preview else None,
            })
            app = module.app
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0)); listener.listen(128)
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='error'))

        @app.post('/benchmark/shutdown')
        def shutdown():
            server.should_exit = True
            return {'ok': True}

        print(json.dumps({'url':f'http://127.0.0.1:{port}', 'source':str(source),
                          'duration':metadata['duration'], 'codec':metadata['video_codec'],
                          'source_size':original.st_size, 'kind':args.kind}), flush=True)
        try:
            server.run(sockets=[listener])
        finally:
            avhub.playback.close()
            listener.close()
            current = source.stat()
            if (current.st_size, current.st_mtime_ns) != (original.st_size, original.st_mtime_ns):
                raise RuntimeError('Source metadata changed during benchmark')


if __name__ == '__main__':
    main()
