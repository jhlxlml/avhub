"""Keep WAL open without pooling transactions or weakening commit durability."""
from contextlib import contextmanager, closing
from pathlib import Path
import sqlite3
import threading


class WalAnchor:
    """Caller serializes start/ensure/suspend/close with the database write lock.

    This connection owns no user writes, cursor, or read transaction. Writers
    still open their own connections and commit before replying. Keeping WAL
    open avoids last-connection checkpoint/unlink on each small write; SQLite's
    normal writer auto-checkpoint remains enabled. Maintenance must suspend it.
    """
    def __init__(self):
        self.lock=threading.RLock();self.enabled=False;self.depth=0
        self.connection=None;self.path=None;self.error=None

    def start(self,path):
        with self.lock:self.enabled=True
        self.ensure(path)

    def _close(self):
        if self.connection is not None:
            self.connection.close();self.connection=None

    def ensure(self,path):
        with self.lock:
            if not self.enabled or self.depth:return
            target=Path(path).absolute()
            if self.connection is not None and self.path==target:return
            self._close();self.path=target;db=None
            try:
                # mode=rw must not create a wrong/empty library. Never retain a
                # failed open; ordinary connections remain the safe fallback.
                db=sqlite3.connect(target.as_uri()+'?mode=rw',uri=True,check_same_thread=False)
                db.execute('PRAGMA query_only=ON')
                with closing(db.execute('PRAGMA journal_mode')) as cursor:
                    mode=cursor.fetchone()[0]
                if mode!='wal':
                    db.close();self.error='not-wal';return
                with closing(db.execute('SELECT COUNT(*) FROM sqlite_schema')) as cursor:
                    cursor.fetchone()
                if db.in_transaction:raise sqlite3.ProgrammingError('WAL anchor must not retain a transaction')
                self.connection=db;self.error=None
            except (sqlite3.Error,OSError) as exc:
                if db is not None:db.close()
                self.error=type(exc).__name__  # No path, title or raw SQL in diagnostics.

    @contextmanager
    def suspend(self):
        with self.lock:
            self._close();self.depth+=1
        try:yield
        finally:
            with self.lock:
                self.depth-=1;path=self.path
            if path is not None:self.ensure(path)

    def close(self):
        with self.lock:
            self.enabled=False;self._close()

    def status(self):
        with self.lock:return {'enabled':self.enabled,'connected':self.connection is not None,
            'suspended':self.depth>0,'error':self.error,'policy':'independent-commits-default-autocheckpoint'}
