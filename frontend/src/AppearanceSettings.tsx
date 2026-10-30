import {useEffect,useId,useRef,useState,type CSSProperties} from 'react';
import {cancelAppearancePreview,defaultAppearance,previewAppearance,savedAppearance,saveAppearance,useResolvedTheme,type Appearance} from './appearance';
import {themePresets,themeColors,validHex} from './themePalette';
import {Button,StatusMessage} from './ui';
import {Icon} from './Icon';
import {errorText} from './api';

const signature=({coverSize:_,...theme}:Appearance)=>JSON.stringify(theme);
const inputAccent=(value:Appearance)=>value.palette==='custom'?value.accent:(themePresets.find(p=>p.id===value.palette)??themePresets[0]).light;
export function AppearanceSettings({busy,changeBusy,onDirtyChange}:{busy:boolean;changeBusy:(value:boolean)=>void;onDirtyChange:(value:boolean)=>void}){
 const [baseline,setBaseline]=useState(savedAppearance),[draft,setDraft]=useState(savedAppearance);
 const [hex,setHex]=useState(()=>inputAccent(savedAppearance())),[message,setMessage]=useState(''),[failed,setFailed]=useState(false),[saving,setSaving]=useState(false);
 const owner=useRef(Symbol('appearance-preview')),pending=useRef(false),alive=useRef(true),id=useId(),mode=useResolvedTheme();
 const invalid=!validHex(hex),dirty=signature(draft)!==signature(baseline)||invalid;
 const colors=themeColors(draft,mode),preset=themePresets.find(p=>p.id===draft.palette);
 useEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;cancelAppearancePreview(owner.current);};},[]);
 function edit(change:Partial<Appearance>){
  const next={...draft,...change};setDraft(next);setMessage('');previewAppearance(owner.current,next);
  if(change.palette&&change.palette!=='custom')setHex(inputAccent(next));
 }
 function changeHex(value:string){setHex(value);setMessage('');if(validHex(value))edit({palette:'custom',accent:value.toLowerCase()});}
 function cancel(){const value=savedAppearance();cancelAppearancePreview(owner.current);setBaseline(value);setDraft(value);setHex(inputAccent(value));setMessage('');onDirtyChange(false);}
 async function save(){
  if(invalid||pending.current||busy)return;pending.current=true;setSaving(true);changeBusy(true);setMessage('');
  try{const next=await saveAppearance(draft,owner.current);if(alive.current){setBaseline(next);setDraft(next);setFailed(false);setMessage('外观已保存');onDirtyChange(false);}}
  catch(e){if(alive.current){setFailed(true);setMessage(`保存失败：${errorText(e)}`);}}
  finally{pending.current=false;if(alive.current){setSaving(false);changeBusy(false);}}
 }
 useEffect(()=>{if(!message||failed)return;const timer=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(timer);},[message,failed]);
 return <section className="settings-section appearance-settings" aria-label="外观与主题">
  <div className="appearance-heading"><div><h3><Icon name="palette"/>外观与主题</h3><p className="dialog-description">选择适合你的配色。调整时即时预览，保存后在下次启动时继续使用。</p></div><span className="appearance-preview-badge">{dirty?'正在预览':'当前外观'}</span></div>
  <div className="appearance-layout"><fieldset className="appearance-fields" disabled={busy}>
   <div className="appearance-field"><span id={`${id}-mode`}>明暗模式</span><div className="appearance-mode" role="group" aria-labelledby={`${id}-mode`}>
    {([{id:'light',label:'浅色',icon:'sun'},{id:'dark',label:'深色',icon:'moon'},{id:'system',label:'跟随系统',icon:'resolution'}] as const).map(item=><Button key={item.id} icon={item.icon} aria-pressed={draft.theme===item.id} onClick={()=>edit({theme:item.id})}>{item.label}</Button>)}
   </div></div>
   <div className="appearance-field"><span id={`${id}-presets`}>预设主题</span><div className="appearance-presets" role="radiogroup" aria-labelledby={`${id}-presets`}>
    {themePresets.map(item=><label key={item.id} className="appearance-preset" data-selected={draft.palette===item.id} style={{'--preset-color':item[mode]} as CSSProperties}>
     <input type="radio" name={`${id}-preset`} value={item.id} checked={draft.palette===item.id} aria-label={`${item.label}主题`} onChange={()=>edit({palette:item.id})}/>
     <span className="appearance-preset-art" aria-hidden="true"><i/><b/><b/><b/></span><span>{item.label}{draft.palette===item.id&&<Icon name="check" size={13}/>}</span>
    </label>)}
   </div></div>
   <div className="appearance-field"><label htmlFor={`${id}-hex`}>自定义主题色{draft.palette==='custom'&&<small>已启用</small>}</label>
    <div className="appearance-color"><input type="color" aria-label="选择自定义主题色" value={validHex(hex)?hex:draft.accent} onChange={event=>changeHex(event.target.value)}/><input id={`${id}-hex`} type="text" aria-label="主题色 HEX" value={hex} maxLength={7} spellCheck={false} aria-invalid={invalid||undefined} aria-describedby={`${id}-color-help`} onChange={event=>changeHex(event.target.value)}/><span className="appearance-color-dot" style={{background:colors['--ui-accent']}} title="当前模式适配后的主题色"/></div>
    <small id={`${id}-color-help`} className={invalid?'appearance-field-error':''}>{invalid?'请输入完整的 #RRGGBB 颜色，例如 #4F46C7。':'极浅或极深的颜色会自动微调，保证文字清晰。'}</small>
   </div>
   <div className="appearance-options"><label>背景风格<select aria-label="背景风格" value={draft.background} onChange={event=>edit({background:event.target.value as Appearance['background']})}><option value="neutral">中性灰</option><option value="cool">冷灰</option><option value="warm">暖灰</option></select></label>
    <label>强调程度<select aria-label="强调程度" value={draft.emphasis} onChange={event=>edit({emphasis:event.target.value as Appearance['emphasis']})}><option value="soft">柔和</option><option value="standard">标准</option></select></label></div>
  </fieldset>
  <aside className="appearance-preview" aria-label="主题效果预览" style={colors as CSSProperties}>
   <div className="appearance-preview-title"><span className="appearance-preview-logo"><Icon name="play" size={12}/></span><b>AVHub</b><span className="appearance-preview-tag">{mode==='light'?'浅色':'深色'}</span></div>
   <div className="appearance-preview-nav"><span><Icon name="library" size={12}/>全部视频</span><span>电影</span><span>收藏</span></div>
   <div className="appearance-preview-grid" aria-hidden="true">{[1,2,3,4].map(n=><div key={n}><div className="appearance-preview-cover"><Icon name={n%2?'film':'play'} size={18}/></div><i/><small>{n%2?'4K':'FHD'} · MP4</small></div>)}</div>
   <div className="appearance-preview-footer"><span>{preset?.label||'自定义'} · {draft.background==='warm'?'暖灰':draft.background==='cool'?'冷灰':'中性灰'}</span><i/></div>
   <small>配色预览不读取视频，也不改变播放画面。</small>
  </aside></div>
  <div className="appearance-actions"><Button variant="primary" icon="check" busy={saving} disabled={busy||!dirty||invalid} onClick={()=>void save()}>保存外观</Button><Button disabled={busy||!dirty} onClick={cancel}>取消修改</Button><Button icon="refresh" disabled={busy} onClick={()=>{const next={...defaultAppearance,coverSize:draft.coverSize};setHex(inputAccent(next));edit(next);}}>恢复默认</Button></div>
  {message&&<StatusMessage kind={failed?'error':'success'}>{message}</StatusMessage>}
 </section>;
}
