import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Button,StatusMessage} from './ui';
import {errorText} from './api';

export function PlaybackDiagnosticsExport(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [saved,setSaved]=useState<{id:string;path:string}|null>(null);
 const alive=useRef(true),pending=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(pending.current)void window.avhubDesktop?.cancelExport().catch(()=>{});};},[]);
 useEffect(()=>{if(!message||busy)return;const t=setTimeout(()=>setMessage(''),6000);return()=>clearTimeout(t);},[message,busy]);
 async function capture(){
  if(pending.current||!window.avhubDesktop)return;
  pending.current=true;setBusy(true);setError('');setMessage('');setSaved(null);
  document.querySelector('.video-wrap')?.scrollIntoView({block:'center',behavior:'instant'});
  try{
   const result=await window.avhubDesktop.saveExport({kind:'playback-diagnostics'});
   if(alive.current){if('cancelled' in result)setMessage('已取消播放诊断');else{setSaved(result);setMessage('播放诊断已保存');}}
  }catch(e){if(alive.current)setError(errorText(e));}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 }
 if(!window.avhubDesktop?.saveExport)return null;
 const stage=document.querySelector('.video-wrap');
 return <><section className="playback-diagnostic-export" aria-label="播放诊断导出">
  <div className="diagnostic-actions"><Button icon="download" busy={busy} onClick={()=>void capture()}>采集并导出播放诊断（8 秒）</Button>
   {busy&&<Button onClick={()=>void window.avhubDesktop?.cancelExport()}>取消采集或保存</Button>}
   {saved&&!busy&&<Button icon="reveal" onClick={()=>void window.avhubDesktop?.revealExport(saved.id).catch(e=>setError(errorText(e)))}>查看诊断文件</Button>}</div>
  <small>{busy?'正在采集当前播放，再选择保存位置；不会切换解码器、画质或播放速度。':'手动采集实际解码器、GPU、丢帧与缓冲。请尽量连续播放 8 秒；报告不含视频标题、源路径、画面或音频设备标识，不联网。'}</small>
  {message&&<StatusMessage kind="info">{message}</StatusMessage>}
  {error&&<StatusMessage kind="error">{error}</StatusMessage>}
 </section>{busy&&stage&&createPortal(<div className="playback-capture-toast" role="status">正在采集或保存播放诊断 <button onClick={()=>void window.avhubDesktop?.cancelExport()}>取消</button></div>,stage)}</>;
}
