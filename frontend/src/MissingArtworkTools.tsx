import {useEffect,useRef,useState} from 'react';
import {api,json,errorText} from './api';
import {Button,IconButton,StatusMessage} from './ui';
import {Icon} from './Icon';
import {confirmAction} from './confirmAction';

type Item={id:number;title:string;path:string;root_path:string|null;eligible:boolean;bytes:number;reason:string;manual_cover_kept:boolean};
type Report={items:Item[];total:number;page:number;pages:number;page_size:number;token:string;eligible_count:number;eligible_bytes:number;note:string};
const bytes=(value:number)=>value>=1048576?`${(value/1048576).toFixed(1)} MB`:`${(value/1024).toFixed(1)} KB`;

export function MissingArtworkTools({busy,changeBusy,scanning,enabled,reload}:{busy:boolean;changeBusy:(value:boolean)=>void;scanning:boolean;enabled:boolean;reload:()=>Promise<void>}){
 const [report,setReport]=useState<Report|null>(null),[picked,setPicked]=useState<number[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const controller=useRef<AbortController|null>(null),working=useRef(false);
 const enabledNow=useRef(enabled);enabledNow.current=enabled;
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),5000);return()=>window.clearTimeout(timer);},[notice]);
 useEffect(()=>{
  if(!enabled){controller.current?.abort();setLoading(false);setReport(null);setPicked([]);}
  const changed=()=>{controller.current?.abort();setLoading(false);setReport(null);setPicked([]);};
  window.addEventListener('avhub-file-states-changed',changed);
  return()=>{controller.current?.abort();window.removeEventListener('avhub-file-states-changed',changed);};
 },[enabled]);
 async function preview(page=1){
  controller.current?.abort();const next=new AbortController();controller.current=next;
  setLoading(true);setReport(null);setPicked([]);setError('');
  try{const result=await api<Report>(`/api/storage/missing-artwork?page=${page}&page_size=24`,{signal:next.signal,timeoutMs:30000});if(!next.signal.aborted)setReport(result);}
  catch(e){if(!next.signal.aborted)setError(errorText(e));}finally{if(!next.signal.aborted)setLoading(false);}
 }
 const eligible=report?.items.filter(item=>item.eligible)??[];
 const selected=eligible.filter(item=>picked.includes(item.id));
 const selectedBytes=selected.reduce((total,item)=>total+item.bytes,0);
 async function clean(){
  if(!report||busy||scanning||working.current||!selected.length)return;
  working.current=true;const snapshot=report,ids=selected.map(item=>item.id);
  try{
   if(!await confirmAction('清理所选自动封面？',`将永久清理 ${ids.length} 张自动封面，约 ${bytes(selectedBytes)}。`,'保留索引、观看记录、收藏、片单和手动封面；原视频不会删除。文件移回后刷新可重新生成自动封面。'))return;
   if(!enabledNow.current)return;
   changeBusy(true);setError('');setNotice('');
   const result=await api<{removed:number;freed_bytes:number;skipped:number}>('/api/storage/missing-artwork/cleanup',json('POST',{token:snapshot.token,media_ids:ids,page:snapshot.page,page_size:snapshot.page_size}));
   setPicked([]);setNotice(`已清理 ${result.removed} 张自动封面 · ${bytes(result.freed_bytes)}${result.skipped?`；${result.skipped} 项已变化或占用，已跳过`:''}。索引和观看数据已保留。`);
   await preview(snapshot.page);await reload();
  }catch(e){setReport(null);setPicked([]);setError(errorText(e));}
  finally{working.current=false;changeBusy(false);}
 }
 return <section className="settings-section missing-artwork-tools" aria-label="失效视频与封面">
  <h3><Icon name="camera"/>失效视频与封面</h3>
  <p className="dialog-description">核对刷新后标记缺失的视频，按需清理自动封面。不会删除视频索引、观看数据或原文件。</p>
  <div className="storage-actions"><Button icon="refresh" busy={loading} disabled={busy} onClick={()=>void preview()}>预览失效封面</Button>
   <Button icon="trash" variant="danger" disabled={busy||loading||scanning||!selected.length} onClick={()=>void clean()}>清理所选封面{selected.length?`（${selected.length}）`:''}</Button></div>
  {report&&<>
   <p className="storage-preview" role="status">共 {report.total} 条缺失索引 · 本页可清理 {report.eligible_count} 张 / {bytes(report.eligible_bytes)}<small>{report.note}</small></p>
   {report.items.length>0&&<div className="missing-artwork-selection"><Button disabled={busy||loading||!eligible.length} onClick={()=>setPicked(eligible.map(item=>item.id))}>选中本页可清理项</Button><Button disabled={busy||loading||!picked.length} onClick={()=>setPicked([])}>取消选择</Button><span>已选 {selected.length} 张 · {bytes(selectedBytes)}</span></div>}
   <ul className="missing-artwork-list">{report.items.map(item=><li key={item.id}><label className="missing-artwork-choice">
    <input type="checkbox" aria-label={`选择封面 ${item.title}`} disabled={busy||!item.eligible} checked={picked.includes(item.id)} onChange={event=>setPicked(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/>
    <span className="missing-artwork-copy"><b title={item.title}>{item.title}</b><span title={item.path}>{item.path}</span><small>{item.reason}{item.manual_cover_kept?' · 手动封面保留':''}</small></span></label><span className="missing-artwork-size">{bytes(item.bytes)}</span>
   </li>)}</ul>
   {!report.items.length&&<p className="storage-preview">暂无缺失视频；可先刷新媒体库，再来核对。</p>}
   {report.pages>1&&<div className="missing-artwork-pages" role="navigation" aria-label="缺失视频分页"><IconButton icon="chevronLeft" label="上一页缺失视频" disabled={busy||loading||report.page<=1} onClick={()=>void preview(report.page-1)}/><span>第 {report.page} / {report.pages} 页</span><IconButton icon="chevronRight" label="下一页缺失视频" disabled={busy||loading||report.page>=report.pages} onClick={()=>void preview(report.page+1)}/></div>}
  </>}
  {scanning&&<p className="storage-preview">扫描期间可预览；请等扫描完成后清理。</p>}
  {loading&&<StatusMessage kind="loading">正在核对本页文件与封面…</StatusMessage>}{error&&<StatusMessage kind="error">{error}</StatusMessage>}{notice&&<StatusMessage kind="success">{notice}</StatusMessage>}
 </section>;
}
