"""Preview-first cleanup of recognized derived files, never source media."""
import hashlib
import json
import re
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from .cache_owner import orphaned

ROLLBACK=re.compile(r'before-restore-\d{8}-\d{6}-[a-f0-9]{8}\.db\Z')
IMAGE=re.compile(r'[1-9]\d{0,18}\.jpg\Z')


def owned(path,data):
    try:return not path.is_symlink() and path.resolve()==data.resolve()/path.relative_to(data) and path.is_file()
    except (OSError,ValueError):return False


def inventory(data):
    # Do not follow directory links/junctions, including links inside a cache.
    result={};pending=[data]
    while pending:
        parent=pending.pop()
        try:children=list(parent.iterdir())
        except OSError:continue
        for path in children:
            try:
                if path.is_symlink() or path.resolve()!=data.resolve()/path.relative_to(data):continue
                if path.is_dir():pending.append(path)
                elif path.is_file():result[path.relative_to(data).as_posix()]=path.stat()
            except OSError:continue
    return result


def plan(data,db,rollback_days=None,active_tokens=()):
    files=inventory(data)
    categories={key:{'bytes':0,'files':0} for key in ['database','thumbnails','covers','subtitles','hls','native-cache','backups','other']}
    for name,info in files.items():
        top=name.split('/')[0]
        kind='database' if name in ('library.db','library.db-wal','library.db-shm') else {'subtitle-cache':'subtitles'}.get(top,top if top in categories else 'other')
        categories[kind]['bytes']+=info.st_size;categories[kind]['files']+=1
    protected=set()
    sources=set()
    def protect_sources(database):
        for row in database.execute('SELECT path FROM media'):
            try:sources.add(Path(row[0]).absolute().relative_to(data.absolute()).as_posix())
            except (ValueError,TypeError,OSError):continue
    with closing(sqlite3.connect(db.absolute().as_uri()+'?mode=ro',uri=True)) as database:
        protect_sources(database)
        protected.update(f'thumbnails/{row[0]}.jpg' for row in database.execute('SELECT id FROM media WHERE thumbnail IS NOT NULL'))
        # Pending work may publish after the preview; keep its same-ID file.
        protected.update(f'thumbnails/{row[0]}.jpg' for row in database.execute('SELECT media_id FROM thumbnail_jobs'))
    rollbacks=sorted((name for name in files if name.startswith('backups/') and ROLLBACK.fullmatch(Path(name).name)),key=lambda name:files[name].st_mtime_ns,reverse=True)
    selected=set(name for name in rollbacks[3:] if rollback_days is not None and files[name].st_mtime<time.time()-rollback_days*86400)
    uncertain=False
    for name in rollbacks:
        if name in selected:continue
        try:
            with closing(sqlite3.connect((data/name).absolute().as_uri()+'?mode=ro',uri=True)) as database:
                protect_sources(database)
                protected.update(f'thumbnails/{row[0]}.jpg' for row in database.execute('SELECT id FROM media WHERE thumbnail IS NOT NULL'))
        except sqlite3.DatabaseError:uncertain=True
    candidates=[]
    for name,info in files.items():
        parts=Path(name).parts
        if len(parts)==2 and parts[0]=='thumbnails' and IMAGE.fullmatch(parts[1]) and name not in protected and not uncertain:
            candidates.append(name)
    # Interrupted subtitle conversions are temporary directories; require all
    # recognized files to have been idle for a day. Unknown entries stay put.
    folder_candidates=[]
    for category in ['subtitle-cache','hls']:
        parent=data/category
        if not parent.is_dir() or parent.resolve()!=data.resolve()/category:continue
        for folder in parent.iterdir():
            if not folder.is_dir() or folder.is_symlink() or folder.resolve()!=data.resolve()/category/folder.name:continue
            names=[name for name in files if name.startswith(f'{category}/{folder.name}/')]
            if category=='hls':
                if not re.fullmatch(r'[a-f0-9]{32}',folder.name) or folder.name in active_tokens or not orphaned(folder):continue
                allowed=all(re.fullmatch(r'(?:owner\.json|ffmpeg\.log|index\.m3u8|init\.mp4|segment_\d+\.(?:ts|m4s))',Path(name).name) and len(Path(name).parts)==3 for name in names)
            else:
                allowed=re.fullmatch(r'(?:ass|embedded)-[a-zA-Z0-9_-]+',folder.name) and bool(names) and all(Path(name).name in ('source.ass','subtitle.vtt') and len(Path(name).parts)==3 and files[name].st_mtime<time.time()-86400 for name in names)
            # Also refuse a linked, unreadable or unrecognized child omitted by inventory.
            try:children=list(folder.iterdir());allowed=allowed and len(children)==len(names) and all(owned(child,data) for child in children)
            except OSError:allowed=False
            if allowed and not sources.intersection(names):folder_candidates.append(folder.relative_to(data).as_posix());candidates.extend(names)
    candidates.extend(selected);candidates=sorted(set(candidates)-sources)
    evidence=[(name,files[name].st_size,files[name].st_mtime_ns) for name in candidates]
    token=hashlib.sha256(json.dumps([rollback_days,evidence],separators=(',',':')).encode()).hexdigest()
    return {'categories':categories,'total_bytes':sum(item['bytes'] for item in categories.values()),
            'cleanup':{'files':len(candidates),'bytes':sum(files[name].st_size for name in candidates),'rollback_files':len(selected),
                       'rollback_days':rollback_days,'token':token,'protected_note':'原视频、手动封面、当前引用及保留回滚副本不清理；未知文件和链接跳过'},
            '_files':evidence,'_folders':folder_candidates}


def clean(data,preview):
    removed=0;freed=0;skipped=0
    for name,size,modified in preview['_files']:
        path=data/name
        try:
            if not owned(path,data) or path.stat().st_size!=size or path.stat().st_mtime_ns!=modified:
                skipped+=1;continue
            path.unlink();removed+=1;freed+=size
        except OSError:skipped+=1
    # No recursive deletion: only remove proven empty, recognized cache dirs.
    for name in preview['_folders']:
        folder=data/name
        try:
            if folder.resolve()==data.resolve()/name and not folder.is_symlink():folder.rmdir()
        except OSError:pass
    return {'ok':True,'removed':removed,'freed_bytes':freed,'skipped':skipped,'recoverable':False}


def public(preview):return {key:value for key,value in preview.items() if not key.startswith('_')}
