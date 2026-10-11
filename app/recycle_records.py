"""Journal-bound recovery. Native mutations are never replayed after a crash."""
from contextlib import nullcontext
import json
from pathlib import Path
import threading
import time
import uuid
from fastapi import HTTPException
from .file_operations import identity
from .windows_recycle import WindowsRecycle


class Snapshot(list):
    def __init__(self,items):
        super().__init__(items);self.by_stamp={};self.inaccessible=set()
        for item in items:
            try:self.by_stamp.setdefault(tuple(identity(item)),[]).append(item)
            except FileNotFoundError:pass
            except OSError:self.inaccessible.add(item)


class RecycleRecords:
    def __init__(self,files,bridge=None):
        self.files=files;self.bridge=bridge or WindowsRecycle();self.action_lock=threading.RLock();self.snapshot_lock=threading.Lock()
        self.cached=None;self.cached_until=0;self.previews={}

    def snapshot(self,force=False):
        # Shell enumeration/compilation NEVER holds playback/scanner/file locks.
        with self.snapshot_lock:
            if force or self.cached is None or time.monotonic()>=self.cached_until:
                self.cached=Snapshot(self.bridge.items());self.cached_until=time.monotonic()+5
            return self.cached

    def invalidate(self):
        with self.snapshot_lock:self.cached_until=0

    def close(self):
        if hasattr(self.bridge,'close'):self.bridge.close()

    def operation(self,db,op_id):
        op=db.execute("SELECT * FROM file_operations WHERE id=? AND action='recycle' AND state IN ('completed','review') AND recycle_hidden=0",(op_id,)).fetchone()
        if not op:raise HTTPException(404,'回收记录不存在或已清除')
        try:
            stamp=json.loads(op['stamp'])
            if not isinstance(stamp,list) or len(stamp)!=4 or any(type(v) is not int or v<0 for v in stamp):raise ValueError('stamp')
            if op['recycle_receipt']:
                receipt=json.loads(op['recycle_receipt'])
                if not isinstance(receipt,dict) or not isinstance(receipt.get('path'),str) or receipt.get('stamp')!=stamp:raise ValueError('receipt')
        except (ValueError,TypeError):raise HTTPException(409,'回收记录身份信息损坏，请在系统回收站核对')
        if not op['recycle_receipt'] and not op['recycle_status'] and db.execute("SELECT 1 FROM file_operations WHERE media_id=? AND action='recycle' AND state IN ('completed','review') AND created_at>?",(op['media_id'],op['created_at'])).fetchone():
            raise HTTPException(409,'旧记录未绑定回收项目且有后续回收操作，请在系统回收站核对')
        return dict(op)

    def locate(self,op,items):
        expected=json.loads(op['stamp']);receipt=json.loads(op['recycle_receipt']) if op.get('recycle_receipt') else None
        if isinstance(items,Snapshot):
            if (receipt and receipt['path'] in items.inaccessible) or (not receipt and items.inaccessible):raise HTTPException(409,'回收项目无法访问，不能确认是否已删除')
            items=items.by_stamp.get(tuple(expected),[])
        matches=[]
        for name in items:
            path=Path(name)
            try:
                if receipt and receipt['path']!=str(path):continue
                if len(path.parts)!=4 or path.parts[1].casefold()!='$recycle.bin' or not path.parts[2].startswith('S-1-') or not path.name.startswith('$R'):continue
                if path.is_symlink() or not path.is_file() or identity(path)!=expected:continue
                for node in (path,*path.parents):
                    info=node.lstat()
                    if getattr(info,'st_file_attributes',0)&0x400 or node.is_symlink():raise OSError('reparse')
                matches.append(str(path))
            except FileNotFoundError:continue
            except OSError as error:raise HTTPException(409,'回收项目无法访问，不能确认是否已删除') from error
        if len(matches)>1:raise HTTPException(409,'回收站项目不能唯一识别，已拒绝操作')
        return matches[0] if matches else None

    def unresolved(self,db,op_id):
        return db.execute("SELECT * FROM recycle_actions WHERE recycle_id=? AND state IN ('prepared','dispatched','review') ORDER BY created_at DESC LIMIT 1",(op_id,)).fetchone()

    def status(self,op,items):
        with self.files.read_connection() as db:pending=self.unresolved(db,op['id'])
        if pending:return ('pending' if op['media_id'] in self.files.pending else 'review'),None
        if op.get('recycle_status') in ('deleted','restored'):return op['recycle_status'],None
        if self.files.matches(op['source'],json.loads(op['stamp'])):return 'restored',None
        target=self.locate(op,items)
        if target:return 'available',target
        return ('missing' if Path(Path(op['source']).anchor).is_dir() else 'offline'),None

    def list(self,page=1,q='',refresh=False):
        with self.files.read_connection() as db:
            where="action='recycle' AND state IN ('completed','review') AND recycle_hidden=0";params=[]
            if q:where+=" AND (instr(lower(source),lower(?))>0 OR instr(lower(COALESCE(old_title,'')),lower(?))>0)";params=[q,q]
            total=db.execute(f'SELECT COUNT(*) FROM file_operations WHERE {where}',params).fetchone()[0];page=min(page,max(1,(total+29)//30))
            ids=[row[0] for row in db.execute(f'SELECT id FROM file_operations WHERE {where} ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?',[*params,(page-1)*30])]
        items=self.snapshot(refresh) if ids else [];result=[]
        with self.files.lock:
            for op_id in ids:
                with self.files.read_connection() as db:
                    raw=db.execute('SELECT * FROM file_operations WHERE id=? AND recycle_hidden=0',(op_id,)).fetchone()
                    if not raw:continue
                    op=dict(raw);error=''
                    try:self.operation(db,op_id);status,target=self.status(op,items)
                    except (HTTPException,OSError) as exc:status,target='review',None;error=str(getattr(exc,'detail',exc))
                    pending=self.unresolved(db,op_id)
                    if pending:error=pending['error'] or '上次操作结果尚未确认，请核对结果；不会自动重试'
                    columns={row[1] for row in db.execute('PRAGMA table_info(media)')}
                    cover=db.execute('SELECT thumbnail,custom_cover,updated_at FROM media WHERE id=?',(op['media_id'],)).fetchone() if {'thumbnail','custom_cover'}<=columns else None
                if target and not op['recycle_receipt']:
                    with self.files.connection() as db:db.execute('UPDATE file_operations SET recycle_receipt=? WHERE id=?',(json.dumps({'path':target,'stamp':json.loads(op['stamp'])}),op_id))
                if status=='restored':self.files.allow_scan(Path(op['source']))
                try:size=json.loads(op['stamp'])[2]
                except (ValueError,IndexError,TypeError):size=0
                result.append({'id':op_id,'media_id':op['media_id'],'name':Path(op['source']).name,'title':op['old_title'] or Path(op['source']).stem,'source':op['source'],'size':size,'created_at':op['created_at'],'status':status,'error':error,
                    'can_recheck':bool(pending and op['media_id'] not in self.files.pending),
                    'thumbnail_url':f"/thumbs/{op['media_id']}?v={cover['updated_at']}" if cover and (cover['thumbnail'] or cover['custom_cover']) else None})
        return {'items':result,'total':total,'page':page,'pages':max(1,(total+29)//30)}

    def unresolved_check(self,op_id):
        with self.files.read_connection() as db:return bool(self.unresolved(db,op_id))

    def location(self,op_id):
        with self.files.read_connection() as db:
            row=db.execute("SELECT id,created_at FROM file_operations WHERE id=? AND action='recycle' AND state IN ('completed','review') AND recycle_hidden=0",(op_id,)).fetchone()
            if not row:raise HTTPException(404,'记录已清除或已不在回收记录中')
            rank=db.execute("SELECT COUNT(*) FROM file_operations WHERE action='recycle' AND state IN ('completed','review') AND recycle_hidden=0 AND (created_at>? OR (created_at=? AND id>?))",(row['created_at'],row['created_at'],row['id'])).fetchone()[0]
        return {'id':op_id,'page':rank//30+1}

    def check(self,op,action,status,target):
        if self.unresolved_check(op['id']):raise HTTPException(409,'上次操作结果未确认，请先核对结果，不能重复执行')
        if action=='clear':
            if status not in ('restored','deleted','missing'):raise HTTPException(409,'可恢复或未确认的记录不能仅清除')
            return
        if status!='available' or not target:raise HTTPException(409,'未唯一确认回收项目，请刷新或核对结果')
        source=Path(op['source'])
        with self.files.read_connection() as db:
            _,_,permission=self.files.permission(db,source)
            allowed=permission['permanent_delete_allowed' if action=='delete' else 'recycle_allowed'] if permission else False
            if not allowed or self.files.protected_path(source) or not self.files.volume(source.parent):raise HTTPException(403,'原媒体目录未开启'+('永久删除权限' if action=='delete' else '系统回收权限')+'或已离线；请在媒体目录设置中授权')
            if action=='restore':
                if not source.parent.is_dir():raise HTTPException(409,'原目录不存在，请先恢复目录后重试')
                try:source.lstat()
                except FileNotFoundError:pass
                else:raise HTTPException(409,'原位置已有同名文件或目录，不会覆盖或自动改名')
                for node in source.parents:
                    info=node.lstat()
                    if getattr(info,'st_file_attributes',0)&0x400 or node.is_symlink():raise HTTPException(403,'恢复路径包含链接，已拒绝操作')
                if db.execute('SELECT id FROM media WHERE path=? COLLATE NOCASE AND id<>?',(str(source),op['media_id'])).fetchone():raise HTTPException(409,'原位置已有其他媒体记录，不会覆盖')
        if self.files.readers.get(op['media_id']) or any(v[0]==op['media_id'] and v[1]>time.monotonic() for v in self.files.activities.values()):raise HTTPException(409,'视频仍有读取任务，请关闭后重试')

    def preview(self,ids,action):
        if action not in ('restore','delete','clear') or not ids or len(ids)>500:raise HTTPException(422,'回收预览参数无效')
        items=self.snapshot(True);result=[];expected={};receipts=[]
        with self.files.lock:
            self.files.require_idle();now=time.monotonic();self.previews={k:v for k,v in self.previews.items() if v['expires']>now}
            if len(self.previews)>=8:raise HTTPException(409,'回收预览过多，请稍后再试')
            for op_id in dict.fromkeys(ids):
                entry={'id':op_id,'eligible':False,'reason':'','action':action}
                try:
                    with self.files.read_connection() as db:op=self.operation(db,op_id)
                    status,target=self.status(op,items);kind='clear' if action=='delete' and status in ('restored','deleted','missing') else action
                    self.check(op,kind,status,target)
                    entry.update(eligible=True,action=kind,name=Path(op['source']).name,source=op['source'],size=json.loads(op['stamp'])[2])
                    expected[op_id]={'action':kind,'source':op['source'],'stamp':op['stamp'],'bin_path':target}
                    if target and not op['recycle_receipt']:receipts.append((json.dumps({'path':target,'stamp':json.loads(op['stamp'])}),op_id))
                except (HTTPException,OSError) as error:entry['reason']=str(getattr(error,'detail',error))
                result.append(entry)
            if receipts:
                with self.files.connection() as db:db.executemany('UPDATE file_operations SET recycle_receipt=? WHERE id=?',receipts)
            token=uuid.uuid4().hex;self.previews[token]={'expires':now+120,'items':expected}
        # If a huge bin exceeded the general 4000-item COM cache, enumerate ONCE
        # for just this batch's <=500 Shell leases, not once for every mutation.
        paths=[item['bin_path'] for item in expected.values() if item['bin_path']]
        try:
            if paths and hasattr(self.bridge,'prime'):self.bridge.prime(paths)
        except Exception:
            with self.files.lock:self.previews.pop(token,None)
            raise
        return {'ok':True,'preview_token':token,'expires_in':120,'records':result}

    def prepare(self,op,action,target):
        attempt=uuid.uuid4().hex
        with self.files.connection() as db:
            db.execute("INSERT INTO recycle_actions(id,recycle_id,media_id,action,bin_path,source,stamp,state,created_at) VALUES(?,?,?,?,?,?,?,'prepared',?)",(attempt,op['id'],op['media_id'],action,target,op['source'],op['stamp'],time.time()))
            db.execute('UPDATE file_operations SET recycle_receipt=? WHERE id=?',(json.dumps({'path':target,'stamp':json.loads(op['stamp'])}),op['id']))
            db.execute("UPDATE media SET file_state='pending',missing=1 WHERE id=?",(op['media_id'],))
        self.files.pending[op['media_id']]=attempt;self.files.blocked.add(op['media_id'])
        return attempt

    def complete(self,attempt):
        # Atomic journal+library transition. DB failure retains the dispatch.
        with self.files.lock,self.files.connection() as db:
            action=dict(db.execute('SELECT * FROM recycle_actions WHERE id=?',(attempt,)).fetchone());op_id=action['recycle_id'];media_id=action['media_id']
            if action['action']=='restore':
                db.execute("UPDATE media SET file_state='normal',missing=0 WHERE id=?",(media_id,));db.execute("UPDATE file_operations SET recycle_status='restored' WHERE id=?",(op_id,))
            else:
                db.execute("UPDATE file_operations SET recycle_status='deleted',recycle_hidden=1,old_title=NULL,new_title=NULL,sidecars=NULL,recycle_receipt=NULL,error='' WHERE id=?",(op_id,))
                media=db.execute('SELECT path,file_state FROM media WHERE id=?',(media_id,)).fetchone()
                latest=db.execute("SELECT id FROM file_operations WHERE media_id=? AND action='recycle' AND state IN ('completed','review') ORDER BY created_at DESC LIMIT 1",(media_id,)).fetchone()
                if media and media['file_state'] in ('pending','recycled','review') and media['path']==action['source'] and latest and latest['id']==op_id:
                    tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    if 'playlists' in tables:db.execute('UPDATE playlists SET revision=revision+1 WHERE id IN (SELECT playlist_id FROM playlist_items WHERE media_id=?)',(media_id,))
                    for table in ('playlist_items','media_subtitle_links','thumbnail_jobs'):
                        if table in tables:db.execute(f'DELETE FROM {table} WHERE media_id=?',(media_id,))
                    db.execute('DELETE FROM media WHERE id=?',(media_id,))
            db.execute("UPDATE recycle_actions SET state='completed',error='',finished_at=? WHERE id=?",(time.time(),attempt))
        self.files.blocked.discard(media_id)

    def reconcile(self,attempt,explicit=False,startup=False):
        """Metadata-only. Absence NEVER proves a successful permanent delete."""
        with self.files.lock:
            with self.files.read_connection() as db:action=dict(db.execute('SELECT * FROM recycle_actions WHERE id=?',(attempt,)).fetchone())
            stamp=json.loads(action['stamp'])
            if self.files.matches(action['source'],stamp):
                if action['action']=='restore':self.complete(attempt);return 'restored'
                state,message='acknowledged','已确认原文件在原目录，未认定永久删除';media_state='normal'
            elif self.files.matches(action['bin_path'],stamp):
                if startup and action['state']=='dispatched':state,message,media_state='review','上次调用已发出但缺少完成结果，请先核对结果','review'
                else:state,message,media_state='failed','原回收项目仍在，可以重新选择操作；不会自动重试','recycled'
            else:
                try:Path(action['bin_path']).lstat();absent=False
                except FileNotFoundError:absent=True
                except OSError:absent=False
                acknowledged=explicit and absent and Path(Path(action['source']).anchor).is_dir()
                state='acknowledged' if acknowledged else 'review';media_state='recycled' if acknowledged else 'review'
                message='回收项目未找到，无法确认是否永久删除；可清除历史，不会再次删除' if acknowledged else '上次操作结果未确认，请核对原目录和回收站；不会自动重试'
            with self.files.connection() as db:
                db.execute('UPDATE recycle_actions SET state=?,error=?,finished_at=? WHERE id=?',(state,message,time.time(),attempt))
                db.execute('UPDATE media SET file_state=?,missing=? WHERE id=?',(media_state,int(media_state!='normal'),action['media_id']))
                if media_state=='normal':db.execute("UPDATE file_operations SET recycle_status='restored' WHERE id=?",(action['recycle_id'],))
            if media_state=='normal':self.files.blocked.discard(action['media_id'])
            return state

    def recover(self):
        # Startup: local identity checks only; no subprocess or native writes.
        with self.files.read_connection() as db:attempts=[r[0] for r in db.execute("SELECT id FROM recycle_actions WHERE state IN ('prepared','dispatched') ORDER BY created_at")]
        for attempt in attempts:
            try:self.reconcile(attempt,startup=True)
            except (ValueError,TypeError,OSError):
                with self.files.connection() as db:
                    db.execute("UPDATE recycle_actions SET state='review',error='操作身份信息异常，请人工核对；不会重放操作' WHERE id=?",(attempt,))
                    db.execute("UPDATE media SET file_state='review',missing=1 WHERE id=(SELECT media_id FROM recycle_actions WHERE id=?)",(attempt,))

    def recheck(self,op_id):
        with self.action_lock:
            with self.files.lock,self.files.read_connection() as db:
                self.operation(db,op_id);self.files.require_idle();pending=self.unresolved(db,op_id)
            state=self.reconcile(pending['id'],True) if pending else 'unchanged'
        self.invalidate()
        return {'ok':True,'message':'已核对结果，未执行文件删除或移动','state':state}

    def execute(self,op_id,action,confirmed=False,preview_token=None,mutation_guard=None):
        if action not in ('restore','delete','clear'):raise HTTPException(422,'回收记录操作无效')
        if action=='delete' and confirmed is not True:raise HTTPException(422,'永久删除需要明确确认')
        guard=mutation_guard or (lambda media_id:nullcontext())
        with self.action_lock:
            with self.files.read_connection() as db:op=self.operation(db,op_id)
            receipt=json.loads(op['recycle_receipt']) if op['recycle_receipt'] else None
            known_history=action=='clear' and (op['recycle_status'] in ('restored','deleted') or self.files.matches(op['source'],json.loads(op['stamp'])))
            items=[] if known_history else [receipt['path']] if action!='clear' and receipt else self.snapshot(action=='clear')
            with guard(op['media_id']),self.files.lock:
                self.files.require_idle()
                with self.files.read_connection() as db:op=self.operation(db,op_id)
                status,target=self.status(op,items);self.check(op,action,status,target)
                if preview_token:
                    preview=self.previews.get(preview_token);expected=preview['items'].get(op_id) if preview else None
                    if not preview or preview['expires']<=time.monotonic() or expected!={'action':action,'source':op['source'],'stamp':op['stamp'],'bin_path':target}:raise HTTPException(409,'操作预览已失效或文件状态变化，请重新核对')
                    preview['items'].pop(op_id)
                    if not preview['items']:self.previews.pop(preview_token,None)
                if action=='clear':
                    if status=='restored':self.files.allow_scan(Path(op['source']))
                    with self.files.connection() as db:db.execute("UPDATE file_operations SET recycle_hidden=1,old_title=NULL,new_title=NULL,sidecars=NULL,recycle_receipt=NULL,error='' WHERE id=?",(op_id,))
                    return {'ok':True,'message':'历史记录已清除，未改变磁盘文件'}
                attempt=self.prepare(op,action,target)
            try:
                with self.files.connection() as db:db.execute("UPDATE recycle_actions SET state='dispatched' WHERE id=?",(attempt,))
                if action=='restore':self.bridge.restore(target,Path(op['source']),json.loads(op['stamp']))
                else:self.bridge.delete(target,json.loads(op['stamp']))
                if action=='restore':
                    if not self.files.matches(op['source'],json.loads(op['stamp'])):raise OSError('恢复结果未确认')
                else:
                    try:Path(target).lstat()
                    except FileNotFoundError:pass
                    else:raise OSError('永久删除结果未确认')
                    if self.files.matches(op['source'],json.loads(op['stamp'])):raise OSError('原文件出现在原目录，删除结果需核对')
                self.complete(attempt)
                return {'ok':True,'media_id':op['media_id'],'message':'已恢复至原目录' if action=='restore' else '对应视频已永久删除，回收记录已清除'}
            except Exception as error:
                try:
                    if getattr(error,'uncertain',False):
                        with self.files.lock,self.files.connection() as db:
                            db.execute("UPDATE recycle_actions SET state='review',error=?,finished_at=? WHERE id=?",(str(error)[:1000],time.time(),attempt))
                            db.execute("UPDATE media SET file_state='review',missing=1 WHERE id=?",(op['media_id'],))
                        outcome='review'
                    else:outcome=self.reconcile(attempt)
                    if outcome=='restored':return {'ok':True,'media_id':op['media_id'],'message':'接口曾中断，现已核对原文件恢复并同步媒体库'}
                except Exception:pass
                raise
            finally:
                with self.files.lock:self.files.pending.pop(op['media_id'],None)
                self.invalidate()
