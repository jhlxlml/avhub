"""Seed ONE read-only source into a new, owned diagnostic profile."""
import json
import os
import sys
from pathlib import Path

project = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project))
source = Path(sys.argv[1]).resolve(strict=True)
data = Path(sys.argv[2]).resolve()
if not data.is_relative_to(project / 'build') or data.exists():
    raise ValueError('A new project build profile is required')
data.mkdir(parents=True)
os.environ['AVHUB_DATA_DIR'] = str(data)
from app.sqlite_runtime import initialize
initialize()
from app import main as m
metadata = m.probe(source)
with m.connection() as db:
    db.execute('INSERT INTO roots(id,path,added_at) VALUES(1,?,0)', (str(source.parent),))
    db.execute('''INSERT INTO media(id,path,root_id,name,title,ext,duration,width,height,
        video_codec,audio_tracks,subtitles,video_color,size,created_at,updated_at)
        VALUES(1,?,1,?,?,?,?,?,?,?,?,?,?,?,0,0)''',
        (str(source), source.name, source.stem, source.suffix, metadata['duration'], metadata['width'],
         metadata['height'], metadata['video_codec'], json.dumps(metadata['audio_tracks']),
         json.dumps(metadata['subtitles']), json.dumps(metadata.get('video_color') or {}), source.stat().st_size))
    db.execute('INSERT OR REPLACE INTO thumbnail_control VALUES(1,1)')
m.set_preferences(m.PreferencesInput(values={'playerEngine':'chromium','resumeBehavior':'restart',
    'autoNext':False,'audio':{'volume':0,'muted':True}}))
print(json.dumps({'codec':metadata['video_codec'],'width':metadata['width'],'height':metadata['height'],'audio':metadata['audio_tracks']}))
m.playback.close()
