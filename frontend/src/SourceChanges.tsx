import {useEffect,useRef,useState} from 'react';
import {api,errorText} from './api';
import {desktopFile} from './FileManagement';
import {Button,StatusMessage,Toast} from './ui';
import {Icon} from './Icon';
import {confirmInApp} from './AppConfirm';
import {fileSizeLabel} from './mediaLabels';

type Change={id:string;media_id:number;kind:string;source:string;title:string;signature:string;size:number;created_at:number};
type Page={items:Change[];total:number;page:number;pages:number};
export function SourceChanges({enabled,busy,changeBusy,reload}:{enabled:boolean;busy:boolean;changeBusy:(value:boolean)=>void;reload:()=>Promise<void>}){
  const [data,setData]=useState<Page|null>(null),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[loading,setLoading]=useState(false),[open,setOpen]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const panel=useRef<HTMLDetailsElement>(null),locked=useRef(false);
  useEffect(()=>{if(!enabled)return;const controller=new AbortController();setLoading(true);void api<Page>(`/api/source-changes?page=${page}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setData(value);setPage(value.page);if(value.total)setOpen(true);}}).catch(error=>{if(!controller.signal.aborted)setError(errorText(error));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[enabled,page,revision]);
  useEffect(()=>{const show=()=>{setOpen(true);panel.current?.scrollIntoView({block:'center'});panel.current?.querySelector<HTMLElement>('summary')?.focus();};window.addEventListener('avhub-open-source-changes',show);return()=>window.removeEventListener('avhub-open-source-changes',show);},[]);
  async function decide(item:Change,decision:'keep'|'reset'){
    if(busy||loading||locked.current)return;
    const accepted=await confirmInApp(decision==='keep'?'保留原媒体信息？':'作为新视频收录？',`${item.title}\n${item.source}`,
      decision==='keep'?'只有你确认仍是同一个视频时才保留收藏、进度和片单；将更新技术信息，旧封面会重新生成。不会修改视频文件。':'新记录不继承旧标题、收藏、进度、标签或片单。原个人信息留在数据库归档中，不复制旧视频，也不删除当前文件。',decision==='keep'?'确认保留':'重新收录',decision==='reset');
    if(!accepted)return;locked.current=true;changeBusy(true);setError('');
    try{const result=await desktopFile({action:'resolve-source',id:item.id,decision,signature:item.signature});setNotice(result.message||'来源已确认');await reload();window.dispatchEvent(new Event('avhub-file-states-changed'));setRevision(value=>value+1);}
    catch(error){setError(errorText(error));}finally{locked.current=false;changeBusy(false);}
  }
  return <details ref={panel} className="settings-section source-change-panel" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><Icon name="shield"/>来源变更待确认{data?.total?` · ${data.total} 项`:''}</summary>
    <p className="dialog-description">外部替换或内容元数据变化不会直接沿用旧观看信息。确认前暂停这些记录的播放和文件操作；这里的决定只修改媒体库。</p>
    <Button icon="refresh" disabled={busy||loading} onClick={()=>{setError('');setRevision(value=>value+1);}}>刷新来源状态</Button>
    {loading?<StatusMessage kind="loading">正在读取来源状态…</StatusMessage>:data?.items.length?<ol className="file-operation-list">{data.items.map(item=><li key={item.id}><div><strong>{item.kind==='replacement'?'文件身份已变化':'源文件有变化'} · {item.title}</strong><code>{item.source}</code><small>当前大小 {fileSizeLabel(item.size)}</small></div><div className="app-tool-actions"><Button disabled={busy} onClick={()=>void decide(item,'keep')}>保留原媒体信息</Button><Button disabled={busy} onClick={()=>void decide(item,'reset')}>作为新视频</Button></div></li>)}</ol>:<p className="dialog-description">暂无待确认的来源变更</p>}
    {data&&data.pages>1&&<div className="root-pager"><span>{data.page} / {data.pages} 页</span><Button disabled={busy||loading||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</Button><Button disabled={busy||loading||page>=data.pages} onClick={()=>setPage(value=>value+1)}>下一页</Button></div>}
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}{notice&&<Toast message={notice} close={()=>setNotice('')} autoDismissMs={4000}/>}
  </details>;
}
