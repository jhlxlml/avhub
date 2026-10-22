"""Read-only page attribution for snapshots created by benchmark-library only."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.sqlite_runtime import initialize
initialize()
import hashlib
import json
import sqlite3
from contextlib import closing


def inspect(target):
    target=Path(target).resolve()
    if (not target.parent.name.startswith('avhub-library-benchmark-')
        or target.name!='layout-snapshot.db' or not target.is_file()):
        raise ValueError('Only an owned benchmark layout snapshot is accepted')
    with closing(sqlite3.connect(target.as_uri()+'?mode=ro',uri=True)) as db:
        db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        pages={key:db.execute('PRAGMA '+key).fetchone()[0] for key in ('page_count','freelist_count','page_size')}
        objects=[dict(row) for row in db.execute('''SELECT name,COUNT(*) AS pages,SUM(pgsize) AS bytes,
            SUM(payload) AS payload,SUM(unused) AS unused,SUM(ncell) AS cells,
            SUM(pagetype='overflow') AS overflow_pages FROM dbstat GROUP BY name ORDER BY name''')]
        schema=[tuple(row) for row in db.execute('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')]
        counts={name:db.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0]
            for name in ('media','roots','series_groups','playlist_items')}
        return {'inspector_sqlite':sqlite3.sqlite_version,'pages':pages,'objects':objects,'counts':counts,
            'schema_sha256':hashlib.sha256(json.dumps(schema,ensure_ascii=False).encode()).hexdigest(),
            'integrity':db.execute('PRAGMA integrity_check').fetchone()[0]}


if __name__=='__main__':print(json.dumps(inspect(sys.argv[1]),ensure_ascii=False))
