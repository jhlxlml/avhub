import {useEffect,useRef,useState} from 'react';
import {api,errorText,type Media} from './api';
import {requireDesktop} from './nativeDesktop';
import {Button,Dialog,StatusMessage} from './ui';
import {Icon} from './Icon';
import {useDraftGuard} from './useDraftGuard';
import {fileSizeLabel} from './mediaLabels';
import {confirmInApp} from './AppConfirm';

export type FilePermission={root_id:number;supported:boolean;rename:boolean;recycle:boolean;reason:string};
export type FileActionInfo={rename:boolean;recycle:boolean;name:string;reason:string;rename_reason?:string;recycle_reason?:string};
export async function desktopFile(value:Parameters<NonNullable<NonNullable<Window['avhubDesktop']>['fileOperation']>>[0]) {
  const desktop=requireDesktop('fileOperation');
  if(!desktop.fileOperation)throw new Error('请重启已更新的桌面组件');
  return desktop.fileOperation(value);
}

export function FileActionDialog({media,action,close,changed}:{media:Media;action:'rename'|'recycle';close:()=>void;changed:()=>void}){
  const filename=media.path.split(/[\\/]/).pop()||media.name,dot=filename.lastIndexOf('.');
  const extension=dot>0?filename.slice(dot):'',original=dot>0?filename.slice(0,dot):filename;
  const [stem,setStem]=useState(original),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const executing=useRef(false),[coverFailed,setCoverFailed]=useState(false);
  const [subtitleNames,setSubtitleNames]=useState<string[]>([]);
  useEffect(()=>{if(action!=='rename')return;let active=true;void api<Media>(`/api/media/${media.id}`).then(value=>{if(active)setSubtitleNames((value.external_subtitles||[]).map(item=>item.name));}).catch(()=>{});return()=>{active=false;};},[action,media.id]);
  useDraftGuard(action==='rename'&&stem!==original,busy,'文件名修改尚未执行，放弃修改并关闭吗？');
  const requestClose=async()=>{if(!busy&&(action!=='rename'||stem===original||await confirmInApp('放弃文件名修改？',stem+extension,'尚未执行重命名，原文件不会改变。','放弃修改',true)))close();};
  async function execute(){
    if(executing.current)return;executing.current=true;setBusy(true);setError('');
    try{await desktopFile({action,id:media.id,...(action==='rename'?{stem}:{})});changed();close();}
    catch(error){setError(errorText(error));}finally{executing.current=false;setBusy(false);}
  }
  return <Dialog label={action==='rename'?'重命名视频文件':'移入系统回收站'} closeLabel="关闭文件操作" busy={busy} close={requestClose} className="modal library-tool-dialog">
    <h2 className="dialog-title"><Icon name={action==='rename'?'edit':'trash'} size={22}/>{action==='rename'?'重命名文件':'移入系统回收站'}</h2>
    <div className="file-action-target">
      <div className="file-action-cover">{media.thumbnail_url&&!coverFailed?<img src={media.thumbnail_url} alt="目标视频封面" onError={()=>setCoverFailed(true)}/>:<Icon name="film" size={26}/>}</div>
      <div><strong>{filename}</strong><small>{media.title!==filename?media.title+' · ':''}{fileSizeLabel(media.size)||'大小未知'}{media.width&&media.height?` · ${media.width} × ${media.height}`:''}</small></div>
    </div>
    <code className="app-directory-path">{media.path}</code>
    {action==='rename'?<><label className="app-select-field">文件名（扩展名锁定）<input aria-label="新文件名" value={stem} maxLength={255} disabled={busy} onChange={event=>setStem(event.target.value)}/></label>
      <p className="dialog-description">修改后：{stem}{extension}<br/>视频标题：{stem}</p><p className="dialog-description">文件名与视频标题同步更新；保留收藏、进度和片单。自动保留同目录外挂字幕关联，不修改字幕文件。字幕被替换或修改后需重新导入。</p>{subtitleNames.length>0&&<p className="dialog-description">检测到 {subtitleNames.length} 个外挂字幕：{subtitleNames.join('、')}</p>}</>:
      <p className="dialog-description">将此视频交给 Windows 系统回收站，不建立应用回收目录。恢复请使用系统回收站；回收失败不会改为永久删除。收藏、进度和片单记录保留。</p>}
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
    <div className="tool-footer"><Button disabled={busy} onClick={requestClose}>取消</Button><Button icon={action==='rename'?'edit':'trash'} variant={action==='rename'?'primary':'danger'} busy={busy} disabled={action==='rename'&&(!stem||stem===original)} onClick={()=>void execute()}>{action==='rename'?'确认重命名':'确认移入回收站'}</Button></div>
  </Dialog>;
}

