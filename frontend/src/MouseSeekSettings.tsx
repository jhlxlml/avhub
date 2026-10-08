import {useEffect,useState} from 'react';
import {api,json,errorText} from './api';
import {rememberSavedPreference} from './preferences';
import {readMouseSeekSeconds} from './mouseSeek';
import {Icon} from './Icon';
import {Button,StatusMessage} from './ui';
export function MouseSeekSettings({busy,changeBusy,onDirtyChange}:{busy:boolean;changeBusy:(value:boolean)=>void;onDirtyChange:(dirty:boolean)=>void}) {
  const [saved,setSaved]=useState(readMouseSeekSeconds),[value,setValue]=useState(()=>String(readMouseSeekSeconds()));
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  const seconds=Number(value),valid=/^\d+$/.test(value)&&Number.isInteger(seconds)&&seconds>=1&&seconds<=120;
  const dirty=valid?seconds!==saved:value!==String(saved);
  useEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
  async function save() {
    if(busy||saving||!valid)return;
    setSaving(true);changeBusy(true);setError('');setDone(false);
    try {
      await api('/api/preferences',json('PATCH',{values:{mouseSeekSeconds:seconds}}));
      const result=await api<{values:{mouseSeekSeconds?:number}}>('/api/preferences');
      if(result.values.mouseSeekSeconds!==seconds)throw new Error('鼠标跳播时长未保存，请重试');
      rememberSavedPreference('mouseSeekSeconds',seconds);setSaved(seconds);setDone(true);
    } catch(e){setError(errorText(e));}finally{setSaving(false);changeBusy(false);}
  }
  return <section className="settings-section app-tools" aria-label="鼠标侧键设置">
    <h3><Icon name="mouse"/>鼠标侧键跳播</h3>
    <label className="app-select-field">每次前进 / 后退（秒）<input aria-label="鼠标侧键跳播时长" type="number" min="1" max="120" step="1" value={value} disabled={busy||saving}
      onChange={e=>{setValue(e.target.value);setDone(false);setError('');}}/></label>
    <small>鼠标前进键快进、后退键快退，默认 5 秒。可设置 1–120 秒，仅影响鼠标侧键，不改变键盘和控制栏的跳播时长。设置、输入框和播放器菜单操作时不触发。</small>
    <div className="app-tool-actions"><Button icon="save" busy={saving} disabled={busy||!valid||seconds===saved&&!error} onClick={()=>void save()}>保存鼠标快捷键</Button></div>
    {dirty&&<StatusMessage>鼠标侧键时长尚未保存，切换设置分类会保留草稿。</StatusMessage>}
    {!valid&&<StatusMessage kind="error">请输入 1–120 之间的整数秒数</StatusMessage>}
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}{done&&<StatusMessage kind="success">鼠标侧键时长已保存</StatusMessage>}
  </section>;
}
