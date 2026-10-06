import {useEffect,useRef,useState} from 'react';
import {api,json,errorText} from './api';
import {Button,StatusMessage} from './ui';
import {Icon} from './Icon';
type Report={total_bytes:number;categories:Record<string,{bytes:number;files:number}>;cleanup:{files:number;bytes:number;rollback_files:number;rollback_days:number|null;token:string;protected_note:string}};
const labels:Record<string,string>={database:'媒体库数据库',thumbnails:'视频缩略图',covers:'手动封面',subtitles:'临时字幕',hls:'临时播放缓存','native-cache':'无损播放副本（可在视频菜单清理）',backups:'备份与恢复暂存',other:'日志及其他数据'};
function size(value:number){return value>=1073741824?`${(value/1073741824).toFixed(2)} GB`:value>=1048576?`${(value/1048576).toFixed(1)} MB`:`${(value/1024).toFixed(1)} KB`;}
export function StorageTools({busy,changeBusy,scanning,enabled}:{busy:boolean;changeBusy:(value:boolean)=>void;scanning:boolean;enabled:boolean}){
  const [report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[olderBackups,setOlderBackups]=useState(false);
  const controller=useRef<AbortController|null>(null);
  async function preview(older=olderBackups){
    controller.current?.abort();const next=new AbortController();controller.current=next;setLoading(true);setError('');setReport(null);
    try{const value=await api<Report>(`/api/storage${older?'?rollback_days=30':''}`,{signal:next.signal,timeoutMs:30000});if(!next.signal.aborted)setReport(value);}
    catch(e){if(!next.signal.aborted)setError(errorText(e));}finally{if(!next.signal.aborted)setLoading(false);}
  }
  useEffect(()=>{if(enabled)void preview();return()=>controller.current?.abort();},[enabled]);
  async function clean(){
    if(!report||busy)return;
    const plan=report.cleanup;
    if(!window.confirm(`永久清理 ${plan.files} 个应用文件，约 ${size(plan.bytes)}。原视频及手动封面不变。继续吗？`))return;
    if(plan.rollback_files>0&&!window.confirm(`其中包含 ${plan.rollback_files} 个旧恢复前数据库，删除后不可恢复。建议先下载完整备份。确认删除这些副本吗？`))return;
    changeBusy(true);setError('');setNotice('');
    try{
      const result=await api<{removed:number;freed_bytes:number;skipped:number}>('/api/storage/cleanup',json('POST',{token:plan.token,rollback_days:plan.rollback_days}));
      setNotice(`已清理 ${result.removed} 个文件，约 ${size(result.freed_bytes)}${result.skipped?`；${result.skipped} 个占用或已变化的文件已跳过`:''}。派生缓存不可撤销，但可重新生成。`);
      await preview();
    }catch(e){setError(errorText(e));}finally{changeBusy(false);}
  }
  return <section className="storage-tools settings-section" aria-label="应用存储">
    <h3><Icon name="database"/>应用存储</h3><p className="dialog-description">仅统计应用数据，不扫描原视频。先预览，再确认清理。</p>
    {report&&<><dl className="storage-sizes">{Object.entries(report.categories).map(([key,item])=><div key={key}><dt>{labels[key]}</dt><dd>{size(item.bytes)}<small>{item.files} 个文件</small></dd></div>)}</dl><p className="storage-total">合计 {size(report.total_bytes)}</p></>}
    <label className="backup-options"><input type="checkbox" aria-label="包含旧回滚副本" checked={olderBackups} disabled={busy||loading} onChange={e=>{setOlderBackups(e.target.checked);void preview(e.target.checked);}}/>额外清理超过 30 天的回滚数据库（至少保留最近 3 份）</label>
    <div className="storage-actions"><Button icon="refresh" busy={loading} disabled={busy} onClick={()=>void preview()}>刷新清理预览</Button><Button icon="trash" variant="danger" disabled={busy||loading||scanning||!report?.cleanup.files} onClick={()=>void clean()}>清理已预览内容</Button></div>
    {report&&<p className="storage-preview" role="status">可清理 {report.cleanup.files} 个文件 · {size(report.cleanup.bytes)}{report.cleanup.rollback_files>0&&` · 含 ${report.cleanup.rollback_files} 个旧回滚副本`}<small>{report.cleanup.protected_note}</small></p>}
    {loading&&<StatusMessage kind="loading">正在统计应用存储…</StatusMessage>}{error&&<StatusMessage kind="error">{error}</StatusMessage>}{notice&&<StatusMessage>{notice}</StatusMessage>}
  </section>;
}
