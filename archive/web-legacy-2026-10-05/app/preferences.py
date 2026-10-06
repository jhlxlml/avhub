"""Validated portable preferences. Video paths are never opened by this module."""
import math
import re
from fastapi import HTTPException

GLOBAL_KEYS = {'audio','playbackSpeed','subtitleAppearance','hoverPreview','queueOpen','autoNext','queueMode','queueScope','screenshots','appearance','nativePrepare'}


def validate(key, value):
    valid = False
    if key in {'hoverPreview','queueOpen','autoNext','nativePrepare'}:
        valid = isinstance(value,bool)
    elif key == 'queueMode':
        valid = value in ('sequential','random','repeat-one')
    elif key == 'queueScope':
        valid = value in ('series','directory')
    elif key == 'appearance' and isinstance(value,dict):
        valid = (set(value)=={'theme','coverSize'} and value.get('theme') in ('dark','light')
                 and value.get('coverSize') in ('compact','standard','comfortable','large'))
    elif key == 'playbackSpeed':
        valid = type(value) in (int,float) and value in (.5,.75,1,1.25,1.5,2)
    elif key == 'audio' and isinstance(value,dict):
        valid = set(value)=={'volume','muted'} and number(value.get('volume'),0,1) and isinstance(value.get('muted'),bool)
    elif key == 'subtitleAppearance' and isinstance(value,dict):
        valid = (set(value)=={'size','color','background'} and value.get('size') in (22,26,30,34,38)
                 and value.get('color') in ('#ffffff','#ffe38a','#9de7ff') and number(value.get('background'),0,.85)
                 and value.get('background') in (0,.35,.65,.85))
    elif key=='screenshots' and isinstance(value,dict):
        from pathlib import Path
        directory=value.get('directory')
        valid=(set(value)=={'directory','shortcut'} and value.get('shortcut') in ('F8','Shift+S','C')
               and isinstance(directory,str) and len(directory)<=4096 and not re.search(r'[\x00-\x1f<>"|?*]',directory)
               and not directory.startswith(('\\\\?\\','\\\\.\\')) and ':' not in directory[len(Path(directory).drive):]
               and (not directory or Path(directory).is_absolute()))
    elif re.fullmatch(r'subtitle\.[1-9]\d{0,15}',key) and isinstance(value,dict):
        valid = set(value)=={'id','delay'} and isinstance(value.get('id'),str) and len(value['id'])<=4096 and number(value.get('delay'),-10,10)
    if not valid: raise HTTPException(422,'设置名称或值无效')
    # Read/import old screenshot settings without discarding the saved directory.
    # Legacy shortcuts no longer activate; all reads and future writes use C.
    if key=='screenshots':return {**value,'shortcut':'C'}
    return value


def number(value, minimum, maximum):
    return type(value) in (int,float) and math.isfinite(value) and minimum<=value<=maximum
