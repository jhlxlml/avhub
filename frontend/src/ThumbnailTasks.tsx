import { useEffect, useRef, useState } from 'react';
import { api, json, errorText } from './api';
import { Icon } from './Icon';
import { Button, Dialog, StatusMessage } from './ui';
import './thumbnail-tasks.css';

export type ThumbnailStatus={pending:number;failed:number;blocked:number;paused:boolean;yielding?:boolean;current:number|null;published:number;error:string};
export type ThumbnailItemStatus={state:string;last_error:string;frame_time:number|null;attempted_at:number;thumbnail_url?:string|null};
type Failure={media_id:number;title:string;last_error:string;frame_time:number|null};
type FailurePage={items:Failure[];total:number;page:number;pages:number};

export function useThumbnails(refresh:()=>void,ids:string) {
  const [status,setStatus]=useState<ThumbnailStatus|null>(null);
  const latest=useRef(refresh);latest.current=refresh;
  useEffect(()=>{
    let stopped=false,timer:number;let published:number|undefined,lastRefresh=0;
    const controller=new AbortController();
    async function poll(){
      let pending=false;
      try {
        const result=await api<ThumbnailStatus>('/api/thumbnails',{signal:controller.signal});
        if(stopped)return;
        setStatus(current=>current&&JSON.stringify(current)===JSON.stringify(result)?current:result);pending=result.pending>0&&!result.paused&&!result.yielding;
        if(published===undefined)published=result.published;
        else if(published!==result.published&&Date.now()-lastRefresh>=3000){published=result.published;lastRefresh=Date.now();latest.current();}
      } catch { /* Keep the last known state; do not interrupt playback on a poll error. */ }
      if(!stopped)timer=window.setTimeout(poll,pending?1500:5000);
    }
    void poll();return()=>{stopped=true;clearTimeout(timer);controller.abort();};
  },[]);
  useEffect(()=>{
    if(!ids)return;
    const controller=new AbortController();
    const timer=window.setTimeout(()=>void api('/api/thumbnails/priority',{...json('POST',{ids:ids.split(',').map(Number).slice(0,120)}),signal:controller.signal}).catch(()=>{}),250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[ids]);
  return {status,changed:setStatus};
}

export function ThumbnailTasks({status,changed}:{status:ThumbnailStatus|null;changed:(value:ThumbnailStatus)=>void}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[failures,setFailures]=useState<FailurePage|null>(null);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    void api<FailurePage>(`/api/thumbnails/failed?page=${page}`,{signal:controller.signal}).then(result=>{
      if(!controller.signal.aborted)setFailures(result);
    }).catch(e=>{if(!controller.signal.aborted)setError(errorText(e));});
    return()=>controller.abort();
  },[open,page,revision,status?.failed]);
  async function action(id?:number){
    setBusy(true);setError('');
    try {
      if(id)await api(`/api/media/${id}/thumbnail/retry`,json('POST',{frame_time:null}));
      else changed(await api<ThumbnailStatus>(`/api/thumbnails/${status?.paused?'resume':'pause'}`,{method:'POST'}));
      if(id){changed(await api<ThumbnailStatus>('/api/thumbnails'));setRevision(x=>x+1);}
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  const label=status?.paused?'封面任务已暂停':status?.error?'封面任务异常':status?.pending?`后台封面 · 待处理 ${status.pending} 张`:status?.failed?`${status.failed} 张封面待检查`:'封面任务';
  return <><button className={`ui-icon-button thumbnail-task-icon${status?.failed||status?.error?' needs-attention':''}`} title={label} aria-label="封面任务" onClick={()=>setOpen(true)}>
    <Icon name={status?.paused?'pause':status?.current?'refresh':'camera'} className={status?.current?'is-spinning':''}/>{(status?.pending||status?.failed||status?.error)?<i aria-hidden="true"/>:null}
  </button>{open&&<Dialog label="后台封面任务" closeLabel="关闭封面任务" busy={busy} close={()=>setOpen(false)} className="modal thumbnail-task-dialog">
    <h2 className="dialog-title"><Icon name="camera" size={22}/>后台封面任务</h2>
    <p className="dialog-description">不占用扫描状态，关闭此面板后仍会运行。暂停不会丢失任务，优先处理当前页视频。</p>
    <div className="thumbnail-task-summary"><span>待处理 {status?.pending??0}</span><span>失败 {status?.failed??0}</span><span>{status?.paused?'已暂停':status?.current?'正在生成':'等待任务'}</span></div>
    {Boolean(status?.blocked)&&<small>{status?.blocked} 张正在等待目录恢复连接</small>}
    <Button icon={status?.paused?'play':'pause'} busy={busy} onClick={()=>void action()}>{status?.paused?'恢复封面任务':'暂停封面任务'}</Button>
    {(error||status?.error)&&<StatusMessage kind="error">{error||status?.error}</StatusMessage>}
    <p className="dialog-description">截图失败不代表视频无法播放。可单独重试；指定截图时间或导入封面请进入视频的“编辑媒体信息”。</p>
    <div className="thumbnail-failures">{failures?.items.map(item=><div key={item.media_id}><strong title={item.title}>{item.title}</strong>
      <details><summary>查看截图失败原因</summary><pre>{item.last_error||'旧任务没有保存详细原因，请重试采集诊断'}</pre></details>
      <Button icon="refresh" disabled={busy} onClick={()=>void action(item.media_id)}>重试此封面</Button></div>)}</div>
    {failures&&failures.pages>1&&<div className="thumbnail-task-summary"><Button disabled={busy||failures.page<=1} onClick={()=>setPage(failures.page-1)}>上一页</Button><span>{failures.page} / {failures.pages}</span><Button disabled={busy||failures.page>=failures.pages} onClick={()=>setPage(failures.page+1)}>下一页</Button></div>}
  </Dialog>}</>;
}
