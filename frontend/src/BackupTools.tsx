import {useEffect,useRef,useState} from 'react';
import {api,json,request,readJson,isHtmlResponse,SERVICE_MISMATCH,errorText} from './api';
import {flushPreferences} from './preferences';
import {Icon} from './Icon';
import {Button,StatusMessage} from './ui';
import {requireDesktop} from './nativeDesktop';
import {confirmAction} from './confirmAction';

type Preview={full:boolean;format_version:number|null;build?:{version?:string;build_id?:string};media:number;current_media:number;favorites:number;playlists:number;covers:number;thumbnails:number;root_count:number;unchecked_roots:number;roots:{path:string;available:boolean}[]};
type Job={id:string;kind:string;state:string;stage:string;done:number;total:number;cancellable:boolean;error:string;result:Preview|{ok?:boolean;filename?:string;bytes?:number}|null};
const stages:Record<string,string>={queued:'排队中',uploading:'上传备份',snapshot:'创建数据库快照',checksumming:'校验文件',packing:'打包文件',validating:'校验备份内容','database-check':'检查数据库',directories:'检查目录状态',committing:'提交恢复（不能取消）',ready:'已完成',cancelled:'已取消',failed:'任务失败'};

export function BackupTools({busy,changeBusy,scanning,reload}:{busy:boolean;changeBusy:(value:boolean)=>void;scanning:boolean;reload:()=>Promise<void>}){
  const [thumbnails,setThumbnails]=useState(false),[file,setFile]=useState<File|null>(null),[job,setJob]=useState<Job|null>(null),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const active=useRef<Job|null>(null),controller=useRef<AbortController|null>(null),mounted=useRef(true);
  const fileInput=useRef<HTMLInputElement>(null);
  const [savingExport,setSavingExport]=useState(false),[savedExport,setSavedExport]=useState<{id:string;path:string}|null>(null);
  useEffect(()=>{
    mounted.current=true;
    const quitting=(event:Event)=>{if(active.current?.stage==='committing')(event as CustomEvent<Promise<unknown>[]&{criticalDataCommit?:boolean}>).detail.criticalDataCommit=true;};
    window.addEventListener('avhub-before-quit',quitting);
    return()=>{
    window.removeEventListener('avhub-before-quit',quitting);
    mounted.current=false;controller.current?.abort();
    if(active.current&&active.current.stage!=='committing')navigator.sendBeacon(`/api/data-jobs/${active.current.id}/cancel`);
  };},[]);
  function update(value:Job){active.current=value;if(mounted.current)setJob(value);}
  async function finish(value:Job){
    update(value);
    while(value.state==='running'){
      await new Promise(resolve=>setTimeout(resolve,350));
      if(!mounted.current)throw new Error('操作已关闭');
      value=await api<Job>(`/api/data-jobs/${value.id}`);update(value);
    }
    if(value.state==='failed')throw new Error(value.error||'数据任务失败');
    if(value.state==='cancelled'){setNotice('任务已取消，原媒体库未被替换');return null;}
    return value;
  }
  async function release(){
    if(active.current&&active.current.stage!=='committing')await request(`/api/data-jobs/${active.current.id}/cancel`,{method:'POST'},async response=>{
      const value=await readJson<{detail?:string}>(response);
      // Expired private previews are already released; let another file be chosen.
      if(!response.ok&&response.status!==404)throw new Error(value.detail||'释放数据任务失败');
    });
    active.current=null;setJob(null);
  }
  async function download(full:boolean){
    if(busy)return;changeBusy(true);setError('');setNotice('');setSavedExport(null);
    try{
      await release();if(!await flushPreferences())throw new Error('设置尚未保存，请重试后再备份');
      const ready=await finish(await api<Job>('/api/data-jobs/backup',json('POST',{full,thumbnails})));
      if(!ready)return;
      const url=`/api/data-jobs/${ready.id}/download`;
      // Validate only the small immutable file prefix; let the browser download
      // large archives without loading a multi-GB Blob into the renderer.
      await request(url,{headers:{Range:'bytes=0-15'}},async response=>{
        if(isHtmlResponse(response))throw new Error(SERVICE_MISMATCH);
        if(!response.ok){const value=await readJson<{detail?:string}>(response);throw new Error(value.detail||'下载备份失败');}
        if(response.status!==206||Number(response.headers.get('content-length'))>16)throw new Error('本地服务未支持备份校验，请重启后重试');
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(full?bytes[0]!==80||bytes[1]!==75:new TextDecoder().decode(bytes)!=='SQLite format 3\0')throw new Error('备份文件格式不正确');
      });
      setSavingExport(true);
      const saved=await requireDesktop('saveExport').saveExport({kind:'backup',jobId:ready.id});
      if('cancelled' in saved)setNotice('已取消保存备份，媒体库未改变。');
      else {setSavedExport(saved);setNotice(`备份已保存 · ${(saved.bytes/1048576).toFixed(1)} MB · 不包含原视频`);}
      // Release owned staging after the native reader ends. The server refuses
      // cleanup while any reader is pinned; failed cleanup expires normally.
      void api(`/api/data-jobs/${ready.id}/cancel`,{method:'POST',timeoutMs:3000}).catch(()=>{});
      active.current=null;setJob(null);
    }catch(e){setError(errorText(e));}finally{if(mounted.current){setSavingExport(false);changeBusy(false);}}
  }
  async function inspect(){
    if(!file||busy)return;changeBusy(true);setError('');setNotice('');controller.current=new AbortController();
    try{
      await release();setJob({id:'',kind:'inspect',state:'running',stage:'uploading',done:0,total:file.size,cancellable:true,error:'',result:null});
      const value=await api<Job>('/api/data-jobs/inspect',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,signal:controller.current.signal,timeoutMs:0});
      await finish(value);
    }catch(e){setError(controller.current.signal.aborted?'已取消上传，媒体库未被替换':errorText(e));}finally{if(mounted.current)changeBusy(false);}
  }
  async function restore(){
    if(!job||job.kind!=='inspect'||job.state!=='ready'||busy)return;
    if(!await confirmAction('恢复所选备份？','将用已校验的备份替换当前媒体库记录。','原视频不受影响，提交后不可取消。继续吗？'))return;
    changeBusy(true);setError('');setNotice('');
    try{
      if(!await flushPreferences())throw new Error('设置尚未保存，请重试后再恢复');
      update({...job,kind:'restore',state:'running',stage:'committing',cancellable:false,result:null});
      const done=await finish(await api<Job>(`/api/data-jobs/${job.id}/restore`,{method:'POST'}));
      if(!done||(done.result as {ok?:boolean})?.ok!==true)throw new Error('本地服务未确认恢复成功，请查看运行诊断');
      active.current=null;await reload();window.location.reload();
    }catch(e){
      // A rejected submit has not necessarily started a commit. Reconcile with
      // the server instead of leaving a ready preview permanently close-locked.
      // If status is unavailable, keep the guard: the result is uncertain.
      if(active.current?.stage==='committing'){
        try{update(await api<Job>(`/api/data-jobs/${job.id}`));}catch{}
      }
      setError(errorText(e));
    }finally{if(mounted.current&&active.current?.stage!=='committing')changeBusy(false);}
  }
  async function recheckRestore(){
    if(active.current?.stage!=='committing')return;
    setError('');changeBusy(true);
    try{
      const done=await finish(await api<Job>(`/api/data-jobs/${active.current.id}`));
      if(!done||(done.result as {ok?:boolean})?.ok!==true)throw new Error('本地服务未确认恢复成功，请查看运行诊断');
      active.current=null;await reload();window.location.reload();
    }catch(e){setError(errorText(e));}
    finally{if(mounted.current&&active.current?.stage!=='committing')changeBusy(false);}
  }
  async function cancel(){
    setError('');
    try{
      if(savingExport){await requireDesktop('cancelExport').cancelExport();return;}
      if(!active.current){controller.current?.abort();return;}
      update(await api<Job>(`/api/data-jobs/${active.current.id}/cancel`,{method:'POST'}));
      if(job?.state!=='running'){setJob(null);active.current=null;}
    }catch(e){setError(errorText(e));}
  }
  const preview=job?.kind==='inspect'&&job.state==='ready'?job.result as Preview:null;
  return <section className="backup-tools" aria-label="媒体库备份">
    <h3><Icon name="database"/>数据备份</h3>
    <p>完整备份包含数据库与手动封面，可选缩略图。恢复前先校验和预览，确认后替换记录；原视频不变。</p>
    <label className="backup-options"><input type="checkbox" aria-label="备份包含缩略图" checked={thumbnails} disabled={busy||scanning} onChange={e=>setThumbnails(e.target.checked)}/>包含缩略图（体积更大，迁移后无需重新截图）</label>
    <Button variant="primary" icon="download" disabled={busy||scanning} onClick={()=>void download(true)}>保存完整备份</Button>
    <Button icon="download" disabled={busy||scanning} onClick={()=>void download(false)}>保存媒体库备份</Button>
    <small>数据库备份不携带图片。完整包上限 2 GB，数据库上限 512 MB；包含本地路径，请妥善保存。</small>
    <label className="backup-restore"><Icon name="upload" size={16}/>选择备份文件<input ref={fileInput} aria-label="选择备份文件" type="file" accept=".zip,.db,.sqlite,.sqlite3,application/zip,application/vnd.sqlite3" disabled={busy||scanning} onChange={e=>{void release().catch(err=>setError(errorText(err)));setFile(e.target.files?.[0]||null);setError('');setNotice('');}}/></label>
    <Button icon="shield" disabled={busy||scanning||!file} onClick={()=>void inspect()}>校验并预览备份</Button>
    {file&&<small>{file.name} · {(file.size/1048576).toFixed(1)} MB</small>}
    {job?.state==='running'&&<div className="data-job-progress" role="status"><span>{stages[job.stage]||'正在处理'}{job.total>0&&job.stage!=='uploading'?` · ${job.done} / ${job.total}`:''}</span>
      <progress aria-label="数据任务进度" {...(job.total>0&&job.stage!=='uploading'?{value:job.done,max:job.total}:{})}/>
      {job.cancellable&&<Button icon="close" onClick={()=>void cancel()}>取消数据任务</Button>}
    </div>}
    {preview&&<div className="backup-preview" role="region" aria-label="备份恢复预览">
      <h4>恢复前预览</h4><p>{preview.full?`完整备份 · 格式 ${preview.format_version}`:'旧数据库备份 · 不包含图片'} · 应用版本 {preview.build?.version||'未记录'}</p>
      <dl><dt>视频记录</dt><dd>当前 {preview.current_media} → 备份 {preview.media}</dd><dt>收藏 / 播放列表</dt><dd>{preview.favorites} / {preview.playlists}</dd><dt>手动封面 / 缩略图引用</dt><dd>{preview.covers} / {preview.thumbnails}</dd><dt>媒体目录</dt><dd>{preview.root_count} 个{preview.unchecked_roots>0&&` · ${preview.unchecked_roots} 个待后续检查`}</dd></dl>
      <ul>{preview.roots.map(root=><li key={root.path}><Icon name={root.available?'folder':'warning'} size={14}/><span title={root.path}>{root.path}</span><small>{root.available?'可访问':'离线或不可访问'}</small></li>)}</ul>
      <small>仅检查前 20 个目录；恢复后可重新定位。不会复制、移动或删除原视频。</small>
      <Button variant="primary" icon="check" disabled={busy||scanning} onClick={()=>void restore()}>恢复所选备份</Button><Button icon="close" disabled={busy} onClick={()=>void release().catch(e=>setError(errorText(e)))}>放弃恢复预览</Button>
    </div>}
    {savingExport&&<StatusMessage kind="loading">正在保存备份…<Button icon="close" onClick={()=>void cancel()}>取消保存</Button></StatusMessage>}
    {notice&&<StatusMessage kind={notice.startsWith('备份已保存')?'success':'info'}>{notice}</StatusMessage>}
    {savedExport&&<div className="export-result"><code title={savedExport.path}>{savedExport.path}</code><Button icon="reveal" onClick={()=>void requireDesktop('revealExport').revealExport(savedExport.id).catch(e=>setError(errorText(e)))}>在文件夹中显示备份</Button></div>}
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
    {error&&job?.stage==='committing'&&<Button icon="refresh" onClick={()=>void recheckRestore()}>重新检查恢复状态</Button>}
  </section>;
}
