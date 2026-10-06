import {useState} from 'react';
import {Icon} from './Icon';
import {StatusMessage} from './ui';
import {errorText} from './api';
import {changeNativePreparation,useNativePreparation} from './nativePreparation';

export function NativePrepareSettings({busy,changeBusy}:{busy:boolean;changeBusy:(value:boolean)=>void}) {
  const enabled=useNativePreparation();const [error,setError]=useState('');
  async function toggle(value:boolean) {
    if(busy)return;changeBusy(true);setError('');
    try{await changeNativePreparation(value);}catch(e){setError(errorText(e));}finally{changeBusy(false);}
  }
  return <section className="settings-section autoplay-settings" aria-label="MKV 无损播放准备设置">
    <h3><Icon name="quality"/>MKV 无损播放准备</h3>
    <label className="autoplay-toggle"><input type="checkbox" aria-label="MKV 无损播放准备" checked={enabled} disabled={busy} onChange={event=>void toggle(event.target.checked)}/><span>启用无损优化副本（默认关闭）</span></label>
    <small>仅对部分索引寻址慢的视频有效，不保证提升。开启后可在视频“更多操作”中手动准备；不自动复制媒体库，不转码或降低画质，额外空间可能接近原文件大小。</small>
    <small>关闭后停止未完成任务、不使用已有副本，原文件直放和按需无损封装不变。已完成副本保留，重新开启后可在视频菜单中清理；设置自动保存。</small>
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
  </section>;
}
