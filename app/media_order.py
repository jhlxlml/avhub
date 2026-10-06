"""Stable media orders; invalid technical values always sort after known ones."""
PIXELS='CASE WHEN width>0 AND height>0 THEN width*height END'
BYTES='CASE WHEN size>0 THEN size END'
ORDERS={
    'recent':'COALESCE(last_played,0) DESC,created_at DESC,id DESC',
    'added':'created_at DESC,id DESC','name':'title COLLATE NOCASE ASC,id ASC',
    'duration_desc':'(duration IS NULL OR duration<=0),duration DESC,id ASC',
    'duration_asc':'(duration IS NULL OR duration<=0),duration ASC,id ASC',
}
def install(db):
    for name,expression in [('resolution',PIXELS),('size',BYTES)]:
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
for _name,_expression in [('resolution',PIXELS),('size',BYTES)]:
    for _direction in ('asc','desc'):
        ORDERS[f'{_name}_{_direction}']=f'({_expression}) IS NULL,({_expression}) {_direction.upper()},id ASC'
