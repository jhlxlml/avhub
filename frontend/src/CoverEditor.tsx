import { useEffect, useRef, useState } from 'react';
import { api, json, errorText, type Media, type MediaUpdate } from './api';
import { Button, StatusMessage } from './ui';
import { MediaThumbnail } from './MediaThumbnail';
import './library-tools.css';
import { type ThumbnailItemStatus } from './ThumbnailTasks';

export function CoverEditor({media,update,onBusyChange}:{media:Media;update:(value:MediaUpdate)=>void;onBusyChange?:(busy:boolean)=>void}) {
  const input=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  const [capture,setCapture]=useState(''),[status,setStatus]=useState<ThumbnailItemStatus|null>(null);
  const latestUpdate=useRef(update);latestUpdate.current=update;
  useEffect(()=>{
    let stopped=false,timer:number,first=true,wasPending=false;
    const controller=new AbortController();
    async function poll(){
      try {
        const result=await api<ThumbnailItemStatus>(`/api/media/${media.id}/thumbnail`,{signal:controller.signal});
        if(stopped)return;setStatus(result);
        if(first){if(result.frame_time!==null)setCapture(String(result.frame_time));first=false;}
        if(wasPending&&result.state==='idle')latestUpdate.current({id:media.id,thumbnail_url:result.thumbnail_url??undefined});
        wasPending=result.state==='pending';
      }catch { /* Action errors are displayed separately. Polling must not reset a metadata draft. */ }
      if(!stopped)timer=window.setTimeout(poll,2000);
    }
    setCapture('');setStatus(null);void poll();
    return()=>{stopped=true;clearTimeout(timer);controller.abort();};
  },[media.id]);
  async function retry(){
    const point=capture.trim()===''?null:Number(capture);
    if(point!==null&&(!Number.isFinite(point)||point<0||(media.duration>0&&point>=media.duration))){setError('请输入小于视频时长的非负秒数');return;}
    setBusy(true);setError('');
    try {setStatus(await api<ThumbnailItemStatus>(`/api/media/${media.id}/thumbnail/retry`,json('POST',{frame_time:point})));}
    catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  async function change(file?:File) {
    if(file && (!['image/jpeg','image/png'].includes(file.type) || file.size>8*1024*1024)) {setError('请选择不超过 8 MB 的 JPEG/PNG 图片');return;}
    setBusy(true);setError('');
    try {update(await api<Media>(`/api/media/${media.id}/cover`,{method:file?'PUT':'DELETE',body:file,timeoutMs:35000}));}
    catch(e){setError(errorText(e));}finally{setBusy(false);if(input.current)input.current.value='';}
  }
  return <div className="cover-editor" aria-label="离线封面">
    <span className="cover-editor-preview"><MediaThumbnail key={media.custom_cover||'default'} url={media.thumbnail_url}/></span>
    <div><div className="cover-editor-tools"><Button icon="upload" busy={busy} onClick={()=>input.current?.click()}>选择本地封面</Button>
      {media.custom_cover&&<Button disabled={busy} icon="refresh" onClick={()=>void change()}>恢复视频截图</Button>}</div>
      <small>JPEG / PNG · 最大 8 MB · 仅保存到应用缓存</small>
      <div className="cover-capture"><div className="cover-capture-tools"><label>截图时间（秒） <input type="number" aria-label="封面截图时间" min="0" step="0.1" value={capture} placeholder="自动选择" disabled={busy} onChange={event=>setCapture(event.target.value)}/></label>
        <Button icon="camera" busy={busy} disabled={Boolean(media.missing)} title={media.missing?'源文件离线，恢复连接后可生成截图':undefined} onClick={()=>void retry()}>重新生成截图</Button></div>
        {status?.state==='pending'&&<small role="status">已排队生成，暂停的任务可在顶栏“封面任务”中恢复。</small>}
        {status?.state==='failed'&&<details><summary>查看截图失败原因（不影响尝试播放）</summary><pre>{status.last_error||'旧任务没有保存详细原因，请重新生成截图采集诊断。'}</pre></details>}
        {media.custom_cover&&<small>重新截图不会覆盖手动封面；点击“恢复视频截图”可切换。</small>}</div>
      <input hidden ref={input} type="file" aria-label="导入封面图片" accept="image/jpeg,image/png" disabled={busy} onChange={event=>{const file=event.target.files?.[0];if(file)void change(file);}}/>
      {error&&<StatusMessage kind="error">{error}</StatusMessage>}</div>
  </div>;
}
