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
    # Indexed scalar lookups execute inside the bounded page query, not two
    # Python/SQLite round trips per item. Include offline but indexed members,
    # matching the historical manual-reorder semantics.
    select = '''SELECT m.*,i.position AS playlist_position,
        (SELECT n.media_id FROM playlist_items n JOIN media p ON p.id=n.media_id
         WHERE n.playlist_id=i.playlist_id AND (n.position,n.media_id)<(i.position,i.media_id)
         ORDER BY n.position DESC,n.media_id DESC LIMIT 1) AS previous_item_id,
        (SELECT n.media_id FROM playlist_items n JOIN media p ON p.id=n.media_id
         WHERE n.playlist_id=i.playlist_id AND (n.position,n.media_id)>(i.position,i.media_id)
         ORDER BY n.position,n.media_id LIMIT 1) AS next_item_id'''
    before = ' AND (i.position,i.media_id) < (?,?)'
    def index(row):
        return db.execute('SELECT COUNT(*)'+base+before,
            (playlist_id,row['playlist_position'],row['id'])).fetchone()[0]
    current = None
    if current_id is not None:
        row=db.execute(select+base+' AND m.id=?',(playlist_id,current_id)).fetchone()
        current=dict(row) if row else None
        if not current: raise HTTPException(404, '当前视频已不在播放列表中')
        current['playlist_index']=index(current)
    condition = " AND (m.title LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\')" if q else ''
    args = [playlist_id] + [f'%{like_literal(q)}%']*2 if q else [playlist_id]
    total = db.execute('SELECT COUNT(*)'+base+condition,args).fetchone()[0]
    pages = max(1, (total+size-1)//size)
    page = min(page if isinstance(page,int) else (current['playlist_index']//size+1 if current and not q else 1),pages)
    rows = [dict(row) for row in db.execute(select+base+condition+' ORDER BY i.position,i.media_id LIMIT ? OFFSET ?',
        [*args,size,(page-1)*size])]
    ordinals={}
    if q and rows:
        if len(rows)<=4:
            # A singleton search must not rank the whole list. Batch a small
            # number of indexed counts in ONE statement instead.
            requested=','.join('(?,?)' for row in rows)
            keys=[value for row in rows for value in (row['id'],row['playlist_position'])]
            ordinal_sql='WITH requested(id,position) AS (VALUES '+requested+''')
                SELECT r.id,(SELECT COUNT(*) FROM playlist_items i JOIN media m ON m.id=i.media_id
                WHERE i.playlist_id=? AND (i.position,i.media_id)<(r.position,r.id)) FROM requested r'''
            ordinals=dict(db.execute(ordinal_sql,[*keys,playlist_id]))
        else:
            # Rank only the prefix ending at the LAST returned item, not all
            # later pages. This keeps broad first-page searches cheap while
            # replacing repeated large prefix counts on deep result pages.
            last=rows[-1]
            ordinal_sql='''WITH ranks AS (SELECT m.id,
                ROW_NUMBER() OVER (ORDER BY i.position,i.media_id)-1 AS playlist_index'''+base+'''
                AND (i.position,i.media_id)<=(?,?)) SELECT id,playlist_index FROM ranks WHERE id IN ('''+','.join('?' for row in rows)+')'
            ordinals=dict(db.execute(ordinal_sql,[playlist_id,last['playlist_position'],last['id'],*[row['id'] for row in rows]]))
    for offset,row in enumerate(rows):
        row['playlist_index']=ordinals[row['id']] if q else (page-1)*size+offset
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
