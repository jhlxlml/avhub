"""Read-only real playback against a COPY of an isolated benchmark index."""
import argparse
import json
import os
import shutil
import socket
import sqlite3
import sys
import tempfile
from pathlib import Path

PROJECT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(PROJECT))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index',type=Path,required=True);parser.add_argument('--source',type=Path,required=True)
    args=parser.parse_args();index=args.index.resolve(strict=True);root=args.source.resolve(strict=True)
    benchmark_root=(PROJECT/'build'/'scan-benchmarks').resolve()
    if not index.is_relative_to(benchmark_root):parser.error('Use an isolated scan benchmark index, never the daily library')
    with tempfile.TemporaryDirectory(prefix='avhub-real-startup-') as temporary:
        data=Path(temporary)/'data';data.mkdir()
        with sqlite3.connect(index.as_uri()+'?mode=ro',uri=True) as original,sqlite3.connect(data/'library.db') as destination:
            original.backup(destination)
        os.environ['AVHUB_DATA_DIR']=str(data);os.environ.pop('AVHUB_SESSION_TOKEN',None)
        from app import main as m
        import uvicorn
        samples=[];source_stats={}
        with m.connection() as db:
            for ext,codec in [('.mp4','h264'),('.ts','h264'),('.mkv','vp9'),('.mp4','hevc'),('.mp4','av1')]:
                row=db.execute('SELECT id,path,ext,video_codec,width,height FROM media WHERE ext=? AND video_codec=? AND duration>5 ORDER BY width*height DESC,id LIMIT 1',(ext,codec)).fetchone()
                if not row:continue
                path=Path(row['path']).resolve(strict=True)
                if not path.is_relative_to(root):raise ValueError('Sample outside authorized source')
                stat=path.stat();source_stats[path]=(stat.st_size,stat.st_mtime_ns)
                samples.append({key:row[key] for key in ['id','ext','video_codec','width','height']})
                preview=index.parent/'thumbnails'/f"{row['id']}.jpg"
                if preview.is_file():shutil.copyfile(preview,m.THUMBS/preview.name)
            total=db.execute('SELECT COUNT(*) FROM media').fetchone()[0]
            # Daily history in the copied benchmark DB is empty; make retries
            # within this isolated server start from zero, never a resume prompt.
            db.execute('UPDATE media SET progress=0,watched=0')
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(128)
        server=uvicorn.Server(uvicorn.Config(m.app,host='127.0.0.1',port=listener.getsockname()[1],log_level='error',timeout_graceful_shutdown=2))
        @m.app.post('/benchmark/shutdown')
        def shutdown():server.should_exit=True;return {'ok':True}
        print(json.dumps({'url':f'http://127.0.0.1:{listener.getsockname()[1]}','samples':samples,'indexed':total,'build':m.BUILD}),flush=True)
        try:server.run(sockets=[listener])
        finally:
            m.scanner.close();m.playback.close();listener.close()
            unchanged=all((path.stat().st_size,path.stat().st_mtime_ns)==value for path,value in source_stats.items())
            print(json.dumps({'source_unchanged':unchanged,'verification':'sample sizes/mtime, no full-file hash'}),flush=True)
            if not unchanged:raise RuntimeError('Sample source metadata changed')


if __name__=='__main__':main()
