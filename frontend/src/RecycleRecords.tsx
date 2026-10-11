import {useEffect,useRef,useState} from 'react';
import {api,errorText} from './api';
import {desktopFile} from './FileManagement';
import {Button,Dialog,EmptyState,StatusMessage,Toast} from './ui';
import {Icon} from './Icon';
import {confirmInApp} from './AppConfirm';
import {fileSizeLabel} from './mediaLabels';
import {useDraftGuard} from './useDraftGuard';
import {MediaThumbnail} from './MediaThumbnail';

type Entry={id:string;media_id:number;name:string;title:string;source:string;size:number;created_at:number;status:'available'|'restored'|'missing'|'offline'|'deleted'|'review'|'pending';error:string;thumbnail_url?:string|null;can_recheck?:boolean};
type Page={items:Entry[];total:number;page:number;pages:number};
type RecordAction='restore-record'|'delete-record'|'clear-record';
type Task={item:Entry;action:'restore'|'delete'|'clear';status:'queued'|'running'|'success'|'failed'|'skipped'|'stopped';reason:string};
const taskLabels:Record<Task['status'],string>={queued:'待执行',running:'正在处理',success:'已完成',failed:'失败',skipped:'跳过',stopped:'未执行'};
const labels:Record<Entry['status'],string>={available:'可恢复',restored:'已恢复',missing:'回收站中未找到',offline:'磁盘离线',deleted:'已永久删除',review:'待核对',pending:'操作中'};
export function RecycleRecords({close,changed}:{close:()=>void;changed:()=>void}){
  const [data,setData]=useState<Page|null>(null),[page,setPage]=useState(1),[query,setQuery]=useState(''),[search,setSearch]=useState('');
  const [revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [picked,setPicked]=useState<string[]>([]),[result,setResult]=useState<Task[]>([]),[lastAction,setLastAction]=useState<RecordAction>('restore-record');
  const [phase,setPhase]=useState(''),[progress,setProgress]=useState({done:0,total:0,current:''});
  const [focusRecord,setFocusRecord]=useState('');
  const locked=useRef(false),stopped=useRef(false),[stopping,setStopping]=useState(false),refreshRequested=useRef(true);
  useDraftGuard(false,busy,'回收记录操作尚未完成，请等待当前项完成');
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setPicked([]);
    const refresh=refreshRequested.current;refreshRequested.current=false;
    void api<Page>(`/api/recycle-records?page=${page}&q=${encodeURIComponent(search)}&refresh=${refresh}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setData(value);if(value.page!==page)setPage(value.page);}}).catch(error=>{if(!controller.signal.aborted){setData(null);setError(errorText(error));}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[page,search,revision]);
  const chosen=data?.items.filter(item=>picked.includes(item.id))||[];
  const selectable=data?.items.filter(item=>!['offline','review','pending'].includes(item.status))||[];
  const selectionDisabled=busy||loading||query.trim()!==search;
  const retries=result.filter(task=>task.status==='failed').map(task=>data?.items.find(item=>item.id===task.item.id)).filter((item):item is Entry=>Boolean(item&&!['offline','review','pending'].includes(item.status)));
  const offPageFailures=result.filter(task=>task.status==='failed'&&!data?.items.some(item=>item.id===task.item.id));
  function reload(){refreshRequested.current=true;setRevision(value=>value+1);}
  useEffect(()=>{if(!loading&&focusRecord&&data?.items.some(item=>item.id===focusRecord)){const target=document.querySelector<HTMLElement>(`[data-recycle-id="${focusRecord}"]`);target?.scrollIntoView({block:'nearest'});target?.focus({preventScroll:true});setFocusRecord('');}},[data,loading,focusRecord]);
  async function locate(item:Entry){
    if(selectionDisabled||locked.current)return;setError('');
    try{const location=await api<{page:number}>(`/api/recycle-records/${item.id}/location`);setQuery('');setSearch('');setPage(location.page);setPicked([]);setFocusRecord(item.id);reload();}
    catch(error){setError(errorText(error));}
  }
  async function recheck(item:Entry){
    if(locked.current||selectionDisabled)return;locked.current=true;setBusy(true);setError('');
    try{const value=await desktopFile({action:'recheck-record',id:item.id});setNotice(value.message||'已核对操作结果');changed();reload();}
    catch(error){setError(errorText(error));}finally{setBusy(false);locked.current=false;}
  }
  async function run(items:Entry[],action:RecordAction){
    if(locked.current||selectionDisabled||!items.length)return;
    const previousResult=result,previousAction=lastAction;
    locked.current=true;setBusy(true);setLastAction(action);setPhase('正在核对操作清单…');setError('');setNotice('');setResult([]);setProgress({done:0,total:items.length,current:''});stopped.current=false;setStopping(false);
    let token='';let touched=false;
    try{
      const preview=await desktopFile({action:'preview-records',recordIds:items.map(item=>item.id),recordAction:action.split('-')[0] as Task['action']});
      if(!preview.preview_token||!preview.records)throw new Error('操作预览响应异常，请更新桌面组件');token=preview.preview_token;
      if(new Set(preview.records.map(record=>record.id)).size!==preview.records.length||preview.records.some(record=>!items.some(item=>item.id===record.id)||!['restore','delete','clear'].includes(record.action)||record.eligible&&(action==='restore-record'&&record.action!=='restore'||action==='clear-record'&&record.action!=='clear'||action==='delete-record'&&record.action==='restore')))throw new Error('操作预览清单不一致，已拒绝执行');
      const tasks:Task[]=preview.records.map(record=>({item:{...items.find(item=>item.id===record.id)!,...(record.name?{name:record.name,source:record.source!,size:record.size||0}:{})},action:record.action,status:record.eligible?'queued':'skipped',reason:record.reason}));
      setResult(tasks);const eligible=tasks.filter(task=>task.status==='queued');
      if(!eligible.length){setError('没有可安全执行的项目，请查看跳过原因。');return;}
      if(stopped.current){setResult(tasks.map(task=>task.status==='queued'?{...task,status:'stopped',reason:'预检期间已停止，未执行文件操作'}:task));return;}
      const deleting=eligible.filter(task=>task.action==='delete'),permanent=deleting.length>0;
      if(action!=='restore-record'||eligible.length>1){
        setPhase('等待确认…');
        const restoring=action==='restore-record';
        const accepted=await confirmInApp(restoring?`恢复 ${eligible.length} 个视频？`:permanent?`永久删除 ${deleting.length} 个视频？`:'清除回收历史？',
          restoring?`将恢复 ${eligible.length} 个视频至各自原目录；跳过 ${tasks.length-eligible.length} 项。`:permanent?`${deleting.length} 个视频 · ${fileSizeLabel(deleting.reduce((sum,task)=>sum+task.item.size,0))}。${eligible.length===1?`${eligible[0].item.name}\n原位置：${eligible[0].item.source}`:`仅处理已选项目，并清除 ${eligible.length-deleting.length} 条已恢复或失效记录。`}`:`将清除 ${eligible.length} 条已恢复或回收站中未找到的历史记录。`,
          restoring?'不会覆盖同名文件或自动改名；每项执行前重新检查身份与目录权限。':
          permanent?'删除后无法通过回收站恢复。不会清空整个系统回收站；失败项保留记录。':'不删除现有文件。回收记录入口不再显示这些项目。',restoring?'恢复所选':permanent?'永久删除':'清除记录',!restoring);
        if(!accepted){setResult(previousResult);setLastAction(previousAction);return;}
      }
      setPhase('正在处理…');setProgress({done:0,total:eligible.length,current:''});let success=0,done=0;
      const update=(task:Task,status:Task['status'],reason='')=>setResult(current=>current.map(value=>value.item.id===task.item.id?{...value,status,reason}:value));
      for(const task of eligible){
        if(stopped.current){update(task,'stopped','已停止后续操作');continue;}
        update(task,'running');setProgress({done,total:eligible.length,current:task.item.name});
        try{
          touched=true;const value=await desktopFile({action:`${task.action}-record`,id:task.item.id,confirmed:task.action==='delete',previewToken:token});
          if(!value.ok)throw new Error('操作结果未确认');success++;update(task,'success',value.message||'操作完成');
        }catch(error){
          const message=errorText(error);update(task,'failed',message);
          if(/未确认|需核对|超时|接口.*中断|预览已失效|服务响应异常/.test(message)){stopped.current=true;setStopping(true);setError('结果不确定或预览失效，已停止后续操作；请先核对结果。');}
        }
        done++;setProgress(current=>({...current,done}));
      }
      if(success){changed();setNotice(`已完成 ${success} 项`);}
    }catch(error){setError(errorText(error));}
    finally{
      if(token)await desktopFile({action:'release-record-preview',previewToken:token}).catch(()=>{});
      if(touched)reload();setBusy(false);setPhase('');locked.current=false;
    }
  }
  return <Dialog label="回收记录" closeLabel="关闭回收记录" busy={busy} close={close} className="modal library-tool-dialog recycle-record-dialog">
    <h2 className="dialog-title"><Icon name="trash" size={22}/>回收记录</h2>
    <p className="dialog-description">视频保存在 Windows 系统回收站，AVHub 不保存视频副本。恢复至原目录；永久删除仅处理精确匹配的项目。</p>
    <div className="recycle-record-toolbar"><label className="recycle-record-search"><Icon name="search" size={17}/><input aria-label="搜索回收记录" placeholder="搜索文件名或原目录" value={query} disabled={busy} onChange={event=>{setQuery(event.target.value);setPage(1);setPicked([]);}}/></label>
      <Button icon="refresh" aria-label="刷新回收记录" title="刷新回收记录" disabled={selectionDisabled} onClick={reload}/>
      <Button icon="external" disabled={busy} onClick={()=>void desktopFile({action:'recycle-bin'}).catch(error=>setError(errorText(error)))}>系统回收站</Button></div>
    {data&&data.items.length>0&&<div className="recycle-record-selection" role="group" aria-label="回收记录选择">
      <Button icon="check" disabled={selectionDisabled||!selectable.length||chosen.length===selectable.length} onClick={()=>setPicked(selectable.map(item=>item.id))}>全选本页</Button>
      <Button disabled={selectionDisabled||!selectable.length} onClick={()=>setPicked(current=>selectable.filter(item=>!current.includes(item.id)).map(item=>item.id))}>反选本页</Button>
      <Button icon="close" disabled={selectionDisabled||!chosen.length} onClick={()=>setPicked([])}>取消选择</Button>
      <span aria-live="polite">已选 {chosen.length} / {selectable.length} 项 · 仅本页</span>
      {chosen.some(item=>item.status==='available')&&<Button icon="history" disabled={selectionDisabled} onClick={()=>void run(chosen.filter(item=>item.status==='available'),'restore-record')}>恢复所选</Button>}
      {chosen.some(item=>item.status==='available')&&<Button icon="trash" variant="danger" disabled={selectionDisabled} onClick={()=>void run(chosen,'delete-record')}>{chosen.every(item=>item.status==='available')?'永久删除':'删除文件及记录'}</Button>}
      {chosen.length>0&&chosen.every(item=>['restored','missing','deleted'].includes(item.status))&&<Button icon="close" disabled={selectionDisabled} onClick={()=>void run(chosen,'clear-record')}>清除记录</Button>}
    </div>}
    {busy&&<div className="recycle-record-progress" role="region" aria-label="回收操作进度"><StatusMessage kind="loading">{phase} {progress.current&&`${progress.done} / ${progress.total} · ${progress.current}`}</StatusMessage>
      <progress aria-label="已完成项目" max={Math.max(1,progress.total)} value={progress.done}/><Button disabled={stopping} onClick={()=>{stopped.current=true;setStopping(true);}}>停止后续操作</Button></div>}
    {loading?<StatusMessage kind="loading">正在核对系统回收站…</StatusMessage>:data?.items.length?<ol className="recycle-record-list">{data.items.map(item=><li key={item.id} data-recycle-id={item.id} tabIndex={-1}>
      <input type="checkbox" aria-label={`选择回收记录 ${item.name}`} disabled={selectionDisabled||['offline','review','pending'].includes(item.status)} checked={picked.includes(item.id)} onChange={event=>setPicked(value=>event.target.checked?[...new Set([...value,item.id])]:value.filter(id=>id!==item.id))}/>
      <div className="recycle-record-cover"><MediaThumbnail url={item.thumbnail_url}/></div>
      <div className="recycle-record-details"><strong title={item.name}>{item.name}</strong><span className={`recycle-record-status is-${item.status}`}>{labels[item.status]}</span><small>{fileSizeLabel(item.size)} · {new Date(item.created_at*1000).toLocaleString()}</small><code title={item.source}>{item.source}</code>{item.error&&<small className="file-operation-error">{item.error}</small>}</div>
      <div className="recycle-record-actions">{item.status==='available'?<><Button icon="history" disabled={selectionDisabled} onClick={()=>void run([item],'restore-record')}>恢复</Button><Button icon="trash" aria-label={`永久删除 ${item.name}`} title="永久删除" variant="danger" disabled={selectionDisabled} onClick={()=>void run([item],'delete-record')}/></>:['restored','missing','deleted'].includes(item.status)?<Button icon="close" disabled={selectionDisabled} onClick={()=>void run([item],'clear-record')}>清除记录</Button>:item.can_recheck?<Button icon="refresh" disabled={selectionDisabled} onClick={()=>void recheck(item)}>核对结果</Button>:null}</div>
    </li>)}</ol>:!error&&<EmptyState icon="trash" title="暂无回收记录" description={search?'没有匹配的记录':'通过 AVHub 回收的视频会显示在这里。'}/>}
    {data&&<div className="root-pager"><span>{data.total} 条 · {data.page} / {data.pages} 页</span><Button disabled={busy||loading||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</Button><Button disabled={busy||loading||page>=data.pages} onClick={()=>setPage(value=>value+1)}>下一页</Button></div>}
    {result.length>0&&<details className="recycle-record-results" open={busy||result.some(task=>['failed','skipped','stopped'].includes(task.status))}><summary>操作结果 · {result.length} 项 · 成功 {result.filter(task=>task.status==='success').length} · 失败 {result.filter(task=>task.status==='failed').length} · 跳过 {result.filter(task=>task.status==='skipped').length} · 未执行 {result.filter(task=>task.status==='stopped').length}</summary>
      {result.map(task=><div key={task.item.id} className="recycle-result-entry"><p data-state={task.status}><strong>{taskLabels[task.status]}</strong> · {task.item.name}{task.reason&&`：${task.reason}`}</p>{task.status==='failed'&&<Button icon="search" disabled={selectionDisabled||data?.items.some(item=>item.id===task.item.id)} aria-label={`定位失败记录 ${task.item.name}`} onClick={()=>void locate(task.item)}>{data?.items.some(item=>item.id===task.item.id)?'当前页':'定位记录'}</Button>}</div>)}
      {result.some(task=>task.status==='failed')&&<Button icon="refresh" disabled={selectionDisabled||!retries.length} onClick={()=>void run(retries,lastAction)}>重试失败项（重新核对）</Button>}
      {offPageFailures.length>0&&<p>有 {offPageFailures.length} 条失败记录不在当前页，请先定位记录；重试只处理本页可操作项。</p>}
    </details>}
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
    {notice&&<Toast message={notice} autoDismissMs={3500} close={()=>setNotice('')}/>}
  </Dialog>;
}
