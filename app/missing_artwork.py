"""Explicit preview/selection cleanup of missing-media generated artwork only."""
import hashlib
import json
import os
import sqlite3
import stat
import time
from contextlib import closing
from pathlib import Path
from fastapi import HTTPException
from . import artwork_readers
from .storage_management import ROLLBACK,owned

NOTE='仅清理所选自动封面；保留索引、收藏、进度、片单和手动封面。原视频不变，文件移回后刷新可重新生成封面。'


def source_references(db,targets):
    # Stream compact DB paths, retain at most one page of matches. No disk walk
    # or Unicode-insensitive SQLite LIKE assumptions for original protection.
    found=set()
    for row in db.execute('SELECT path FROM media'):
        try:value=os.path.abspath(row[0]).casefold()
        except (ValueError,TypeError):return set(targets.values())
        if value in targets:found.add(targets[value])
    return found


def plain(node):
    info=node.lstat()
    return not stat.S_ISLNK(info.st_mode) and not (getattr(info,'st_file_attributes',0)&0x400)


def root_available(root):
    try:
        if not root.is_absolute() or not root.is_dir():return False
        if any(not plain(node) for node in (root,*root.parents)):return False
        with os.scandir(root) as entries:next(entries,None)
        return True
    except (OSError,ValueError):return False


def absent(root,source):
    try:
        relative=source.relative_to(root)
        if not relative.parts:return False
        node=root
        for part in relative.parts:
            node=node/part
            try:
                if not plain(node):return False
            except FileNotFoundError:
                # A disconnected root is never evidence of permanent removal.
                return root_available(root)
        return False
    except (OSError,ValueError):return False


def backup_protection(data,ids):
    """Retain all recognized rollback references; unreadable evidence fails safe."""
    parent=data/'backups';protected=set();evidence=[]
    targets={str((data/'thumbnails'/f'{media_id}.jpg').absolute()).casefold():media_id for media_id in ids}
    try:
        if not parent.exists():return protected,evidence,False
        if parent.resolve()!=data.resolve()/'backups' or not plain(parent):return set(ids),[],True
        paths=sorted(p for p in parent.iterdir() if ROLLBACK.fullmatch(p.name))
        for path in paths:
            if not owned(path,data):return set(ids),[],True
            info=path.stat();evidence.append((path.name,info.st_size,info.st_mtime_ns))
            with closing(sqlite3.connect(path.absolute().as_uri()+'?mode=ro',uri=True,timeout=.5)) as db:
                if ids:
                    protected.update(row[0] for row in db.execute('SELECT id FROM media WHERE thumbnail IS NOT NULL AND id IN ('+','.join('?' for _ in ids)+')',ids))
                    protected.update(source_references(db,targets))
        return protected,evidence,False
    except (OSError,sqlite3.Error):return set(ids),[],True


