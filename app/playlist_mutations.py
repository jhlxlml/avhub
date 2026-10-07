"""Bounded, atomic playlist membership changes. Source media is never touched."""
from typing import Annotated, Literal
import sqlite3
import time
from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from .playlist_pages import summary

MediaId = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]


class PlaylistCreateInput(BaseModel):
    name: str = Field(min_length=1,max_length=80)
    media_id: MediaId | None = None
    media_ids: list[MediaId] | None = Field(default=None,min_length=1,max_length=500)

    @model_validator(mode='after')
    def unique(self):
        if self.media_id is not None and self.media_ids is not None:
            raise ValueError('请选择单条或批量加入，不要同时提交')
        if self.media_ids is not None and len(set(self.media_ids)) != len(self.media_ids):
            raise ValueError('不能重复选择同一个视频')
        return self


def create(db, value: PlaylistCreateInput):
    db.execute('BEGIN IMMEDIATE')
    name=value.name.strip()
    if not name: raise HTTPException(422,'播放列表名称不能为空')
    ids=getattr(value,'media_ids',None) or ([value.media_id] if value.media_id is not None else [])
    if ids:
        placeholders=','.join('?' for _ in ids)
        if db.execute(f'SELECT COUNT(*) FROM media WHERE missing=0 AND id IN ({placeholders})',ids).fetchone()[0] != len(ids):
            raise HTTPException(404,'视频不存在或已离线，未创建播放列表')
    try: cursor=db.execute('INSERT INTO playlists(name,created_at) VALUES(?,?)',(name,time.time()))
    except sqlite3.IntegrityError as exc: raise HTTPException(409,'已有同名播放列表') from exc
    identity=cursor.lastrowid
    db.executemany('INSERT INTO playlist_items(playlist_id,media_id,position) VALUES(?,?,?)',[(identity,item,index) for index,item in enumerate(ids,1)])
    if ids: db.execute('UPDATE playlists SET revision=1 WHERE id=?',(identity,))
    return {'id':identity,'name':name,'count':len(ids)}


class PlaylistBatchInput(BaseModel):
    action: Literal['add', 'remove']
    media_ids: list[MediaId] = Field(min_length=1, max_length=500)
    expected_revision: int = Field(strict=True, ge=0)

    @model_validator(mode='after')
    def unique(self):
        if len(set(self.media_ids)) != len(self.media_ids):
            raise ValueError('不能重复选择同一个视频')
        return self


class RemovedItem(BaseModel):
    media_id: MediaId
    position: int = Field(strict=True, ge=0, le=9007199254740991)


class PlaylistRestoreInput(BaseModel):
    removed: list[RemovedItem] = Field(min_length=1, max_length=500)
    expected_revision: int = Field(strict=True, ge=0)

    @model_validator(mode='after')
    def unique(self):
        ids = [item.media_id for item in self.removed]
        if len(set(ids)) != len(ids):
            raise ValueError('撤销内容包含重复视频')
        return self


def require_revision(db, identity, revision):
    if summary(db, identity)['revision'] != revision:
        raise HTTPException(409, '播放列表内容已变化，请刷新后重试；不会覆盖新的顺序')


def batch(db, identity, value: PlaylistBatchInput):
    db.execute('BEGIN IMMEDIATE')
    require_revision(db, identity, value.expected_revision)
    ids = value.media_ids
    placeholders = ','.join('?' for _ in ids)
    members = {row['media_id']: row['position'] for row in db.execute(
        f'SELECT media_id,position FROM playlist_items WHERE playlist_id=? AND media_id IN ({placeholders})', [identity, *ids])}
    if value.action == 'remove':
        if len(members) != len(ids):
            raise HTTPException(409, '选中的视频已不在列表中，请刷新后重试')
        removed = [{'media_id': identity_, 'position': members[identity_]} for identity_ in ids]
        db.execute(f'DELETE FROM playlist_items WHERE playlist_id=? AND media_id IN ({placeholders})', [identity, *ids])
        changed = len(ids)
        result = {'removed': removed}
    else:
        available = db.execute(f'SELECT COUNT(*) FROM media WHERE missing=0 AND id IN ({placeholders})', ids).fetchone()[0]
        if available != len(ids):
            raise HTTPException(409, '选中的视频有离线或不存在的记录，未添加任何视频；请刷新后重新选择')
        start = db.execute('SELECT COALESCE(MAX(position),0) FROM playlist_items WHERE playlist_id=?', (identity,)).fetchone()[0]
        added = [identity_ for identity_ in ids if identity_ not in members]
        if start + len(added) > 9007199254740991:
            raise HTTPException(409, '播放列表的顺序编号过大，请先整理列表顺序')
        db.executemany('INSERT INTO playlist_items(playlist_id,media_id,position) VALUES(?,?,?)',
                       [(identity, identity_, start + index) for index, identity_ in enumerate(added, 1)])
        changed = len(added)
        result = {'added': changed, 'existing': len(members)}
    if changed:
        db.execute('UPDATE playlists SET revision=revision+1 WHERE id=?', (identity,))
    return {**summary(db, identity), **result}


def restore(db, identity, value: PlaylistRestoreInput):
    db.execute('BEGIN IMMEDIATE')
    require_revision(db, identity, value.expected_revision)
    ids = [item.media_id for item in value.removed]
    placeholders = ','.join('?' for _ in ids)
    if db.execute(f'SELECT COUNT(*) FROM playlist_items WHERE playlist_id=? AND media_id IN ({placeholders})', [identity, *ids]).fetchone()[0]:
        raise HTTPException(409, '待恢复的视频已在列表中，无法重复撤销')
    # Missing media may be restored as an offline member, just as before removal.
    if db.execute(f'SELECT COUNT(*) FROM media WHERE id IN ({placeholders})', ids).fetchone()[0] != len(ids):
        raise HTTPException(409, '待恢复的媒体记录已变化，无法撤销')
    db.executemany('INSERT INTO playlist_items(playlist_id,media_id,position) VALUES(?,?,?)',
                   [(identity, item.media_id, item.position) for item in value.removed])
    db.execute('UPDATE playlists SET revision=revision+1 WHERE id=?', (identity,))
    return {**summary(db, identity), 'restored': len(ids)}
