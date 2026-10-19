import {useEffect,useState} from 'react';
import {api,json,errorText} from './api';
import {preference,rememberSavedPreference} from './preferences';
import {Icon} from './Icon';
import {StatusMessage} from './ui';

export function NativePlayerSettings({busy,changeBusy}:{busy:boolean;changeBusy:(value:boolean)=>void}){
  const [engine,setEngine]=useState(()=>preference('playerEngine','chromium'));
  const [windowMode,setWindowMode]=useState(()=>preference('mpvWindowMode','embedded'));
  const [available,setAvailable]=useState<boolean|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;const native=window.avhubDesktop?.nativePlayer;
    if(!native){setAvailable(false);return;}
    void native('status').then(value=>{if(active)setAvailable(value.available);}).catch(()=>{if(active)setAvailable(false);});return()=>{active=false;};},[]);
  async function change(value:string){
    changeBusy(true);setError('');
    try{await api('/api/preferences',json('PATCH',{values:{playerEngine:value}}));rememberSavedPreference('playerEngine',value);setEngine(value);}
    catch(e){setError(errorText(e));}finally{changeBusy(false);}
  }
  async function changeWindow(value:string){
    changeBusy(true);setError('');
    try{await api('/api/preferences',json('PATCH',{values:{mpvWindowMode:value}}));rememberSavedPreference('mpvWindowMode',value);setWindowMode(value);}
    catch(e){setError(errorText(e));}finally{changeBusy(false);}
  }
  return <section className="settings-section autoplay-settings" aria-label="播放引擎设置">
    <h3><Icon name="play"/>播放引擎</h3>
    <label>默认播放引擎 <select aria-label="默认播放引擎" value={engine} disabled={busy} onChange={e=>void change(e.target.value)}>
      <option value="chromium">现有播放器（默认）</option><option value="mpv" disabled={available!==true}>MPV 原生播放器 · 试用</option>
    </select></label>
    {engine==='mpv'&&<label>MPV 播放窗口 <select aria-label="MPV 播放窗口" value={windowMode} disabled={busy} onChange={e=>void changeWindow(e.target.value)}>
      <option value="embedded">应用内嵌（默认）</option><option value="independent">独立窗口 · 试用</option>
    </select></label>}
    <small>MPV 直接解码原文件，不创建封装副本、不转码。窗口模式仅影响之后打开的视频，不在播放中自动切换。</small>
    <small>独立窗口使用与 AVHub 统一风格的原生控制栏，无 Electron 画面叠层；顶部可拖动，右上角提供置顶和窗口按钮。AVHub 仍保存进度、管理连播和截图。空格暂停，← / → 快退快进 5 秒，C 截图，F 全屏，PageUp / PageDown 切换视频。滚轮调整音量，不沿用内嵌画面缩放。</small>
    <small>内嵌模式保留 AVHub 控制栏、纯净播放与画面调整。HDR / 高于 8-bit 的原生显示尚未验收，暂使用现有原画链路，不自动映射为 SDR 或降低位深。</small>
    <small>原生画面叠层、多显示器与混合 DPI 仍需本机试用验收。如有显示异常，可明确切回现有播放器。</small>
    {available===false&&<StatusMessage kind="info">MPV 运行库未准备，现有播放不受影响。开发环境执行 scripts/prepare-mpv.ps1 后重新检测设置。</StatusMessage>}
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
  </section>;
}
