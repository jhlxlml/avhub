"""Read-only source observation; personal metadata never crosses uncertain identities."""
import hashlib
import json
from pathlib import Path
import threading
import time
import uuid
from fastapi import HTTPException
from .file_operations import identity,local_volume


def install(db):
    if 'source_identity' not in {r[1] for r in db.execute('PRAGMA table_info(media)')}:db.execute('ALTER TABLE media ADD COLUMN source_identity TEXT')
    db.executescript('''CREATE INDEX IF NOT EXISTS media_source_identity ON media(source_identity);
        CREATE TABLE IF NOT EXISTS source_changes(id TEXT PRIMARY KEY,media_id INTEGER NOT NULL,kind TEXT NOT NULL,
        source TEXT NOT NULL,old_identity TEXT,new_identity TEXT NOT NULL,before_snapshot TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',decision TEXT,new_media_id INTEGER,created_at REAL NOT NULL,finished_at REAL);
        CREATE UNIQUE INDEX IF NOT EXISTS source_changes_pending ON source_changes(media_id) WHERE state='pending';
    ''')


def encoded(stat):return json.dumps([stat.st_dev,stat.st_ino,stat.st_size,stat.st_mtime_ns],separators=(',',':'))
def signature(row):return hashlib.sha256((row['id']+'\0'+row['source']+'\0'+row['new_identity']).encode()).hexdigest()


