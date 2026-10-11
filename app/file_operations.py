"""Opt-in desktop file operations. No permanent deletion or video backup copies."""
import ctypes
import json
import os
from pathlib import Path
import re
import threading
import time
import uuid
from contextlib import contextmanager
from fastapi import HTTPException
from starlette.responses import JSONResponse


def install(db):
    if 'file_state' not in {row[1] for row in db.execute('PRAGMA table_info(media)')}:
        db.execute("ALTER TABLE media ADD COLUMN file_state TEXT NOT NULL DEFAULT 'normal'")
    db.executescript('''CREATE TABLE IF NOT EXISTS root_file_permissions(
        root_id INTEGER PRIMARY KEY, root_path TEXT NOT NULL, rename_allowed INTEGER NOT NULL DEFAULT 0,
        recycle_allowed INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS file_operations(id TEXT PRIMARY KEY, media_id INTEGER NOT NULL,
        action TEXT NOT NULL, source TEXT NOT NULL, target TEXT, stamp TEXT NOT NULL,
        state TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL, finished_at REAL,
        undo_of TEXT);
        CREATE INDEX IF NOT EXISTS file_operations_media ON file_operations(media_id,created_at);
        CREATE TABLE IF NOT EXISTS media_subtitle_links(media_id INTEGER NOT NULL,path TEXT NOT NULL,stamp TEXT NOT NULL,PRIMARY KEY(media_id,path));
        CREATE TABLE IF NOT EXISTS recycle_actions(id TEXT PRIMARY KEY,recycle_id TEXT NOT NULL,media_id INTEGER NOT NULL,
        action TEXT NOT NULL,bin_path TEXT NOT NULL,source TEXT NOT NULL,stamp TEXT NOT NULL,state TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '',created_at REAL NOT NULL,finished_at REAL);
        CREATE INDEX IF NOT EXISTS recycle_actions_record ON recycle_actions(recycle_id,state,created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS recycle_actions_active ON recycle_actions(recycle_id) WHERE state IN ('prepared','dispatched','review');
    ''')
    columns={row[1] for row in db.execute('PRAGMA table_info(file_operations)')}
    for name in ('old_title','new_title','sidecars','recycle_receipt','recycle_status'):
        if name not in columns:db.execute(f'ALTER TABLE file_operations ADD COLUMN {name} TEXT')
    if 'recycle_hidden' not in columns:db.execute('ALTER TABLE file_operations ADD COLUMN recycle_hidden INTEGER NOT NULL DEFAULT 0')
    if 'permanent_delete_allowed' not in {row[1] for row in db.execute('PRAGMA table_info(root_file_permissions)')}:
        db.execute('ALTER TABLE root_file_permissions ADD COLUMN permanent_delete_allowed INTEGER NOT NULL DEFAULT 0')


def identity(path):
    value=Path(path).stat()
    return [value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns]


def operation_error(error):
    """Explain OS errors without guessing that every refusal is a file lock."""
    code=getattr(error,'winerror',None)
    if code in (32,33):return '文件正被其他程序占用，请关闭对应播放器或其他读取程序后重试；应用不会自动关闭它们'
    if code in (5,19) or isinstance(error,PermissionError):return '系统拒绝访问，请检查文件只读属性、目录权限或安全软件；不会强行删除'
    if code in (2,3) or isinstance(error,FileNotFoundError):return '源文件或目录已不存在，请刷新媒体库后重试'
    if code==112:return '磁盘可用空间不足，请释放空间后重试'
    if code==206:return '文件路径过长，请缩短文件名或使用较短的媒体目录'
    return '系统未能完成文件操作，请检查文件占用、权限和磁盘状态；请查看操作记录核对结果'


def local_volume(path):
    if os.name!='nt':return False
    volume=ctypes.create_unicode_buffer(32768)
    shell=ctypes.windll.kernel32
    if not shell.GetVolumePathNameW(str(path),volume,len(volume)) or shell.GetDriveTypeW(volume.value)!=3:return False
    fs=ctypes.create_unicode_buffer(256)
    return bool(shell.GetVolumeInformationW(volume.value,None,0,None,None,None,fs,len(fs))) and fs.value=='NTFS'


