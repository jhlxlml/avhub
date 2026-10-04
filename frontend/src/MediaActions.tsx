import { useEffect, useRef, useState } from 'react';
import { api, json, errorText, type Media, type MediaUpdate } from './api';
import { Icon } from './Icon';

export function MediaActions({media,update,changed,notify}: {
  media:Media;update:(value:MediaUpdate)=>void;changed?:()=>void;notify:(message:string)=>void;
}) {
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
  },[open]);
  async function act(action:'watched'|'auto'|'copy'|'reveal'|'open') {
    if(lock.current)return;
    if(action==='open' && !window.confirm('将用系统默认播放器打开原视频。AVHub 无法同步外部播放器的进度、音轨和字幕。继续？'))return;
    lock.current=true;setBusy(true);
    try {
      if(action==='watched'||action==='auto') {
        const value=await api<Media>(`/api/media/${media.id}/watched`,action==='auto'?{method:'DELETE'}:json('PUT',{watched:!media.watched}));
        update(value);changed?.();notify(action==='auto'?'已恢复自动判断观看状态':value.watched?'已标记为已看':'已标记为未看');
      } else if(action==='copy') {await navigator.clipboard.writeText(media.path);notify('视频路径已复制');}
      else {
        if(window.avhubDesktop?.mediaAction)await window.avhubDesktop.mediaAction(media.id,action);
        else await api(`/api/media/${media.id}/native/${action}`,{method:'POST'});
        notify(action==='reveal'?'已在资源管理器中定位视频':'已请求系统播放器打开原片；外部播放进度不会同步');
      }
      setOpen(false);
    } catch(e){notify(errorText(e));}
    finally {lock.current=false;setBusy(false);}
  }
  return <div className="media-actions" ref={root}>
    <button ref={trigger} className="media-more" aria-label={`更多操作 ${media.title}`} title="更多操作" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <Icon name="more"/>
    </button>
    {open && <div className="media-menu" role="menu" aria-label={`视频操作 ${media.title}`} onKeyDown={event=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();
      const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const index=items.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next]?.focus();
    }}>
      <button role="menuitem" disabled={busy} onClick={()=>void act('watched')}><Icon name={media.watched?'eyeOff':'check'} size={16}/>{media.watched?'标记为未看':'标记为已看'}</button>
      {media.manual_watched!==null && media.manual_watched!==undefined && <button role="menuitem" disabled={busy} onClick={()=>void act('auto')}><Icon name="refresh" size={16}/>恢复自动已看判断</button>}
      <button role="menuitem" disabled={busy} onClick={()=>void act('copy')}><Icon name="copy" size={16}/>复制视频路径</button>
      <button role="menuitem" disabled={busy||Boolean(media.missing)} onClick={()=>void act('reveal')}><Icon name="reveal" size={16}/>在资源管理器中显示</button>
      <button role="menuitem" disabled={busy||Boolean(media.missing)} onClick={()=>void act('open')}><Icon name="external" size={16}/>用系统播放器打开</button>
      <small>只修改应用记录，不改动原文件</small>
    </div>}
  </div>;
}
