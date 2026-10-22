import {useEffect,useId,useRef,useState} from 'react';
import {api,errorText} from './api';
import {Button,ContentState,Dialog,DialogHeader,Toast} from './ui';
import {MediaThumbnail} from './MediaThumbnail';
import {fileSizeLabel} from './mediaLabels';
import {restoreRecordedVideo,type RecycledNotice} from './recycleRecovery';
import {useDraftGuard} from './useDraftGuard';

type Recent={id:string;name:string;source:string;size:number;created_at:number;status:string;error:string;thumbnail_url?:string};
const statuses:Record<string,string>={available:'可恢复',restored:'已恢复',missing:'回收站中未找到',offline:'磁盘离线',deleted:'已删除',review:'待核对',pending:'操作中'};
function openRecords(id=''){window.dispatchEvent(new CustomEvent('avhub-open-recycle-records',{detail:id}));}
export function RecycleFeedback({changed}:{changed:()=>void}){
  const [notice,setNotice]=useState<RecycledNotice|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const locked=useRef(false);
  useDraftGuard(false,busy,'恢复操作尚未完成，请等待系统返回结果');
  useEffect(()=>{const received=(event:Event)=>{const detail=(event as CustomEvent<RecycledNotice>).detail;if(detail?.records?.length&&detail.records.every(item=>typeof item.id==='string'&&/^[a-f0-9]{32}$/.test(item.id))){setNotice(detail);setError('');}};window.addEventListener('avhub-recycled',received);return()=>window.removeEventListener('avhub-recycled',received);},[]);
  async function restore(){if(locked.current||!notice||notice.records.length!==1)return;locked.current=true;setBusy(true);setError('');try{await restoreRecordedVideo(notice.records[0].id);changed();setNotice(null);}catch(e){setError(errorText(e));}finally{locked.current=false;setBusy(false);}}
  return <>{notice&&<Toast message={error||`已将 ${notice.records.length===1?notice.records[0].title:`${notice.records.length} 个视频`}移入系统回收站`} close={()=>{if(!busy){setNotice(null);setError('');}}} autoDismissMs={error?0:10000} pauseAutoDismiss={busy} pauseOnInteraction closeDisabled={busy}>
    {notice.records.length===1&&!error&&<Button icon="history" busy={busy} onClick={()=>void restore()}>恢复视频</Button>}
    <Button icon="trash" disabled={busy} onClick={()=>{const id=notice.records.length===1?notice.records[0].id:'';setNotice(null);openRecords(id);}}>查看回收记录</Button>
  </Toast>}</>;
}
export function RecentRecycle({changed}:{changed:()=>void}){
  const headingId=useId(),descriptionId=useId();
  const [open,setOpen]=useState(false),[items,setItems]=useState<Recent[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState('');const locked=useRef(false);
  useDraftGuard(false,busy,'恢复操作尚未完成，请等待当前项完成');
  useEffect(()=>{if(!open)return;const controller=new AbortController();setLoading(true);setError('');void api<{items:Recent[];total:number}>('/api/recycle-records?page=1&refresh=true',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setItems(value.items.slice(0,6));setTotal(value.total);}}).catch(e=>{if(!controller.signal.aborted){setItems([]);setError(errorText(e));}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[open,revision]);
  async function restore(item:Recent){if(locked.current||loading)return;locked.current=true;setBusy(true);setError('');try{await restoreRecordedVideo(item.id);changed();setNotice(`已恢复 ${item.name}`);setRevision(value=>value+1);}catch(e){setError(errorText(e));}finally{locked.current=false;setBusy(false);}}
  return <><Button icon="history" className="recent-recycle-entry" aria-label="最近回收" title="最近回收" onClick={()=>{setNotice('');setError('');setLoading(true);setOpen(true);}}/>{open&&<Dialog labelledBy={headingId} describedBy={descriptionId} closeLabel="关闭最近回收" close={()=>setOpen(false)} busy={busy} className="modal recent-recycle-dialog">
    <DialogHeader id={headingId} descriptionId={descriptionId} icon="history" title="最近回收" description={`最近 6 条记录 · ${loading?'正在核对':`共 ${total} 条`}。恢复会重新核对原位置、文件身份与目录权限，不覆盖同名文件。`}/>
    <div className="recent-recycle-content">
    {loading?<ContentState kind="loading" title="正在核对回收记录…"/>:items.length?<ol className="recent-recycle-list" aria-label="最近回收记录">{items.map(item=><li key={item.id}><span className="recent-recycle-cover"><MediaThumbnail url={item.thumbnail_url}/></span><div><strong title={item.name}>{item.name}</strong><small><span className={`recycle-record-status is-${item.status}`}>{statuses[item.status]||'待核对'}</span> · {fileSizeLabel(item.size)}</small><code title={item.source}>{item.source}</code></div><Button icon={item.status==='available'?'history':'search'} disabled={busy||loading} onClick={()=>item.status==='available'?void restore(item):(setOpen(false),openRecords(item.id))}>{item.status==='available'?'恢复':'查看'}</Button></li>)}</ol>:!error&&<ContentState kind="empty" title="暂无回收记录" description="通过 AVHub 回收的视频会显示在这里。"/>}
    {error&&<ContentState kind="error" title="回收记录暂时无法更新" description={error}/>}
    </div>
    {notice&&<Toast message={notice} autoDismissMs={4000} close={()=>setNotice('')}/>}
    <div className="tool-footer"><Button icon="refresh" disabled={busy||loading} onClick={()=>setRevision(value=>value+1)}>刷新</Button><Button icon="trash" disabled={busy} onClick={()=>{setOpen(false);openRecords();}}>查看全部回收记录</Button></div>
  </Dialog>}</>;
}
