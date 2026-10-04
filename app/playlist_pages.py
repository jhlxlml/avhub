"""Bounded playlist queries; positions/revisions stay server-owned."""
from fastapi import HTTPException
from .folders import like_literal


def summary(db, playlist_id):
    row = db.execute('''SELECT p.*,COUNT(m.id) AS count,
        COALESCE(SUM(m.missing=0),0) AS playable_count,
        COALESCE(SUM(m.duration),0) AS total_duration FROM playlists p
        LEFT JOIN playlist_items i ON i.playlist_id=p.id LEFT JOIN media m ON m.id=i.media_id
        WHERE p.id=? GROUP BY p.id''', (playlist_id,)).fetchone()
    if not row: raise HTTPException(404, '播放列表不存在')
    return dict(row)


def page_query(db, playlist_id, convert, page=1, size=40, q='', current_id=None):
    info = summary(db, playlist_id)
    # Keep the cover stable across search/page changes; read only one member.
    cover = db.execute('''SELECT m.* FROM playlist_items i JOIN media m ON m.id=i.media_id
        WHERE i.playlist_id=? ORDER BY m.missing,i.position,i.media_id LIMIT 1''',(playlist_id,)).fetchone()
    info['cover_media'] = {key:value for key,value in convert(cover).items()
                           if key in ('id','title','thumbnail_url')} if cover else None
    base = ' FROM playlist_items i JOIN media m ON m.id=i.media_id WHERE i.playlist_id=?'
    select = 'SELECT m.*,i.position AS playlist_position'
    before = ' AND (i.position,i.media_id) < (?,?)'
    after = ' AND (i.position,i.media_id) > (?,?)'
    def neighbors(row):
        keys=(playlist_id,row['playlist_position'],row['id'])
        previous=db.execute('SELECT m.id'+base+before+' ORDER BY i.position DESC,i.media_id DESC LIMIT 1',keys).fetchone()
        following=db.execute('SELECT m.id'+base+after+' ORDER BY i.position,i.media_id LIMIT 1',keys).fetchone()
        return (previous[0] if previous else None,following[0] if following else None)
    def index(row):
        return db.execute('SELECT COUNT(*)'+base+before,
            (playlist_id,row['playlist_position'],row['id'])).fetchone()[0]
    current = None
    if current_id is not None:
        row=db.execute(select+base+' AND m.id=?',(playlist_id,current_id)).fetchone()
        current=dict(row) if row else None
        if not current: raise HTTPException(404, '当前视频已不在播放列表中')
        current['playlist_index']=index(current)
        current['previous_item_id'],current['next_item_id']=neighbors(current)
    condition = " AND (m.title LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\')" if q else ''
    args = [playlist_id] + [f'%{like_literal(q)}%']*2 if q else [playlist_id]
    total = db.execute('SELECT COUNT(*)'+base+condition,args).fetchone()[0]
    pages = max(1, (total+size-1)//size)
    page = min(page if isinstance(page,int) else (current['playlist_index']//size+1 if current and not q else 1),pages)
    rows = [dict(row) for row in db.execute(select+base+condition+' ORDER BY i.position,i.media_id LIMIT ? OFFSET ?',
                      [*args,size,(page-1)*size])]
    for offset,row in enumerate(rows):
        row['playlist_index']=index(row) if q else (page-1)*size+offset
        row['previous_item_id'],row['next_item_id']=neighbors(row)
    result = {**info,'items':[convert(row) for row in rows], 'total':total,'page':page,'pages':pages,'page_size':size}
    if current:
        order_args = (playlist_id,current['playlist_position'],current['id'])
        base = '''SELECT m.* FROM playlist_items i JOIN media m ON m.id=i.media_id
            WHERE i.playlist_id=? AND m.missing=0 AND (i.position,i.media_id) {op} (?,?)'''
        previous = db.execute(base.format(op='<')+' ORDER BY i.position DESC,i.media_id DESC LIMIT 1',order_args).fetchone()
        following = db.execute(base.format(op='>')+' ORDER BY i.position,i.media_id LIMIT 1',order_args).fetchone()
        result.update(index=current['playlist_index'],current=convert(current),
                      previous=convert(previous) if previous else None,next=convert(following) if following else None)
    return result
