"""Copy a benchmark index into a new project-local profile; sources read-only."""
import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

PROJECT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(PROJECT))
parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True)
parser.add_argument('--index',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args();source=args.source.resolve(strict=True);index=args.index.resolve(strict=True);output=args.output.resolve()
if not index.is_relative_to(PROJECT/'build'/'scan-benchmarks') or not output.is_relative_to(PROJECT/'build') or output.is_relative_to(source):
    parser.error('Use only a benchmark input and project build output, never a source directory')
output.mkdir(parents=True,exist_ok=False);os.environ['AVHUB_DATA_DIR']=str(output)
from app import main as m
with sqlite3.connect(index.as_uri()+'?mode=ro',uri=True) as original,sqlite3.connect(m.DB) as target:original.backup(target)
m.bootstrap();samples=[]
with m.connection() as db:
    db.execute('DELETE FROM thumbnail_jobs');db.execute('INSERT OR REPLACE INTO thumbnail_control VALUES(1,1)')
    db.execute('UPDATE media SET progress=0,watched=0')
    db.execute('INSERT OR REPLACE INTO preferences(key,value,updated_at) VALUES(?,?,?)',('audio','{"volume":0,"muted":true}',0))
    for ext,codec in [('.mp4','h264'),('.ts','h264'),('.mkv','vp9'),('.mp4','hevc'),('.mp4','av1')]:
        row=db.execute('SELECT id,path,ext,video_codec,width,height,duration,video_color FROM media WHERE ext=? AND video_codec=? AND duration>5 ORDER BY width*height DESC,id LIMIT 1',(ext,codec)).fetchone()
        if not row:continue
        path=Path(row['path']).resolve(strict=True)
        if not path.is_relative_to(source):raise ValueError('Sample outside authorized source')
        stat=path.stat()
        samples.append({**{key:row[key] for key in ['id','ext','video_codec','width','height','duration','video_color']},
            'path':str(path),'before':{'size':stat.st_size,'mtimeNs':str(stat.st_mtime_ns)}})
(output/'samples-private.json').write_text(json.dumps(samples),encoding='utf-8')
print(json.dumps({'samples':len(samples),'data':str(output)}));m.playback.close()
