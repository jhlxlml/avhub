"""Stable, offline series identities. File titles are not series identifiers."""
import json
import re
import time
import unicodedata
import uuid
from fastapi import HTTPException
from .folders import like_literal


def clean_title(value):
    value=' '.join(unicodedata.normalize('NFKC',value).split())
    if not value or len(value)>300: raise HTTPException(422,'剧名需为 1–300 个字符')
    return value


def install(db):
    columns={row[1] for row in db.execute('PRAGMA table_info(media)')}
    for name,sql in [('series_id','INTEGER'),('custom_cover','TEXT')]:
        if name not in columns: db.execute(f'ALTER TABLE media ADD COLUMN {name} {sql}')
    db.executescript('''CREATE TABLE IF NOT EXISTS series_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL, created_at REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS media_series_order ON media(series_id,missing,season,episode,id);
        CREATE INDEX IF NOT EXISTS media_series_unassigned ON media(root_id,title,id) WHERE kind='episode' AND series_id IS NULL;
    ''')
    backfill(db)


def group(db,title,scope):
    title=clean_title(title)
    identity=json.dumps([scope,title.casefold()],ensure_ascii=False)
    if scope=='manual':
        # A group's display name may have changed without changing its stable
        # identity. Explicit batch grouping should use its current display name.
        matches=db.execute("SELECT id FROM series_groups WHERE title=? COLLATE NOCASE AND identity LIKE ? ORDER BY id LIMIT 2",(title,'["manual",%')).fetchall()
        if len(matches)>1:raise HTTPException(409,'多个手动分组使用同一剧名，请先修改分组名称或按分组 ID 指定')
        if matches:return matches[0][0]
        old=db.execute('SELECT title FROM series_groups WHERE identity=?',(identity,)).fetchone()
        if old and old['title']!=title:identity=json.dumps([scope,title.casefold(),uuid.uuid4().hex],ensure_ascii=False)
    db.execute('INSERT OR IGNORE INTO series_groups(identity,title,created_at) VALUES(?,?,?)',(identity,title,time.time()))
    return db.execute('SELECT id FROM series_groups WHERE identity=?',(identity,)).fetchone()[0]


def backfill(db):
    # Only unassigned episodes are inferred. Manual groups and renamed group
    # titles survive rescans, restart, source relocation and episode edits.
    rows=db.execute("SELECT id,root_id,title,name FROM media INDEXED BY media_series_unassigned WHERE kind='episode' AND series_id IS NULL").fetchall()
    known={}
    for row in rows:
        title=' '.join((row['title'] or row['name']).split())[:300] or '未命名剧集'
        key=(row['root_id'],title.casefold())
        if key not in known: known[key]=group(db,title,f"root:{row['root_id']}")
        db.execute('UPDATE media SET series_id=? WHERE id=?',(known[key],row['id']))


def assign(db,media_id,title=None,series_id=None):
    row=db.execute('SELECT kind,root_id,title,series_id FROM media WHERE id=?',(media_id,)).fetchone()
    if not row: raise HTTPException(404,'视频不存在')
    if row['kind']!='episode':
        db.execute('UPDATE media SET series_id=NULL WHERE id=?',(media_id,));return
    if series_id is not None:
        if not db.execute('SELECT 1 FROM series_groups WHERE id=?',(series_id,)).fetchone():raise HTTPException(404,'剧集分组不存在')
        chosen=series_id
    elif title is not None:
        title=clean_title(title)
        current=db.execute('SELECT title FROM series_groups WHERE id=?',(row['series_id'],)).fetchone()
        chosen=row['series_id'] if current and current['title']==title else group(db,title,'manual')
    else:
        if row['series_id'] is not None:return
        chosen=group(db,row['title'] or '未命名剧集',f"root:{row['root_id']}")
    db.execute('UPDATE media SET series_id=? WHERE id=?',(chosen,media_id))


def listing(db,q='',root_id=None,page=1,size=24):
    backfill(db)
    condition=" WHERE m.kind='episode'"
    args=[]
    if root_id is not None:condition+=' AND m.root_id=?';args.append(root_id)
    if q:condition+=" AND g.title LIKE ? ESCAPE '\\'";args.append('%'+like_literal(q)+'%')
    cte='''WITH grouped AS (SELECT g.id,g.title,COUNT(*) AS count,
        SUM(m.missing=0) AS available_count,SUM(m.missing=0 AND m.watched=1) AS watched_count,
        COUNT(DISTINCT COALESCE(m.season,-1)) AS seasons,
        MAX(m.last_played) AS last_played FROM series_groups g JOIN media m ON m.series_id=g.id'''+condition+' GROUP BY g.id) '
    total=db.execute(cte+'SELECT COUNT(*) FROM grouped',args).fetchone()[0]
    pages=max(1,(total+size-1)//size);page=min(page,pages)
    items=[dict(row) for row in db.execute(cte+'SELECT * FROM grouped ORDER BY title COLLATE NOCASE,id LIMIT ? OFFSET ?',[*args,size,(page-1)*size])]
    for item in items:
        # Old ANALYZE statistics may still describe the newly migrated series_id
        # column as all NULL. Use the identity index rather than re-scanning all
        # episodes for every card while statistics catch up.
        cover=db.execute('''SELECT id,thumbnail,custom_cover,updated_at FROM media INDEXED BY media_series_order WHERE series_id=? AND kind='episode'
            ORDER BY missing,(custom_cover IS NULL AND thumbnail IS NULL),season,episode,id LIMIT 1''',(item['id'],)).fetchone()
        item['thumbnail_url']=f"/thumbs/{cover['id']}?v={cover['updated_at']}" if cover and (cover['custom_cover'] or cover['thumbnail']) else None
        item['thumbnail_media_id']=cover['id'] if cover else None
    return {'items':items,'total':total,'page':page,'pages':pages,'page_size':size}


def detail(db,series_id,season=None,page=1,size=48,convert=dict,root_id=None):
    info=db.execute('SELECT id,title FROM series_groups WHERE id=?',(series_id,)).fetchone()
    if not info:raise HTTPException(404,'剧集分组不存在')
    base=" FROM media INDEXED BY media_series_order WHERE series_id=? AND kind='episode'"
    args=[series_id]
    if root_id is not None:base+=' AND root_id=?';args.append(root_id)
    seasons=[dict(row) for row in db.execute('SELECT season,COUNT(*) AS count,SUM(missing=0) AS available_count'+base+' GROUP BY season ORDER BY season IS NULL,season',args)]
    if season=='unknown':base+=' AND season IS NULL'
    elif season is not None:
        if not re.fullmatch(r'\d{1,4}',str(season)):raise HTTPException(422,'季编号无效')
        base+=' AND season=?';args.append(int(season))
    total=db.execute('SELECT COUNT(*)'+base,args).fetchone()[0]
    pages=max(1,(total+size-1)//size);page=min(page,pages)
    rows=db.execute('SELECT *'+base+' ORDER BY season IS NULL,season,episode IS NULL,episode,id LIMIT ? OFFSET ?',[*args,size,(page-1)*size])
    return {**dict(info),'seasons':seasons,'items':[convert(row) for row in rows],'total':total,'page':page,'pages':pages,'page_size':size}
