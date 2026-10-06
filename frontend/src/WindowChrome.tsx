import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { connectWindowMode, setWindowMode, useWindowMode } from './windowMode';
import './window-mode.css';
import {requestAbout} from './AppTools';

export function WindowChrome() {
  const state=useWindowMode();
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!window.avhubDesktop)return;
    document.documentElement.classList.add('desktop-shell');
    const stop=connectWindowMode();
    return()=>{stop();document.documentElement.classList.remove('desktop-shell');};
  },[]);
  if(!window.avhubDesktop)return null;
  async function action(value:'minimize'|'maximize'|'close') {
    try {await window.avhubDesktop!.windowAction(value);setError('');}
    catch {setError('窗口操作失败，请重试；Alt+F4 可关闭窗口。');}
  }
  async function togglePinned() {
    if(state.busy)return;
    try {await setWindowMode({alwaysOnTop:!state.alwaysOnTop});setError('');}
    catch {setError('无法切换窗口置顶，请重试。');}
  }
  return <div className="desktop-titlebar" role="toolbar" aria-label="窗口控制">
    <button className="window-about" aria-label="关于 AVHub" title="关于 AVHub" onClick={()=>{
      if(document.querySelector('.modal-backdrop')){setError('请先关闭当前对话框');return;}setError('');requestAbout();
    }}><Icon name="play" size={12}/><span>AVHub{state.purePlayback?' · 纯净播放':''}</span><Icon name="info" size={13}/></button>
    <div className="window-drag-area" title="拖动窗口 · 双击最大化或还原"/>
    {error && <small role="alert">{error}</small>}
    <button className="window-pin" title={state.alwaysOnTop?'取消窗口置顶':'窗口置顶'} aria-label={state.alwaysOnTop?'取消窗口置顶':'窗口置顶'}
      aria-pressed={state.alwaysOnTop} disabled={state.busy} onClick={()=>void togglePinned()}><Icon name="pin" size={16} filled={state.alwaysOnTop}/></button>
    <button title="最小化窗口" aria-label="最小化窗口" onClick={()=>void action('minimize')}><Icon name="minimize" size={15}/></button>
    <button title={state.maximized?'还原窗口':'最大化窗口'} aria-label={state.maximized?'还原窗口':'最大化窗口'} onClick={()=>void action('maximize')}><Icon name={state.maximized?'windowRestore':'windowMaximize'} size={14}/></button>
    <button className="window-close" title="关闭窗口" aria-label="关闭窗口" onClick={()=>void action('close')}><Icon name="close" size={17}/></button>
  </div>;
}
