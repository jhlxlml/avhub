"""Isolated local regression server: never imports or changes the user's library."""
import os
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
temp = tempfile.TemporaryDirectory(prefix="avhub-regression-")
os.environ["AVHUB_DATA_DIR"] = str(Path(temp.name) / "data")
from app import main as m
import uvicorn
frontend_route = next(r for r in m.app.routes if r.path == '/{path:path}')
m.app.router.routes.remove(frontend_route)

source = Path(temp.name) / "source.mp4"
subprocess.run([m.executable("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=25",
                "-f", "lavfi", "-i", "sine=frequency=440", "-t", "120", "-c:v", "libx264", "-preset", "ultrafast",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(source)], check=True)
transport_stream = Path(temp.name) / "source.ts"
subprocess.run([m.executable("ffmpeg"), "-v", "error", "-i", str(source), "-map", "0", "-c", "copy",
                "-f", "mpegts", str(transport_stream)], check=True)
source.with_suffix('.srt').write_text('1\n00:00:02,000 --> 00:00:04,000\n测试字幕：离线正常\n', encoding='utf-8')
second = Path(temp.name) / "second.mp4"
shutil.copyfile(source, second)
third = Path(temp.name) / "third.mkv"
subprocess.run([m.executable("ffmpeg"), "-v", "error", "-i", str(source), "-i", str(source.with_suffix('.srt')),
                "-map", "0:v:0", "-map", "0:a:0", "-map", "1:s:0", "-c:v", "copy", "-c:a", "copy",
                "-c:s", "srt", str(third)], check=True)
invalid = Path(temp.name) / "broken.mkv"
invalid.write_bytes(b"invalid video fixture")
scan_source = Path(temp.name) / 'scan-source'
scan_source.mkdir()
shutil.copyfile(source, scan_source / 'New title.mp4')
original_scan_file = m.scan_file
scan_delay = 0
thumbnail_delay = 0
original_thumbnail_process=m.thumbnail_service.process

def delayed_thumbnail_process(key,cancelled,gate):
    if cancelled.wait(thumbnail_delay):raise m.ScanCancelled()
    return original_thumbnail_process(key,cancelled,gate)
m.thumbnail_service.process=delayed_thumbnail_process
def delayed_scan_file(*args, **kwargs):
    time.sleep(scan_delay)
    return original_scan_file(*args, **kwargs)
m.scan_file = delayed_scan_file

@m.app.get('/test/scan-source')
def scan_path():
    return {'path': str(scan_source)}

@m.app.post('/test/scan-delay')
def set_scan_delay(seconds: float = 0):
    global scan_delay
    scan_delay = seconds
    return {'ok': True}


@m.app.post('/test/thumbnail-delay')
def set_thumbnail_delay(seconds: float = 0):
    global thumbnail_delay
    thumbnail_delay=seconds
    return {'ok':True}


@m.app.post('/test/thumbnail-task-fixture')
def thumbnail_task_fixture():
    stat=source.stat()
    with m.connection() as db:
        db.execute('UPDATE roots SET path=? WHERE id=1',(str(source.parent),))
        db.execute('UPDATE media SET size=?,modified=? WHERE id=1',(stat.st_size,stat.st_mtime))
    return {'ok':True}

@m.app.post('/test/restore-interrupted-scan')
def restore_interrupted_scan(root_id: int):
    m.persist_scan_checkpoint(root_id, 'active')
    m.scanner.restore_interrupted(root_id)
    return {'ok': True}

@m.app.post('/test/reset')
def reset():
    global scan_delay,thumbnail_delay
    m.screenshot_store=m.screenshots.ScreenshotStore()
    m.data_jobs.close()
    m.data_jobs=m.DataJobs(lambda:m.DATA)
    m.scanner.close()
    m.scanner.job = None
    scan_delay = 0
    thumbnail_delay = 0
    m.playback.close()
    # A browser closed by the runner may not send its final beacon. Reset the
    # test-only transient playback state so leases cannot cross test cases.
    with m.thumbnail_service.lock:m.thumbnail_service.playback_leases.clear()
    with m.thumbnail_service.mutation(),m.connection() as db:
        db.execute('DELETE FROM media')
        db.execute('DELETE FROM thumbnail_jobs')
        db.execute('DELETE FROM series_groups')
        db.execute('DELETE FROM playlist_items')
        db.execute('DELETE FROM playlists')
        db.execute('DELETE FROM roots')
        db.execute('DELETE FROM scan_checkpoint')
        db.execute('DELETE FROM preferences')
        db.executemany('INSERT INTO roots(id,path,added_at) VALUES(?,?,0)', [(1,str(Path(temp.name)/'A')), (2,str(Path(temp.name)/'B'))])
        for i in range(1,348):
            path = {1:source,2:second,3:third,4:invalid,5:transport_stream}.get(i, Path(temp.name)/f'video-{i}.mp4')
            db.execute('''INSERT INTO media(id,path,root_id,name,title,kind,ext,duration,width,height,video_codec,audio_tracks,subtitles,
                favorite,progress,watched,last_played,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)''',
                (i,str(path),2 if i==2 else 1,f'video-{i}',f'视频 {i:03d}','episode' if i==3 else 'movie',path.suffix,
                 120,320,180,'h264','[{"codec":"aac","language":"und"}]',
                 '[{"index":2,"codec":"subrip","language":"und","title":""}]' if i==3 else '[]',
                 int(i==1),12 if i==1 else 0,0,100 if i==1 else 0,1000-i))
    m.thumbnail_service.pause(False)
    return {'ok':True}

@m.app.get('/test/screenshot-directory')
def screenshot_test_directory():
    directory=Path(temp.name)/'custom-screenshots';directory.mkdir(exist_ok=True)
    return {'directory':str(directory)}

@m.app.get('/test/sessions')
def sessions():
    return {'count':len(m.playback.sessions), 'folders':len(list(m.HLS.iterdir()))}

@m.app.post('/test/two-audio-fixture')
def two_audio_fixture():
    path = Path(temp.name) / 'two-audio.mp4'
    if not path.exists():
        subprocess.run([m.executable('ffmpeg'),'-v','error','-i',str(source),'-f','lavfi','-i','sine=frequency=880',
                        '-map','0:v:0','-map','0:a:0','-map','1:a:0','-t','120','-c:v','copy','-c:a','aac',str(path)],check=True)
    metadata = m.probe(path)
    with m.connection() as db:
        db.execute('UPDATE media SET path=?,audio_tracks=? WHERE id=2', (str(path),json.dumps(metadata['audio_tracks'])))
    return {'ok':True}

@m.app.post('/test/many-roots')
def many_roots():
    with m.connection() as db:
        db.executemany('INSERT INTO roots(id,path,added_at) VALUES(?,?,0)',
                       [(1000 + index, str(Path(temp.name) / f'folder-{index:05}')) for index in range(10_000)])
    return {'ok': True}

@m.app.post('/test/series-fixture')
def series_fixture():
    path=Path(temp.name)/'episode.mp4'
    if not path.exists():shutil.copyfile(source,path)
    with m.connection() as db:
        db.executemany('''INSERT INTO media(id,path,root_id,name,title,kind,season,episode,missing,
            ext,duration,width,height,video_codec,audio_tracks,created_at,updated_at)
            VALUES(?,?,1,?,?,'episode',?,?,?,'.mp4',120,320,180,'h264','[]',0,0)''',
            [(1000+i,str(path if i==1 else Path(temp.name)/f'episode-{i}.mp4'),f'S{(i-1)//60:02}E{(i-1)%60+1:02}.mp4',
              '测试剧集' if i<=180 else f'剧集 {(i-181)//10:03}',(i-1)//60 if i<=180 else 1,(i-1)%60+1,int(i==2)) for i in range(1,1001)])
    return {'ok':True}

@m.app.post('/test/thumbnail-fixture')
def thumbnail_fixture():
    # Real JPEG fixture, distinct from a failed/missing thumbnail database marker.
    good = m.thumbnail(source, 1, 120, force=True)
    with m.connection() as db:
        db.execute('UPDATE media SET thumbnail=?,updated_at=1 WHERE id=1', (good,))
        db.execute("UPDATE media SET thumbnail='thumbnails/999999.jpg',updated_at=1 WHERE id=2")
    return {'ok':bool(good)}

@m.app.post('/test/repair-thumbnail-fixture')
def repair_thumbnail_fixture():
    good = m.thumbnail(second, 2, 120, force=True)
    with m.connection() as db: db.execute('UPDATE media SET thumbnail=?,updated_at=2 WHERE id=2',(good,))
    return {'ok':bool(good)}

@m.app.post('/test/folder-fixture')
def folder_fixture():
    root = Path(temp.name) / 'folder-library'
    paths = ['root.mp4', 'Drama/first.mp4', 'Drama/Season 1/second.mp4', 'Drama-long/other.mp4', '100%_clips/literal.mp4']
    with m.connection() as db:
        db.execute('INSERT INTO roots(id,path,added_at) VALUES(50,?,0)', (str(root),))
        for index, relative in enumerate(paths):
            path = root.joinpath(*relative.split('/'))
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists(): shutil.copyfile(source, path)
            db.execute('''INSERT INTO media(id,path,root_id,name,title,ext,duration,width,height,video_codec,audio_tracks,
                created_at,updated_at,favorite) VALUES(?,?,50,?,?,'.mp4',120,320,180,'h264','[]',0,0,?)''',
                       (1001+index, str(path),path.name, path.stem,int(index==1)))
    return {'root_id':50}

@m.app.post('/test/many-subfolders')
def many_subfolders():
    root = Path(temp.name) / 'many-subfolders'
    with m.connection() as db:
        db.execute('INSERT INTO roots(id,path,added_at) VALUES(60,?,0)', (str(root),))
        db.executemany('''INSERT INTO media(id,path,root_id,name,title,created_at,updated_at)
            VALUES(?,?,60,'video.mp4','video',0,0)''',
            [(20000+index,str(root / f'folder-{index:05}' / 'video.mp4')) for index in range(10000)])
    return {'root_id':60}

@m.app.post('/test/media/{media_id}/missing')
def mark_media_missing(media_id: int):
    with m.connection() as db: db.execute('UPDATE media SET missing=1 WHERE id=?', (media_id,))
    return {'ok': True}

@m.app.post('/test/large-playlist')
def large_playlist():
    with m.connection() as db:
        db.execute("INSERT INTO playlists(id,name,created_at) VALUES(500,'万条片单',0)")
        db.executemany('''INSERT INTO media(id,path,name,title,ext,missing,created_at,updated_at)
            VALUES(?,?,?,? ,'.mp4',0,0,0)''',
            [(30000+i,str(Path(temp.name)/f'large-{i:05}.mp4'),f'large-{i:05}.mp4',f'大片单 {i:05}') for i in range(1,9999)])
        db.executemany('INSERT INTO playlist_items VALUES(500,?,?)',[(1,0),(2,1)]+[(30000+i,i+1) for i in range(1,9999)])
    return {'id':500}

@m.app.post('/test/hdr-fixture')
def hdr_fixture():
    path=Path(temp.name)/'hdr.mkv'
    if not path.exists():
        subprocess.run([m.executable('ffmpeg'),'-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=12',
                        '-t','3','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p10le',
                        '-x264-params','colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=tv',str(path)],check=True)
    with m.connection() as db:
        db.execute("UPDATE media SET path=?,ext='.mkv',width=160,height=90,duration=3,video_color='{}' WHERE id=6",(str(path),))
    return {'id':6}

@m.app.post('/test/shutdown')
def shutdown():
    server.should_exit = True
    return {'ok':True}

reset()
m.app.router.routes.append(frontend_route)
if __name__ == '__main__':
    server = uvicorn.Server(uvicorn.Config(m.app, host='127.0.0.1', port=8877, log_level='warning', timeout_graceful_shutdown=5))
    try: server.run()
    finally: m.playback.close(); temp.cleanup()
