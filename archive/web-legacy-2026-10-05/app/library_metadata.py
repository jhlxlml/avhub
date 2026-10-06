"""Atomic, bounded changes to library metadata; never performs source-file I/O."""
import json
import time
from typing import Literal
from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from .series_library import assign, group


class MetadataInput(BaseModel):
    title: str | None = Field(default=None,min_length=1,max_length=300)
    kind: Literal['video','movie','episode'] | None = None
    season: int | None = Field(default=None,ge=0,le=9999)
    episode: int | None = Field(default=None,ge=0,le=99999)
    rating: int | None = Field(default=None,ge=0,le=5)
    tags: list[str] | None = Field(default=None,max_length=30)
    series_title: str | None = Field(default=None,min_length=1,max_length=300)
    series_id: int | None = Field(default=None,ge=1)

    @model_validator(mode='after')
    def validate_changes(self):
        if 'title' in self.model_fields_set and (self.title is None or not self.title.strip()):raise ValueError('标题不能为空')
        if 'kind' in self.model_fields_set and self.kind is None:raise ValueError('媒体类型不能为空')
        if self.series_title is not None and not self.series_title.strip():raise ValueError('剧名不能为空')
        if self.tags is not None:
            self.tags=list(dict.fromkeys(tag.strip() for tag in self.tags if tag.strip()))
            if any(len(tag)>60 for tag in self.tags):raise ValueError('每个标签最多 60 个字符')
        if self.series_title is not None and self.series_id is not None:raise ValueError('请选择剧集分组或填写剧名，不要同时提交')
        if (self.series_title is not None or self.series_id is not None) and self.kind in ('movie','video'):
            raise ValueError('只有剧集类型可以设置剧集分组')
        return self


class BulkInput(BaseModel):
    media_ids: list[int] = Field(min_length=1,max_length=500)
    changes: MetadataInput = Field(default_factory=MetadataInput)
    add_tags: list[str] = Field(default_factory=list,max_length=30)
    remove_tags: list[str] = Field(default_factory=list,max_length=30)
    favorite: bool | None = None
    watched: bool | None = None


def edit(db,ids,changes,add_tags=(),remove_tags=(),favorite=None,watched=None,merge_group=False):
    ids=list(dict.fromkeys(ids))
    if not ids or len(ids)>500 or any(i<=0 for i in ids):raise HTTPException(422,'请明确选择 1–500 个视频')
    marks=','.join('?' for _ in ids)
    rows=db.execute(f'SELECT id,tags FROM media WHERE id IN ({marks})',ids).fetchall()
    if len(rows)!=len(ids):raise HTTPException(404,'部分视频索引已不存在，未修改任何视频，请刷新后重选')
    values=changes.model_dump(exclude_unset=True)
    series_title=values.pop('series_title',None);series_id=values.pop('series_id',None)
    if values.get('title'):values['title']=values['title'].strip()
    if 'tags' in values:values['tags']=json.dumps(values['tags'] or [],ensure_ascii=False)
    added=list(dict.fromkeys(tag.strip() for tag in add_tags if tag.strip()))
    removed={tag.strip() for tag in remove_tags if tag.strip()}
    if any(len(tag)>60 for tag in [*added,*removed]):raise HTTPException(422,'每个标签最多 60 个字符')
    if not values and not added and not removed and favorite is None and watched is None and series_title is None and series_id is None:
        raise HTTPException(422,'请至少选择一项修改')
    if favorite is not None:values['favorite']=int(favorite)
    if watched is not None:values.update(watched=int(watched),manual_watched=int(watched))
    values['updated_at']=time.time()
    assignment=','.join(f'{key}=?' for key in values)
    db.execute(f'UPDATE media SET {assignment} WHERE id IN ({marks})',[*values.values(),*ids])
    if added or removed:
        for row in rows:
            current=json.loads(values.get('tags',row['tags']) or '[]')
            tags=list(dict.fromkeys(tag for tag in [*current,*added] if tag not in removed))
            if len(tags)>30:raise HTTPException(422,'合并后标签超过 30 个，未修改任何视频')
            db.execute('UPDATE media SET tags=? WHERE id=?',(json.dumps(tags,ensure_ascii=False),row['id']))
    if merge_group and series_title is not None:
        series_id=group(db,series_title,'manual');series_title=None
    for media_id in ids:
        assign(db,media_id,series_title,series_id)
    return {'updated':len(ids),'media_ids':ids}