type Operation={id:string;media_id:number;action:string;source:string;target:string|null;state:string;error:string;created_at:number};
type Operations={items:Operation[];total:number;page:number;pages:number};
const states:Record<string,string>={prepared:'操作未完成',completed:'已完成',failed:'未执行或失败',review:'需要核对',undone:'已撤销'};
type FileState={id:number;name:string;title:string;path:string;status:'missing'|'recycled'|'review'|'pending'};
type FileStates={items:FileState[];total:number;page:number;pages:number};
const fileStates:Record<FileState['status'],string>={missing:'文件缺失',recycled:'已移入系统回收站',review:'待核对',pending:'操作中'};
export function FileStatePanel({enabled,busy,changeBusy,reload}:{enabled:boolean;busy:boolean;changeBusy:(value:boolean)=>void;reload:()=>Promise<void>}){
  const [filter,setFilter]=useState('all'),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[data,setData]=useState<FileStates|null>(null),[loading,setLoading]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const running=useRef(false);
  useEffect(()=>{
    if(!enabled)return;const controller=new AbortController();setLoading(true);setError('');
    void api<FileStates>(`/api/file-states?page=${page}&state=${filter}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(error=>{if(!controller.signal.aborted)setError(errorText(error));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[enabled,page,filter,revision]);
  async function recheck(id:number,forget=false){
    if(busy||running.current)return;running.current=true;changeBusy(true);setNotice('');setError('');
    try{
      if(forget&&!await confirmInApp('仅移除缺失记录？',data?.items.find(item=>item.id===id)?.path||'','只清理此条索引及其收藏、进度和片单引用，不删除磁盘文件。记录不能撤销；视频再次扫描时会作为新记录收录。','移除记录',true))return;
      const result=await desktopFile({action:forget?'forget':'recheck',id});if(result.restored||forget)await reload();setNotice(result.restored?'已确认原文件恢复，收藏、进度和片单保留':result.message||'已核对文件状态');}
    catch(error){setError(errorText(error));}finally{running.current=false;changeBusy(false);setRevision(value=>value+1);}
  }
  return <section className="settings-section" aria-label="文件状态管理"><h3><Icon name="shield"/>文件状态管理</h3>
    <p className="dialog-description">系统还原到原目录后可核对恢复；文件身份不一致时不会误认。普通缺失项可仅移除记录（包括收藏、进度和片单引用），不删除磁盘文件。已回收和待核对项不允许清理。</p>
    <div className="app-tool-actions"><label className="app-select-field">文件状态<select aria-label="文件状态筛选" value={filter} disabled={busy} onChange={event=>{setFilter(event.target.value);setPage(1);setData(null);}}><option value="all">全部异常状态</option>{Object.entries(fileStates).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><Button icon="refresh" disabled={busy||loading} onClick={()=>setRevision(value=>value+1)}>刷新状态</Button></div>
    {loading?<StatusMessage kind="loading">正在核对索引状态…</StatusMessage>:data?.items.length?<ol className="file-operation-list">{data.items.map(item=><li key={item.id}><div><strong>{fileStates[item.status]} · {item.title}</strong><code>{item.path}</code></div><div className="app-tool-actions"><Button icon="refresh" disabled={busy||item.status==='pending'||!window.avhubDesktop?.fileOperation} onClick={()=>void recheck(item.id)}>核对恢复</Button>{item.status==='missing'&&<Button icon="trash" variant="danger" disabled={busy||!window.avhubDesktop?.fileOperation} onClick={()=>void recheck(item.id,true)}>仅移除记录</Button>}</div></li>)}</ol>:!error&&<p className="dialog-description">暂无此类文件状态</p>}
    {data&&data.pages>1&&<div className="root-pager"><span>{data.page} / {data.pages} 页 · {data.total} 条</span><Button disabled={busy||loading||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</Button><Button disabled={busy||loading||page>=data.pages} onClick={()=>setPage(value=>value+1)}>下一页</Button></div>}
    {notice&&<StatusMessage kind="info">{notice}</StatusMessage>}{error&&<StatusMessage kind="error">{error}</StatusMessage>}
  </section>;
}
export function FileOperationHistory({enabled,busy,changeBusy}:{enabled:boolean;busy:boolean;changeBusy:(busy:boolean)=>void;reload:()=>Promise<void>}){
  const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[result,setResult]=useState<Operations|null>(null),[working,setWorking]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!enabled)return;const controller=new AbortController();void api<Operations>(`/api/file-operations?page=${page}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setResult(value);}).catch(error=>{if(!controller.signal.aborted)setError(errorText(error));});return()=>controller.abort();},[enabled,page,revision]);
  async function action(){
    if(busy||working)return;setWorking(true);changeBusy(true);setError('');
    try{await desktopFile({action:'recycle-bin'});}
    catch(error){setError(errorText(error));}finally{setWorking(false);changeBusy(false);}
  }
  return <section className="settings-section" aria-label="文件操作记录"><h3><Icon name="history"/>文件操作记录</h3>
    <p className="dialog-description">只保存操作日志，不保存视频副本。重命名不提供撤销；删除还原由系统回收站负责，恢复后核对恢复或刷新媒体库。</p>
    <div className="app-tool-actions"><Button icon="trash" disabled={busy||working||!window.avhubDesktop?.fileOperation} onClick={()=>void action()}>打开系统回收站</Button><Button icon="refresh" disabled={busy||working} onClick={()=>{setError('');setRevision(value=>value+1);}}>刷新记录</Button></div>
    {result?.items.length?<ol className="file-operation-list">{result.items.map(op=><li key={op.id}><div><strong>{op.action==='rename'?'重命名':op.action==='forget'?'仅移除记录':'系统回收'} · {states[op.state]||op.state}</strong><small>{new Date(op.created_at*1000).toLocaleString()}</small><code>{op.source}</code>{op.target&&<code>→ {op.target}</code>}{op.error&&<small className="file-operation-error">{op.error}</small>}</div></li>)}</ol>:<p className="dialog-description">暂无文件操作记录</p>}
    {result&&result.pages>1&&<div className="root-pager"><span>{result.page} / {result.pages} 页 · {result.total} 条</span><Button disabled={busy||working||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</Button><Button disabled={busy||working||page>=result.pages} onClick={()=>setPage(value=>value+1)}>下一页</Button></div>}
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
  </section>;
}
