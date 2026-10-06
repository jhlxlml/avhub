"""Stable media orders; invalid technical values always sort after known ones."""
PIXELS='CASE WHEN width>0 AND height>0 THEN width*height END'
BYTES='CASE WHEN size>0 THEN size END'
MODIFIED='CASE WHEN modified>0 THEN modified END'
SHORT_EDGE='CASE WHEN width>0 AND height>0 THEN MIN(width,height) END'
RESOLUTION_BANDS={'8K':(4320,None),'4K':(2160,4320),'QHD':(1440,2160),'FHD':(1080,1440),'HD':(720,1080),'SD':(0,720)}
ORDERS={
    'recent':'COALESCE(last_played,0) DESC,created_at DESC,id DESC',
    'added':'created_at DESC,id DESC','name':'title COLLATE NOCASE ASC,id ASC',
    'recent_asc':'COALESCE(last_played,0) ASC,created_at ASC,id ASC',
    'added_asc':'created_at ASC,id ASC','name_desc':'title COLLATE NOCASE DESC,id DESC',
    'duration_desc':'(duration IS NULL OR duration<=0),duration DESC,id ASC',
    'duration_asc':'(duration IS NULL OR duration<=0),duration ASC,id ASC',
}
def install(db):
    db.execute(f'CREATE INDEX IF NOT EXISTS media_resolution_filter ON media(missing,({SHORT_EDGE})) WHERE missing=0')
    for name,expression in [('resolution',PIXELS),('size',BYTES),('modified',MODIFIED)]:
        for direction in ('asc','desc'):
            order=f'({expression}) IS NULL,({expression}) {direction.upper()},id ASC'
            ORDERS[f'{name}_{direction}']=order
            index=f'media_{name}_{direction}_order'
            # Repair only the exact earlier generated layout. Do not replace an
            # unrelated user-created index sharing its name.
            previous=db.execute('SELECT sql FROM sqlite_master WHERE type=\'index\' AND name=?',(index,)).fetchone()
            prototype=f'CREATE INDEX {index} ON media({order}) WHERE missing=0'
            if previous and ''.join(previous[0].lower().split())==''.join(prototype.lower().split()):
                db.execute(f'DROP INDEX {index}')
            db.execute(f'CREATE INDEX IF NOT EXISTS {index} ON media(missing,{order}) WHERE missing=0')
# Order definitions must also exist before install(), for isolated callers.
for _name,_expression in [('resolution',PIXELS),('size',BYTES),('modified',MODIFIED)]:
    for _direction in ('asc','desc'):
        ORDERS[f'{_name}_{_direction}']=f'({_expression}) IS NULL,({_expression}) {_direction.upper()},id ASC'
