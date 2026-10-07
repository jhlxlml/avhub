import { useEffect,useState,useRef } from 'react';
import { api,json,errorText } from './api';
import { rememberSavedPreference } from './preferences';
import { Icon } from './Icon';
import { Button,StatusMessage } from './ui';
import { revealScreenshot,type ScreenshotSettings as Settings } from './screenshots';
import {requireDesktop} from './nativeDesktop';
import './screenshots.css';

export function ScreenshotSettings({busy,changeBusy,enabled,onDirtyChange}:{busy:boolean;changeBusy:(value:boolean)=>void;enabled:boolean;onDirtyChange?:(dirty:boolean)=>void}) {
  const [settings,setSettings]=useState<Settings|null>(null);
  const [directory,setDirectory]=useState('');
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const [failed,setFailed]=useState(false);
  const loaded=useRef(false);
  const dirty=Boolean(settings&&directory!==settings.directory);
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  useEffect(()=>{
    if(!enabled||loaded.current)return;
    let active=true;setLoading(true);
    void api<Settings>('/api/screenshots/settings').then(value=>{
      if(!active)return;loaded.current=true;setSettings(value);setDirectory(value.directory);setNotice('');
    }).catch(error=>{if(active){setFailed(true);setNotice(errorText(error));}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[enabled]);
  async function action(task:()=>Promise<void>) {
    if(busy||loading)return;
    changeBusy(true);setNotice('');setFailed(false);
    try {await task();}catch(error){setFailed(true);setNotice(errorText(error));}finally{changeBusy(false);}
  }
  const locked=busy||loading||!settings;
  return <section className="settings-section screenshot-settings" aria-label="视频截图设置">
    <h3><Icon name="camera"/>视频截图</h3>
    <p className="screenshot-description">一键保存 PNG，不弹保存窗口，不中断播放。保留当前解码画面的分辨率，不含控件、文字字幕与画面缩放。</p>
    <label htmlFor="screenshot-directory">默认保存目录</label>
    <div className="screenshot-directory-field"><input id="screenshot-directory" disabled={locked} value={directory} placeholder="留空使用应用数据目录" onChange={event=>setDirectory(event.target.value)}/>
      <Button icon="folder" disabled={locked} onClick={()=>void action(async()=>{
        const selected=await requireDesktop('chooseFolder').chooseFolder('screenshots');
        if('path' in selected)setDirectory(selected.path);
      })}>浏览</Button></div>
    <small className="screenshot-path" title={settings?.effective_directory}>当前保存到：{settings?.effective_directory??'正在读取…'}</small>
    {settings&&!settings.available&&<StatusMessage kind="error">{settings.warning}</StatusMessage>}
    <div className="screenshot-options" aria-label="截图快捷键"><span>截图快捷键</span><kbd>C</kbd><small>输入文字、菜单或设置中不触发。</small></div>
    {dirty&&<StatusMessage>截图目录尚未保存，切换设置分类会保留草稿。</StatusMessage>}
    <div className="screenshot-setting-actions"><Button icon="check" disabled={locked} onClick={()=>void action(async()=>{
      const saved=await api<Settings>('/api/screenshots/settings',json('PUT',{directory:directory.trim(),shortcut:'C'}));
      rememberSavedPreference('screenshots',{directory:saved.directory,shortcut:saved.shortcut});setSettings(saved);setDirectory(saved.directory);setNotice('截图设置已保存');
    })}>保存截图设置</Button>
      <Button disabled={locked} onClick={()=>setDirectory('')}>使用默认目录</Button>
      {dirty&&<Button disabled={locked} onClick={()=>{setDirectory(settings!.directory);setNotice('已放弃截图目录修改');setFailed(false);}}>放弃修改</Button>}
      <Button icon="reveal" disabled={locked} onClick={()=>void action(async()=>{
        await revealScreenshot();
      })}>打开截图目录</Button></div>
    <small>文件名包含视频标题、播放时间与截图时间，连续截图不会覆盖。自定义目录须已存在；默认目录在首次保存时创建。</small>
    {notice&&<StatusMessage kind={failed?'error':notice==='截图设置已保存'?'success':'info'}>{notice}</StatusMessage>}
    {!settings&&!loading&&<Button disabled={busy} icon="refresh" onClick={()=>void action(async()=>{
      const value=await api<Settings>('/api/screenshots/settings');setSettings(value);setDirectory(value.directory);
    })}>重新读取截图设置</Button>}
  </section>;
}