class MediaIdentity:
    def __init__(self,files,title,sidecars=lambda p:[],volume=local_volume):
        self.files=files;self.title=title;self.sidecars=sidecars;self.volume=volume;self.lock=threading.RLock()

    def observe(self,root_id,path,stat,old=None):
        current=encoded(stat);path=Path(path)
        if old and old.get('file_state')=='normal' and old.get('source_identity')==current:return old
        with self.files.lock,self.files.connection() as db:
            row=db.execute('SELECT * FROM media WHERE path=?',(str(path),)).fetchone()
            if row:
                old=dict(row);previous=old.get('source_identity')
                pending=db.execute("SELECT id FROM source_changes WHERE media_id=? AND state='pending'",(old['id'],)).fetchone()
                if old['file_state']!='normal' and not pending:return old
                if pending and previous==current:
                    db.execute("UPDATE source_changes SET state='resolved',decision='original-returned',new_media_id=?,finished_at=? WHERE id=?",(old['id'],time.time(),pending['id']))
                    db.execute("UPDATE media SET file_state='normal',missing=0 WHERE id=?",(old['id'],));self.files.blocked.discard(old['id'])
                    return {**old,'file_state':'normal','missing':0}
                changed=previous and previous!=current or not previous and old['size'] is not None and old['modified'] is not None and (old['size']!=stat.st_size or old['modified']!=stat.st_mtime)
                if pending or changed:
                    if pending:db.execute('UPDATE source_changes SET new_identity=? WHERE id=?',(current,pending['id']))
                    else:
                        kind='replacement' if previous and json.loads(previous)[:2]!=json.loads(current)[:2] else 'changed'
                        db.execute('INSERT INTO source_changes(id,media_id,kind,source,old_identity,new_identity,before_snapshot,created_at) VALUES(?,?,?,?,?,?,?,?)',
                            (uuid.uuid4().hex,old['id'],kind,str(path),previous,current,json.dumps(old,ensure_ascii=False),time.time()))
                    db.execute("UPDATE media SET missing=1,file_state='review' WHERE id=?",(old['id'],));self.files.blocked.add(old['id'])
                    return {**old,'identity_review':True}
                if not previous:db.execute('UPDATE media SET source_identity=? WHERE id=?',(current,old['id']))
                return {**old,'source_identity':current}
            # Only unchanged, unique NTFS identities can transfer personal data.
            # Hard links, offline roots and ambiguous matches are never merged.
            if stat.st_ino and stat.st_nlink==1 and self.volume(path):
                candidates=db.execute("SELECT m.*,r.path AS registered_root FROM media m JOIN roots r ON r.id=m.root_id WHERE source_identity=? AND file_state='normal' LIMIT 2",(current,)).fetchall()
                if len(candidates)==1:
                    old=dict(candidates[0]);previous_path=Path(old['path'])
                    if Path(old['registered_root']).is_dir() and not self.files.matches(previous_path,json.loads(current)):
                        # Absence must be proven, not an access-error guess.
                        try:previous_path.lstat();case_only=str(previous_path).casefold()==str(path).casefold()
                        except FileNotFoundError:case_only=True
                        except OSError:case_only=False
                        if case_only:
                            title=self.title(path) if old['title']==self.title(previous_path) else old['title']
                            db.execute('UPDATE media SET path=?,name=?,title=?,root_id=?,missing=0,updated_at=? WHERE id=?',(str(path),path.name,title,root_id,time.time(),old['id']))
                            db.execute("INSERT INTO file_operations(id,media_id,action,source,target,stamp,state,created_at,finished_at,old_title,new_title) VALUES(?,?,'external-rename',?,?,?,'completed',?,?,?,?)",
                                (uuid.uuid4().hex,old['id'],str(previous_path),str(path),json.dumps(json.loads(current)),time.time(),time.time(),old['title'],title))
                            if previous_path.parent==path.parent:
                                for sub in self.sidecars(previous_path):
                                    candidate=Path(sub['path'])
                                    try:
                                        if candidate.is_file() and not candidate.is_symlink() and not getattr(candidate.lstat(),'st_file_attributes',0)&0x400:
                                            db.execute('INSERT OR REPLACE INTO media_subtitle_links VALUES(?,?,?)',(old['id'],str(candidate),json.dumps(identity(candidate))))
                                    except OSError:pass
                            return {**old,'path':str(path),'name':path.name,'title':title,'root_id':root_id,'missing':0}
        return None

    def list(self,page=1):
        with self.files.read_connection() as db:
            total=db.execute("SELECT COUNT(*) FROM source_changes WHERE state='pending'").fetchone()[0]
            page=min(page,max(1,(total+19)//20));rows=db.execute("SELECT * FROM source_changes WHERE state='pending' ORDER BY created_at DESC LIMIT 20 OFFSET ?",((page-1)*20,)).fetchall()
        items=[]
        for row in rows:
            snapshot=json.loads(row['before_snapshot']);items.append({'id':row['id'],'media_id':row['media_id'],'kind':row['kind'],'source':row['source'],'title':snapshot['title'],
                'signature':signature(row),'size':json.loads(row['new_identity'])[2],'created_at':row['created_at']})
        return {'items':items,'total':total,'page':page,'pages':max(1,(total+19)//20)}

    def resolve(self,change_id,decision,expected,probe,commit,guard):
        if decision not in ('keep','reset'):raise HTTPException(422,'来源处理方式无效')
        with self.lock:
            with self.files.read_connection() as db:row=db.execute("SELECT * FROM source_changes WHERE id=? AND state='pending'",(change_id,)).fetchone()
            if not row:raise HTTPException(404,'来源变更已处理或不存在')
            row=dict(row);media_id=row['media_id'];path=Path(row['source'])
            with guard(media_id),self.files.lock:
                self.files.require_idle()
                if signature(row)!=expected or identity(path)!=json.loads(row['new_identity']):raise HTTPException(409,'源文件再次变化，请刷新媒体库后重新确认')
                if not path.is_file():raise HTTPException(409,'源文件已离线')
                for node in (path,*path.parents):
                    info=node.lstat()
                    if node.is_symlink() or getattr(info,'st_file_attributes',0)&0x400:raise HTTPException(403,'路径包含链接，已拒绝关联')
                with self.files.read_connection() as db:root_id=self.files.permission(db,path)[0]['id']
                self.files.pending[media_id]=change_id
            try:
                metadata=probe(path)
                if identity(path)!=json.loads(row['new_identity']):raise HTTPException(409,'探测期间源文件再次变化，未保存决定')
                with self.files.lock,self.files.connection() as db:
                    latest=db.execute("SELECT * FROM source_changes WHERE id=? AND state='pending'",(change_id,)).fetchone()
                    if not latest or signature(latest)!=expected:raise HTTPException(409,'来源记录已变化，请重新确认')
                    new_id=commit(db,row,root_id,path,path.stat(),metadata,decision)
                    db.execute("UPDATE source_changes SET state='resolved',decision=?,new_media_id=?,finished_at=? WHERE id=?",(decision,new_id,time.time(),change_id))
                self.files.blocked.discard(media_id)
                return {'ok':True,'media_id':new_id,'message':'已保留原媒体信息并更新来源' if decision=='keep' else '已作为新视频收录，原个人信息已归档，不继承到新视频'}
            finally:
                with self.files.lock:self.files.pending.pop(media_id,None)
