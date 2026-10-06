import {useState} from 'react';
import {api,json,errorText} from './api';
import {rememberSavedPreference} from './preferences';
import {readResumeBehavior,type ResumeBehavior} from './resumeBehavior';
import {Icon} from './Icon';
import {StatusMessage} from './ui';
export function ResumeBehaviorSettings({busy,changeBusy}:{busy:boolean;changeBusy:(value:boolean)=>void}) {
  const [value,setValue]=useState(readResumeBehavior),[saving,setSaving]=useState(false),[error,setError]=useState('');
  async function change(next:ResumeBehavior) {
    if(busy||saving)return;setSaving(true);changeBusy(true);setError('');
    try {
      await api('/api/preferences',json('PATCH',{values:{resumeBehavior:next}}));
      const current=await api<{values:{resumeBehavior?:ResumeBehavior}}>('/api/preferences');
      const saved=current.values.resumeBehavior||'ask';rememberSavedPreference('resumeBehavior',saved);setValue(saved);
      if(saved!==next)throw new Error('起播设置未更新，请重试');
    }catch(e){setError(errorText(e));}finally{setSaving(false);changeBusy(false);}
  }
  return <section className="settings-section app-tools" aria-label="起播方式设置">
    <h3><Icon name="continue"/>起播方式</h3>
    <label className="app-select-field">再次打开未看完的视频<select aria-label="起播方式" value={value} disabled={busy||saving} onChange={event=>void change(event.target.value as ResumeBehavior)}>
      <option value="ask">每次询问（默认）</option><option value="resume">自动接上次进度</option><option value="restart">始终从头播放</option>
    </select></label>
    <small>已看完的视频从头播放。自动连播不弹询问；“始终从头”除外，其余方式续播未看完的视频。设置仅影响下次打开，不清除观看记录。</small>
    {saving&&<StatusMessage kind="loading">正在保存起播方式…</StatusMessage>}{error&&<StatusMessage kind="error">{error}</StatusMessage>}
  </section>;
}
