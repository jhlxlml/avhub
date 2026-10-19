"""Engine-neutral per-source choices. Only SQLite is written, never media."""
import hashlib
import json
from pathlib import Path
from fastapi import HTTPException
from .preferences import number


def source_key(item, external):
    try:
        stat=Path(item['path']).stat()
        actual=[stat.st_dev,stat.st_ino,stat.st_size,stat.st_mtime_ns]
    except OSError:actual=None
    sidecars=[]
    for path in sorted({value['path'] for value in external}):
        try:
            stat=Path(path).stat()
            sidecars.append([path,stat.st_size,stat.st_mtime_ns])
        except OSError:continue
    identity=[actual,item.get('source_identity'),item.get('size'),item.get('modified'),item.get('audio_tracks'),item.get('subtitles'),sidecars]
    return hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def validate_changes(item, external, changes):
    if not isinstance(changes,dict) or not changes or set(changes)-{'audio','subtitle','delay'}:
        raise HTTPException(422,'播放记忆字段无效')
    if 'audio' in changes:
        audio=changes['audio']
        if audio is not None and (type(audio) is not int or not any(t.get('index')==audio for t in item['audio_tracks'])):
            raise HTTPException(422,'音轨已变化，请重新选择')
    if 'subtitle' in changes:
        choices={'',None}|{f"embedded:{t['index']}" for t in item['subtitles']}|{t['path'] for t in external}
        if not isinstance(changes['subtitle'],(str,type(None))) or changes['subtitle'] not in choices:
            raise HTTPException(422,'字幕已变化，请重新选择')
    if 'delay' in changes and not number(changes['delay'],-10,10):raise HTTPException(422,'字幕延迟无效')
    return changes


def read(db,item,external):
    source=source_key(item,external)
    default={'source':source,'audio':None,'subtitle':None,'delay':0}
    row=db.execute('SELECT value FROM preferences WHERE key=?',(f"playback.{item['id']}",)).fetchone()
    if row:
        try:
            saved=json.loads(row['value'])
            if saved.get('source')==source:
                changes={key:saved[key] for key in ('audio','subtitle','delay')}
                validate_changes(item,external,changes)
                return {**default,**changes}
        except (HTTPException,ValueError,KeyError,TypeError,AttributeError):pass
    return default
