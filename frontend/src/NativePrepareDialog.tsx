import {useEffect,useRef,useState} from 'react';
import {api,errorText,type Media} from './api';
import {Button,Dialog,StatusMessage} from './ui';
import {Icon} from './Icon';
import {confirmAction} from './confirmAction';

type State={state:'idle'|'running'|'waiting'|'validating'|'ready'|'failed'|'cancelled';percent:number;size:number;error:string;cancellable:boolean;source_size?:number;budget?:number;in_use?:boolean};
const size=(n=0)=>n>=1073741824?`${(n/1073741824).toFixed(2)} GB`:`${(n/1048576).toFixed(1)} MB`;
export function NativePrepareDialog({media,close,play}:{media:Media;close:()=>void;play?:()=>void}) {
  const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;const controller=new AbortController();let timer:number;
    const poll=async()=>{
      try{const value=await api<State>(`/api/media/${media.id}/native-prepare`,{signal:controller.signal});if(mounted.current)setState(value);}
      catch(e){if(!controller.signal.aborted&&mounted.current)setError(errorText(e));}
      finally{if(mounted.current)timer=window.setTimeout(()=>void poll(),1000);}
    };void poll();
    return()=>{mounted.current=false;controller.abort();clearTimeout(timer);};
  },[media.id]);
  async function action(kind:'start'|'cancel'|'clear') {
    if(busy)return;
    if(kind==='clear'&&!await confirmAction('清理无损副本？',media.title,'只清理应用生成的无损副本，原视频及媒体库记录不修改。继续吗？'))return;
    setBusy(true);setError('');
    try{
      await api(`/api/media/${media.id}/native-prepare${kind==='cancel'?'/cancel':''}`,{method:kind==='clear'?'DELETE':'POST'});
      const value=await api<State>(`/api/media/${media.id}/native-prepare`);if(mounted.current)setState(value);
    }catch(e){if(mounted.current)setError(errorText(e));}finally{if(mounted.current)setBusy(false);}
  }
  const active=state&&['running','waiting','validating'].includes(state.state);
  return <Dialog label="无损播放准备" closeLabel="关闭无损准备" busy={busy} close={close}>
    <h2 className="dialog-title"><Icon name="quality" size={22}/>无损播放准备</h2><p className="dialog-description">{media.title}</p>
    <p>保留 MKV、原视频编码、分辨率、位深、色彩及全部音轨和字幕，只重建封装索引。原文件只读，不做转码或降画质。</p>
    <p className="dialog-description">预计额外占用约 {size((state?.source_size||0)*1.15+2097152)}；应用缓存上限 {size(state?.budget||8589934592)}，仅回收未使用的应用副本。不会自动准备整个媒体库。</p>
    <p className="dialog-description">准备时请暂停播放。恢复播放会让任务等待空闲后重新开始；关闭此面板不取消后台任务。默认音轨直放会使用副本，备用音轨仍按原片处理。</p>
    {active&&<div className="data-job-progress"><progress aria-label="无损准备进度" max={100} value={state.percent}/><StatusMessage kind="loading">{state.state==='waiting'?'等待播放暂停（随后重新准备）':state.state==='validating'?'正在验证原编码、色彩和轨道一致性':'正在无损复制并重建索引'} · {Math.round(state.percent)}%</StatusMessage></div>}
    {state?.state==='ready'&&<StatusMessage kind="success">已准备完成 · {size(state.size)} · 视频与音轨未重新编码</StatusMessage>}
    {state?.state==='cancelled'&&<StatusMessage>已取消准备，原文件不变。</StatusMessage>}
    {(error||state?.error)&&<StatusMessage kind="error">{error||state?.error}</StatusMessage>}
    <div className="controls">
      {state?.state==='ready'?<><Button icon="trash" disabled={busy||state.in_use} onClick={()=>void action('clear')}>清理无损副本</Button>{play&&<Button icon="play" variant="primary" disabled={busy} onClick={()=>{close();play();}}>使用原画模式播放</Button>}</>:
        <Button icon="quality" variant="primary" busy={busy} disabled={!state||Boolean(active)||Boolean(media.missing)} onClick={()=>void action('start')}>开始无损准备</Button>}
      {state?.cancellable&&<Button icon="close" disabled={busy} onClick={()=>void action('cancel')}>取消准备</Button>}
      <Button disabled={busy} onClick={close}>关闭</Button>
    </div>
  </Dialog>;
}