def new_filename(stem,extension):
    if not isinstance(stem,str) or not stem or stem in ('.','..') or stem[-1] in '. ':
        raise HTTPException(422,'文件名不能为空，也不能以空格或句点结尾')
    if any(ord(c)<32 or c in '<>:"/\\|?*' for c in stem):raise HTTPException(422,'文件名包含非法字符或路径分隔符')
    reserved=stem.split('.')[0].upper()
    if reserved in {'CON','PRN','AUX','NUL'} or re.fullmatch(r'(COM|LPT)[1-9¹²³]',reserved):raise HTTPException(422,'不能使用 Windows 保留名称')
    try:units=len((stem+extension).encode('utf-16-le'))//2
    except UnicodeError:raise HTTPException(422,'文件名编码无效')
    if units>255:raise HTTPException(422,'文件名过长')
    return stem+extension


class FileOperations:
    def __init__(self,connection,read_connection,protected=(),volume=local_volume):
        self.connection=connection;self.read_connection=read_connection;self.protected=[Path(p).resolve() for p in protected]
        self.volume=volume;self.lock=threading.RLock();self.readers={};self.pending={};self.activities={};self.retired_owners={};self.blocked=set();self.previews={}

    def protected_path(self,path):
        return any(path==root or root in path.parents for root in self.protected)

    def permission(self,db,path):
        roots=[]
        parents=[str(value) for value in path.parents]
        for row in db.execute(f"SELECT id,path FROM roots WHERE path COLLATE NOCASE IN ({','.join('?' for _ in parents)})",parents):
            root=Path(row['path']).resolve()
            if path!=root and root in path.parents:roots.append((len(root.parts),row,root))
        if not roots:raise HTTPException(403,'文件不在已授权的媒体目录中')
        _,row,root=max(roots,key=lambda value:value[0])
        value=db.execute('SELECT * FROM root_file_permissions WHERE root_id=? AND root_path=?',(row['id'],str(root))).fetchone()
        return row,root,value

    def permissions(self,ids):
        with self.read_connection() as db:
            result=[]
            for row in db.execute(f"SELECT id,path FROM roots WHERE id IN ({','.join('?' for _ in ids)})",ids):
                path=Path(row['path']).resolve();value=db.execute('SELECT * FROM root_file_permissions WHERE root_id=? AND root_path=?',(row['id'],str(path))).fetchone()
                supported=path.is_dir() and not self.protected_path(path) and self.volume(path)
                result.append({'root_id':row['id'],'supported':supported,'rename':bool(value and value['rename_allowed'] and supported),'recycle':bool(value and value['recycle_allowed'] and supported),'permanentDelete':bool(value and value['permanent_delete_allowed'] and supported),
                               'reason':'' if supported else '仅支持非应用目录的本地 NTFS 磁盘；受保护目录保持只读'})
            return result

    def authorize(self,root_id,rename,recycle,permanent_delete=False):
        with self.lock,self.connection() as db:
            self.require_idle()
            root=db.execute('SELECT path FROM roots WHERE id=?',(root_id,)).fetchone()
            if not root:raise HTTPException(404,'媒体目录不存在')
            path=Path(root['path']).resolve()
            if (rename or recycle or permanent_delete) and (self.protected_path(path) or not path.is_dir() or not self.volume(path)):
                raise HTTPException(403,'本目录不能开启整理权限；仅支持本地 NTFS，开发验证保护目录保持只读')
            db.execute('INSERT OR REPLACE INTO root_file_permissions(root_id,root_path,rename_allowed,recycle_allowed,permanent_delete_allowed) VALUES(?,?,?,?,?)',(root_id,str(path),int(rename),int(recycle),int(permanent_delete)))
        return {'ok':True}

    def require_idle(self):
        if self.pending:raise HTTPException(409,'文件操作尚未完成，暂不能扫描、恢复或修改目录')

    def reload_blocked(self):
        with self.lock,self.connection() as db:self.blocked={row[0] for row in db.execute("SELECT id FROM media WHERE file_state!='normal'")}

    def activity(self,owner,media_id,present):
        with self.lock:
            now=time.monotonic();self.retired_owners={key:expiry for key,expiry in self.retired_owners.items() if expiry>now}
            if present and owner in self.retired_owners:return False
            if present and media_id:self.activities[owner]=(media_id,now+120)
            else:self.activities.pop(owner,None);self.retired_owners[owner]=now+120
            return True

    @contextmanager
    def reader(self,media_id):
        with self.lock:
            if media_id in self.pending or media_id in self.blocked:raise HTTPException(409,'文件正在整理、已回收或需要核对，暂不能播放')
            self.readers[media_id]=self.readers.get(media_id,0)+1
        try:yield
        finally:
            with self.lock:
                count=self.readers.get(media_id,1)-1
                if count:self.readers[media_id]=count
                else:self.readers.pop(media_id,None)

    def check_source(self,db,media_id,action):
        row=db.execute('SELECT * FROM media WHERE id=?',(media_id,)).fetchone()
        if not row or row['missing'] or row['file_state']!='normal':raise HTTPException(409,'源视频不可操作，请刷新或核对操作记录')
        source=Path(row['path'])
        if source.suffix.lower() not in {'.mp4','.mkv','.avi','.mov','.m4v','.webm','.wmv','.flv','.ts','.mts','.m2ts'}:raise HTTPException(403,'只允许整理已索引的视频文件')
        if not source.is_file() or source.is_symlink():raise HTTPException(409,'源文件离线或含链接，已拒绝操作')
        path=source.resolve();root_row,root,permission=self.permission(db,path)
        stat=path.stat()
        if ('size' in row.keys() and row['size'] is not None and row['size']!=stat.st_size) or ('modified' in row.keys() and row['modified'] is not None and abs(row['modified']-stat.st_mtime)>.000001):
            raise HTTPException(409,'源视频已变化，请刷新媒体库后再整理')
        if self.protected_path(path) or not self.volume(path) or not permission or not permission[action+'_allowed']:
            raise HTTPException(403,'此目录未开启该文件整理权限')
        # Reject junction/reparse ancestors rather than authorizing a linked target.
        for node in (source,*source.parents):
            stat=node.lstat()
            if (bool(stat.st_file_attributes&0x400) if hasattr(stat,'st_file_attributes') else node.is_symlink()):
                raise HTTPException(403,'路径包含链接或重解析点，已拒绝操作')
        now=time.monotonic();self.activities={key:value for key,value in self.activities.items() if value[1]>now}
        if media_id in self.pending or self.readers.get(media_id) or any(value[0]==media_id for value in self.activities.values()):
            raise HTTPException(409,'视频仍在播放、预览或读取，请关闭后再整理')
        return row,path,root_row['id']

    def preview_recycle(self,ids,check_busy=None):
        ids=list(dict.fromkeys(ids))
        if not ids or len(ids)>500:raise HTTPException(422,'一次请选择 1–500 个视频')
        with self.lock,self.read_connection() as db:
            now=time.monotonic();self.previews={key:value for key,value in self.previews.items() if value['expires']>now}
            if len(self.previews)>=8:raise HTTPException(409,'预览任务过多，请稍后再试')
            items=[];snapshots={}
            for media_id in ids:
                row=db.execute('SELECT * FROM media WHERE id=?',(media_id,)).fetchone()
                item={'id':media_id,'title':row['title'] if row else f'记录 {media_id}','path':row['path'] if row else '', 'size':0,'eligible':False,'reason':''}
                try:
                    if check_busy:check_busy(media_id)
                    _,path,_=self.check_source(db,media_id,'recycle');stamp=identity(path)
                    if 'size' in row.keys() and row['size'] is not None and row['size']!=stamp[2]:raise HTTPException(409,'文件大小已变化，请刷新媒体库后重新预览')
                    if 'modified' in row.keys() and row['modified'] is not None and abs(row['modified']-path.stat().st_mtime)>.000001:raise HTTPException(409,'文件修改时间已变化，请刷新媒体库后重新预览')
                    item.update(eligible=True,size=stamp[2]);snapshots[media_id]={'path':str(path),'stamp':stamp}
                except (HTTPException,OSError) as error:item['reason']=str(getattr(error,'detail',operation_error(error)))
                items.append(item)
            token=uuid.uuid4().hex;self.previews[token]={'expires':now+600,'items':snapshots}
            return {'preview_token':token,'expires_in':600,'items':items}

    def prepare(self,media_id,action,stem=None,preview_token=None):
        with self.lock:
            with self.connection() as db:
                row,path,root_id=self.check_source(db,media_id,action)
                if preview_token is not None:
                    preview=self.previews.get(preview_token);expected=preview['items'].get(media_id) if preview else None
                    if action!='recycle' or not preview or preview['expires']<=time.monotonic() or not expected:
                        raise HTTPException(409,'回收预览已失效或此视频不在可操作清单中，请重新预览')
                    if expected['path']!=str(path) or expected['stamp']!=identity(path):raise HTTPException(409,'视频在预览后发生变化，已拒绝回收；请重新预览')
                target=None
                if action=='rename':
                    target=path.with_name(new_filename(stem,path.suffix))
                    if str(target)==str(path):raise HTTPException(422,'文件名没有变化')
                    if target.exists() and not (str(target).casefold()==str(path).casefold() and os.path.samefile(path,target)):
                        raise HTTPException(409,'同名文件已存在，不会覆盖')
                    collision=db.execute('SELECT id FROM media WHERE path=? COLLATE NOCASE AND id<>?',(str(target),media_id)).fetchone()
                    if collision:raise HTTPException(409,'目标名称已有媒体库记录，请先处理冲突')
                stamp=identity(path);op=uuid.uuid4().hex
                title=target.stem if target else None
                db.execute('''INSERT INTO file_operations(id,media_id,action,source,target,stamp,state,error,created_at,finished_at,undo_of,old_title,new_title)
                    VALUES(?,?,?,?,?,?,?,'',?,NULL,NULL,?,?)''',(op,media_id,action,str(path),str(target) if target else None,json.dumps(stamp),'prepared',time.time(),row['title'],title))
                if action=='rename':
                    linked=self.linked_subtitles(media_id,path,db)
                    prefix=(path.stem+'.').casefold()
                    with os.scandir(path.parent) as entries:
                        sidecars=[Path(entry.path) for entry in entries if entry.name.casefold().startswith(prefix) and Path(entry.name).suffix.lower() in {'.srt','.ass','.ssa','.vtt'} and entry.is_file(follow_symlinks=False)]
                    sidecars.extend(Path(item['path']) for item in linked)
                    snapshots=[]
                    for candidate in dict.fromkeys(sidecars):
                        try:snapshots.append({'path':str(candidate),'stamp':identity(candidate)})
                        except OSError:continue
                    db.execute('UPDATE file_operations SET sidecars=? WHERE id=?',(json.dumps(snapshots,ensure_ascii=False),op))
                db.execute("UPDATE media SET missing=1,file_state='pending' WHERE id=?",(media_id,))
            self.pending[media_id]=op
            self.blocked.add(media_id)
            if preview_token is not None:
                self.previews[preview_token]['items'].pop(media_id,None)
                if not self.previews[preview_token]['items']:self.previews.pop(preview_token,None)
        return {'id':op,'media_id':media_id,'action':action,'source':str(path),'target':str(target) if target else None}

    def rename(self,media_id,stem):
        operation=self.prepare(media_id,'rename',stem)
        try:
            if os.name!='nt':raise HTTPException(409,'文件整理仅支持 Windows 桌面版')
            # Windows os.rename refuses an existing destination; no replace/unlink fallback.
            os.rename(operation['source'],operation['target'])
        except BaseException as error:
            message=operation_error(error) if isinstance(error,OSError) else str(getattr(error,'detail',error))
            self.finish(operation['id'],False,message)
            if isinstance(error,OSError):raise HTTPException(409,message) from error
            raise
        self.finish(operation['id'],True)
        return {'ok':True,'operation_id':operation['id'],'media_id':media_id}

    def verify(self,op_id):
        with self.lock,self.read_connection() as db:
            op=db.execute('SELECT * FROM file_operations WHERE id=?',(op_id,)).fetchone()
            if not op or op['state']!='prepared' or self.pending.get(op['media_id'])!=op_id:raise HTTPException(409,'文件操作已经结束或不存在')
            try:valid=identity(op['source'])==json.loads(op['stamp'])
            except OSError:valid=False
            if not valid:raise HTTPException(409,'文件在确认后发生变化，已拒绝操作')
            return dict(op)

    def finish(self,op_id,success,error=''):
        with self.lock:
            with self.connection() as db:
                op=db.execute('SELECT * FROM file_operations WHERE id=?',(op_id,)).fetchone()
                if not op or op['state']!='prepared':raise HTTPException(409,'操作结果已经记录')
                expected=json.loads(op['stamp']);state='review';message=error
                if op['action']=='rename' and success and self.matches(op['target'],expected) and not self.matches(op['source'],expected):
                    db.execute("UPDATE media SET path=?,name=?,title=?,root_id=?,missing=0,file_state='normal',updated_at=? WHERE id=?",(op['target'],Path(op['target']).name,op['new_title'] if op['new_title'] is not None else Path(op['target']).stem,self.permission(db,Path(op['target']))[0]['id'],time.time(),op['media_id']))
                    state='completed'
                    db.execute('DELETE FROM media_subtitle_links WHERE media_id=?',(op['media_id'],))
                    for item in json.loads(op['sidecars'] or '[]'):
                        candidate=Path(item['path'])
                        if candidate.parent==Path(op['target']).parent and self.matches(candidate,item['stamp']):
                            db.execute('INSERT OR REPLACE INTO media_subtitle_links VALUES(?,?,?)',(op['media_id'],str(candidate),json.dumps(item['stamp'])))
                elif op['action']=='recycle' and success and not Path(op['source']).exists():
                    db.execute("UPDATE media SET file_state='recycled',missing=1 WHERE id=?",(op['media_id'],));state='completed'
                elif self.matches(op['source'],expected):
                    db.execute("UPDATE media SET file_state='normal',missing=0 WHERE id=?",(op['media_id'],));state='failed'
                else:
                    db.execute("UPDATE media SET file_state='review',missing=1 WHERE id=?",(op['media_id'],));message=message or '文件位置与操作结果不一致，请核对系统回收站或原目录'
                db.execute('UPDATE file_operations SET state=?,error=?,finished_at=? WHERE id=?',(state,message[:1000],time.time(),op_id))
                if state=='completed' and op['undo_of']:db.execute("UPDATE file_operations SET state='undone' WHERE id=?",(op['undo_of'],))
            self.pending.pop(op['media_id'],None)
            if state=='failed' or (state=='completed' and op['action']=='rename'):self.blocked.discard(op['media_id'])
            else:self.blocked.add(op['media_id'])
            if state=='review':raise HTTPException(409,message)
        return {'ok':state=='completed','media_id':op['media_id']}

    @staticmethod
    def matches(path,stamp):
        try:
            if not Path(path).is_file() or identity(path)!=stamp:return False
            with os.scandir(Path(path).parent) as entries:return any(entry.name==Path(path).name for entry in entries)
        except OSError:return False

    def recover(self):
        self.reload_blocked()
        with self.read_connection() as db:ops=[dict(row) for row in db.execute("SELECT * FROM file_operations WHERE state='prepared'")]
        for op in ops:
            self.pending[op['media_id']]=op['id']
            try:self.finish(op['id'],op['action']=='rename' and self.matches(op['target'],json.loads(op['stamp'])),'上次操作被中断，已核对文件位置')
            except HTTPException:pass

    def history(self,page=1):
        with self.lock,self.read_connection() as db:
            total=db.execute('SELECT COUNT(*) FROM file_operations WHERE recycle_hidden=0').fetchone()[0]
            rows=[dict(row) for row in db.execute('SELECT * FROM file_operations WHERE recycle_hidden=0 ORDER BY created_at DESC LIMIT 30 OFFSET ?',((page-1)*30,))]
            for row in rows:
                row.pop('stamp',None)
                row.pop('recycle_receipt',None)
        return {'items':rows,'total':total,'page':page,'pages':max(1,(total+29)//30)}

    def info(self,media_id):
        result={'rename':False,'recycle':False,'reason':'','name':'','rename_reason':'','recycle_reason':''}
        with self.lock,self.read_connection() as db:
            row=db.execute('SELECT name FROM media WHERE id=?',(media_id,)).fetchone()
            if not row:raise HTTPException(404,'视频不存在')
            result['name']=row['name']
            reasons=[]
            for action in ('rename','recycle'):
                try:self.check_source(db,media_id,action);result[action]=True
                except (HTTPException,OSError) as error:
                    message=str(getattr(error,'detail',operation_error(error)));result[action+'_reason']=message;reasons.append((action,message))
            result['reason']=reasons[0][1] if len(reasons)==2 else ('重命名：' if reasons[0][0]=='rename' else '系统回收：')+reasons[0][1] if reasons else ''
        return result

    def linked_subtitles(self,media_id,path,db=None):
        if db is None:
            with self.read_connection() as connection:return self.linked_subtitles(media_id,path,connection)
        result=[]
        operation=db.execute("SELECT stamp FROM file_operations WHERE media_id=? AND action IN ('rename','external-rename') AND state='completed' ORDER BY created_at DESC LIMIT 1",(media_id,)).fetchone()
        if not operation or not self.matches(path,json.loads(operation['stamp'])):return result
        for row in db.execute('SELECT path,stamp FROM media_subtitle_links WHERE media_id=?',(media_id,)):
            candidate=Path(row['path'])
            if candidate.parent==Path(path).parent and not candidate.is_symlink() and candidate.suffix.lower() in {'.srt','.ass','.ssa','.vtt'} and self.matches(candidate,json.loads(row['stamp'])):
                result.append({'name':candidate.name,'path':str(candidate)})
        return result

    def forget_missing(self,media_id):
        with self.lock,self.connection() as db:
            self.require_idle()
            row=db.execute('SELECT * FROM media WHERE id=?',(media_id,)).fetchone()
            if not row or not row['missing'] or row['file_state']!='normal':raise HTTPException(409,'只能清理普通缺失记录；已回收或待核对记录必须保留')
            # Only FileNotFoundError is proof of absence. Permission errors are not.
            try:Path(row['path']).lstat()
            except FileNotFoundError:pass
            except OSError as error:raise HTTPException(409,operation_error(error)) from error
            else:raise HTTPException(409,'文件仍然存在，请刷新媒体库，不会移除记录')
            if self.readers.get(media_id) or any(value[0]==media_id and value[1]>time.monotonic() for value in self.activities.values()):raise HTTPException(409,'文件仍有读取任务，请关闭后再清理记录')
            tables={item[0] for item in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'playlists' in tables:db.execute('UPDATE playlists SET revision=revision+1 WHERE id IN (SELECT playlist_id FROM playlist_items WHERE media_id=?)',(media_id,))
            db.execute('DELETE FROM playlist_items WHERE media_id=?',(media_id,))
            db.execute('DELETE FROM media_subtitle_links WHERE media_id=?',(media_id,))
            if 'thumbnail_jobs' in tables:db.execute('DELETE FROM thumbnail_jobs WHERE media_id=?',(media_id,))
            db.execute('DELETE FROM media WHERE id=?',(media_id,))
            db.execute('''INSERT INTO file_operations(id,media_id,action,source,stamp,state,error,created_at,finished_at,old_title)
                VALUES(?,?, 'forget',?, '[]','completed','',?,?,?)''',(uuid.uuid4().hex,media_id,row['path'],time.time(),time.time(),row['title']))
        return {'ok':True,'message':'缺失记录已移除，磁盘文件未改变；同路径视频再次扫描时会作为新记录收录'}

    def allow_scan(self,path):
        if not self.blocked:return True
        with self.lock,self.connection() as db:
            row=db.execute('SELECT id,file_state FROM media WHERE path=?',(str(path),)).fetchone()
            if not row or row['file_state']=='normal':return True
            if row['file_state']=='pending':return False
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_changes'").fetchone() and db.execute("SELECT 1 FROM source_changes WHERE media_id=? AND state='pending'",(row['id'],)).fetchone():return False
            if db.execute("SELECT 1 FROM recycle_actions WHERE media_id=? AND state IN ('prepared','dispatched','review')",(row['id'],)).fetchone():return False
            op=db.execute('SELECT stamp FROM file_operations WHERE media_id=? ORDER BY created_at DESC LIMIT 1',(row['id'],)).fetchone()
            if op and self.matches(path,json.loads(op['stamp'])):
                db.execute("UPDATE media SET file_state='normal',missing=0 WHERE id=?",(row['id'],))
                db.execute("UPDATE file_operations SET recycle_status='restored' WHERE media_id=? AND action='recycle' AND stamp=? AND state IN ('completed','review') AND recycle_status IS NULL",(row['id'],op['stamp']))
                self.blocked.discard(row['id']);return True
            return False

    def states(self,page=1,state='all'):
        clauses={'all':"missing=1 OR file_state!='normal'",'missing':"missing=1 AND file_state='normal'",'recycled':"file_state='recycled'",'review':"file_state='review'",'pending':"file_state='pending'"}
        if state not in clauses:raise HTTPException(422,'文件状态无效')
        clause=clauses[state]
        with self.read_connection() as db:
            total=db.execute(f'SELECT COUNT(*) FROM media WHERE {clause}').fetchone()[0]
            rows=[dict(row) for row in db.execute(f'SELECT id,name,title,path,file_state,missing FROM media WHERE {clause} ORDER BY id DESC LIMIT 30 OFFSET ?',((page-1)*30,))]
        for row in rows:row['status']='missing' if row['file_state']=='normal' else row['file_state']
        with self.read_connection() as db:
            has_sources=db.execute("SELECT 1 FROM sqlite_master WHERE name='source_changes'").fetchone()
            for row in rows:
                source=db.execute("SELECT id FROM source_changes WHERE media_id=? AND state='pending'",(row['id'],)).fetchone() if has_sources else None
                recycle=db.execute("SELECT id FROM file_operations WHERE media_id=? AND action='recycle' AND state IN ('completed','review') AND recycle_hidden=0 ORDER BY created_at DESC LIMIT 1",(row['id'],)).fetchone()
                row['source_change_id']=source['id'] if source else None;row['recycle_id']=recycle['id'] if recycle else None
        return {'items':rows,'total':total,'page':page,'pages':max(1,(total+29)//30)}

    def recheck(self,media_id):
        with self.lock,self.read_connection() as db:
            row=db.execute('SELECT path,file_state FROM media WHERE id=?',(media_id,)).fetchone()
            if not row:raise HTTPException(404,'媒体记录不存在')
            if row['file_state']=='pending':raise HTTPException(409,'文件操作仍未完成，请稍后再核对')
            path=Path(row['path'])
        if row['file_state'] in ('recycled','review') and self.allow_scan(path):return {'ok':True,'restored':True}
        if row['file_state']=='normal' and path.is_file():return {'ok':True,'restored':False,'message':'文件已出现，请刷新媒体库重新核对索引'}
        return {'ok':True,'restored':False,'message':'尚未确认原文件恢复到原目录；请检查系统回收站或重新定位目录，记录仍保留'}


class FileReadFence:
    def __init__(self,app,service):self.app=app;self.service=service
    async def __call__(self,scope,receive,send):
        match=re.fullmatch(r'/(?:media|api/media)/(\d+)/(?:file|prepared|subtitle(?:/embedded)?|playback|native-prepare)',scope.get('path',''))
        if scope['type']!='http' or not match:return await self.app(scope,receive,send)
        try:
            with self.service.reader(int(match[1])):await self.app(scope,receive,send)
        except HTTPException as error:
            await JSONResponse({'detail':error.detail},status_code=error.status_code)(scope,receive,send)