def preview(data,db,page=1,size=24,active_ids=()):
    total=db.execute("SELECT COUNT(*) FROM media WHERE missing=1 AND file_state='normal'").fetchone()[0]
    pages=max(1,(total+size-1)//size);page=min(page,pages)
    rows=[dict(row) for row in db.execute('''SELECT m.id,m.path,m.title,m.name,m.root_id,m.thumbnail,m.custom_cover,
        m.source_identity,m.size,m.modified,r.path AS root_path FROM media m LEFT JOIN roots r ON r.id=m.root_id
        WHERE m.missing=1 AND m.file_state='normal' ORDER BY m.id LIMIT ? OFFSET ?''',(size,(page-1)*size))]
    ids=[row['id'] for row in rows];protected,backups,uncertain=backup_protection(data,ids)
    # Even malformed/restored source records inside the cache must not be removed.
    source_ids=source_references(db,{str((data/'thumbnails'/f'{media_id}.jpg').absolute()).casefold():media_id for media_id in ids})
    roots={};items=[];evidence=[]
    for row in rows:
        root=Path(row['root_path']) if row['root_path'] else None
        if root is not None and str(root) not in roots:roots[str(root)]=root_available(root)
        path=data/'thumbnails'/f"{row['id']}.jpg";info=None
        try:
            if owned(path,data):info=path.stat()
        except OSError:pass
        reason=''
        if not root or not roots[str(root)]:reason='目录离线或不可访问'
        elif not absent(root,Path(row['path'])):reason='文件已出现或路径需核对，请刷新媒体库'
        elif not row['thumbnail'] or info is None:reason='没有可清理的自动封面'
        elif row['id'] in source_ids:reason='该路径被登记为源文件，已保护'
        elif row['id'] in active_ids or artwork_readers.active(path):reason='视频或封面正在使用'
        elif uncertain:reason='回滚副本无法核对，已保护'
        elif row['id'] in protected:reason='回滚副本仍引用此封面'
        eligible=not reason
        items.append({'id':row['id'],'title':row['title'] or row['name'],'path':row['path'],'root_path':row['root_path'],
            'eligible':eligible,'bytes':info.st_size if info else 0,'reason':reason or '可清理自动封面','manual_cover_kept':bool(row['custom_cover'])})
        evidence.append((row,eligible,info.st_size if info else None,info.st_mtime_ns if info else None,
                         getattr(info,'st_ino',None),getattr(info,'st_dev',None),reason))
    token=hashlib.sha256(json.dumps([str(data.resolve()),page,size,evidence,backups],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return {'items':items,'total':total,'page':page,'page_size':size,'pages':pages,'token':token,
        'eligible_count':sum(item['eligible'] for item in items),'eligible_bytes':sum(item['bytes'] for item in items if item['eligible']),
        'note':NOTE,'_evidence':evidence,'_backups':backups}


def validate_snapshot(data,db,report,ids,active_ids=()):
    """Short locked validation; no rollback SQLite opens or directory walks.

    Final source/cache ownership and presence checks remain in clean(). Backups
    are immutable application snapshots: reject any inventory change under the
    publication/restore fence rather than repeating their slow DB reads.
    """
    def changed():raise HTTPException(409,'失效封面或目录状态已变化，请刷新预览后重新选择')
    if set(ids)&set(active_ids):changed()
    parent=data/'backups';backups=[]
    try:
        if parent.exists():
            if parent.resolve()!=data.resolve()/'backups' or not plain(parent):changed()
            for path in sorted(p for p in parent.iterdir() if ROLLBACK.fullmatch(p.name)):
                if not owned(path,data):changed()
                info=path.stat();backups.append((path.name,info.st_size,info.st_mtime_ns))
    except OSError:changed()
    if backups!=report['_backups']:changed()
    for entry in report['_evidence']:
        original=entry[0]
        current=db.execute('''SELECT m.id,m.path,m.title,m.name,m.root_id,m.thumbnail,m.custom_cover,
            m.source_identity,m.size,m.modified,r.path AS root_path FROM media m LEFT JOIN roots r ON r.id=m.root_id
            WHERE m.id=? AND m.missing=1 AND m.file_state='normal' ''',(original['id'],)).fetchone()
        if current is None or dict(current)!=original:changed()
    targets={str((data/'thumbnails'/f'{media_id}.jpg').absolute()).casefold():media_id for media_id in ids}
    if source_references(db,targets):changed()


def clean(data,db,report,ids):
    selected=set(ids);by_id={row['id']:row for row in report['items']}
    if not selected or any(value not in by_id or not by_id[value]['eligible'] for value in selected):
        raise HTTPException(409,'所选项目已不可清理，请刷新预览')
    removed=0;freed=0;skipped=0
    fingerprints={entry[0]['id']:entry for entry in report['_evidence']}
    for media_id in sorted(selected):
        entry=fingerprints[media_id];row=entry[0];path=data/'thumbnails'/f'{media_id}.jpg'
        try:
            info=path.stat()
            if (not owned(path,data) or artwork_readers.active(path) or
                (info.st_size,info.st_mtime_ns,info.st_ino,info.st_dev)!=(entry[2],entry[3],entry[4],entry[5]) or
                not root_available(Path(row['root_path'])) or not absent(Path(row['root_path']),Path(row['path']))):
                skipped+=1;continue
            path.unlink()
            db.execute('UPDATE media SET thumbnail=NULL,updated_at=? WHERE id=? AND missing=1 AND file_state=\'normal\'',(time.time(),media_id))
            removed+=1;freed+=info.st_size
        except OSError:skipped+=1
    return {'ok':True,'removed':removed,'freed_bytes':freed,'skipped':skipped,'retained_indexes':len(selected)}
