import { useCallback,useEffect, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import {useAnchoredMenu} from './useAnchoredMenu';
import { api, json, errorText, type Media, type MediaUpdate } from './api';
import { Icon } from './Icon';
import {NativePrepareDialog} from './NativePrepareDialog';
import {useNativePreparation} from './nativePreparation';
import {requireDesktop} from './nativeDesktop';
import {MediaEditDialog} from './MediaEditDialog';
import {FileActionDialog,type FileActionInfo} from './FileManagement';

export function MediaActions({media,update,changed,notify,pauseForPreparation,playPrepared,edit,externalInMenu=true}: {
  media:Media;update:(value:MediaUpdate)=>void;changed?:()=>void;notify:(message:string,autoDismissMs?:number)=>void;pauseForPreparation?:()=>void;playPrepared?:()=>void;edit?:()=>void;externalInMenu?:boolean;
}) {
  const [open,setOpen]=useState(false);
  const [prepareOpen,setPrepareOpen]=useState(false);
  const [editOpen,setEditOpen]=useState(false);
  const [fileAction,setFileAction]=useState<'rename'|'recycle'|null>(null),[fileInfo,setFileInfo]=useState<FileActionInfo|null>(null);
  const prepareEnabled=useNativePreparation();
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const menu=useRef<HTMLDivElement>(null);
  const closeMenu=useCallback(()=>setOpen(false),[]);
  useAnchoredMenu(open,trigger,menu,closeMenu);
  useEffect(()=>{
    if(!open)return;const controller=new AbortController();setFileInfo(null);
    void api<FileActionInfo>(`/api/media/${media.id}/file-actions`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setFileInfo(value);}).catch(()=>{});
    return()=>controller.abort();
  },[open,media.id]);
  useEffect(()=>{
    if(!open)return;
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)&&!menu.current?.contains(e.target as Node))setOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus({preventScroll:true});}else if(e.key==='Tab'){setOpen(false);trigger.current?.focus({preventScroll:true});}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({preventScroll:true});
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
  },[open]);
  async function act(action:'watched'|'auto'|'copy'|'reveal'|'open') {
    if(lock.current)return;
    lock.current=true;setBusy(true);
    try {
      if(action==='watched'||action==='auto') {
        const value=await api<Media>(`/api/media/${media.id}/watched`,action==='auto'?{method:'DELETE'}:json('PUT',{watched:!media.watched}));
        update(value);changed?.();notify(action==='auto'?'已恢复自动判断观看状态':value.watched?'已标记为已看':'已标记为未看');
      } else if(action==='copy') {await navigator.clipboard.writeText(media.path);notify('视频路径已复制');}
      else {
        await requireDesktop('mediaAction').mediaAction(media.id,action);
        if(action==='reveal')notify('已在资源管理器中定位视频');
      }
      setOpen(false);
    } catch(e){notify(errorText(e));}
    finally {lock.current=false;setBusy(false);}
  }
  return <div className="media-actions" ref={root}>
    <button ref={trigger} className="media-more" aria-label={`更多操作 ${media.title}`} title="更多操作" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <Icon name="more"/>
    </button>
    {open && createPortal(<div className="media-actions media-menu-layer"><div ref={menu} className="media-menu" style={{position:'fixed',right:'auto',visibility:'hidden'}} role="menu" aria-label={`视频操作 ${media.title}`} onKeyDown={event=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();
      const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const index=items.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next]?.focus();
    }}>
      <button role="menuitem" disabled={busy} onClick={()=>{trigger.current?.focus({preventScroll:true});setOpen(false);if(edit)edit();else setEditOpen(true);}}><Icon name="edit" size={16}/>编辑信息与封面</button>
      <button role="menuitem" disabled={busy} onClick={()=>void act('watched')}><Icon name={media.watched?'eyeOff':'check'} size={16}/>{media.watched?'标记为未看':'标记为已看'}</button>
      {media.manual_watched!==null && media.manual_watched!==undefined && <button role="menuitem" disabled={busy} onClick={()=>void act('auto')}><Icon name="refresh" size={16}/>恢复自动已看判断</button>}
      <button role="menuitem" disabled={busy} onClick={()=>void act('copy')}><Icon name="copy" size={16}/>复制视频路径</button>
      <button role="menuitem" disabled={busy||Boolean(media.missing)} onClick={()=>void act('reveal')}><Icon name="reveal" size={16}/>在资源管理器中显示</button>
      {externalInMenu&&<button role="menuitem" disabled={busy||Boolean(media.missing)} onClick={()=>void act('open')}><Icon name="external" size={16}/>用系统播放器打开</button>}
      {prepareEnabled&&media.ext.toLowerCase()==='.mkv'&&<button role="menuitem" disabled={busy||Boolean(media.missing)} onClick={()=>{pauseForPreparation?.();setOpen(false);setPrepareOpen(true);}}><Icon name="quality" size={16}/>无损播放准备</button>}
      <small>只修改应用记录，不改动原文件</small>
      <div className="media-menu-file-heading">文件整理 · 需目录授权</div>
      <button role="menuitem" disabled={busy||!fileInfo?.rename||!window.avhubDesktop?.fileOperation} title={fileInfo?.rename_reason??fileInfo?.reason} onClick={()=>{trigger.current?.focus({preventScroll:true});setOpen(false);setFileAction('rename');}}><Icon name="edit" size={16}/>重命名文件</button>
      <button role="menuitem" className="danger-action" disabled={busy||!fileInfo?.recycle||!window.avhubDesktop?.fileOperation} title={fileInfo?.recycle_reason??fileInfo?.reason} onClick={()=>{trigger.current?.focus({preventScroll:true});setOpen(false);setFileAction('recycle');}}><Icon name="trash" size={16}/>移入系统回收站</button>
      {fileInfo?.reason&&<small>{fileInfo.reason}</small>}
    </div></div>,document.body)}
    {prepareEnabled&&prepareOpen&&<NativePrepareDialog media={media} close={()=>setPrepareOpen(false)} play={playPrepared}/>}
    {editOpen&&<MediaEditDialog media={media} update={value=>{update(value);changed?.();}} close={()=>setEditOpen(false)}/>}
    {fileAction&&<FileActionDialog media={media} action={fileAction} close={()=>setFileAction(null)} changed={()=>{void api<Media>(`/api/media/${media.id}`).then(value=>update(value)).catch(error=>notify(errorText(error)));changed?.();notify(fileAction==='rename'?'文件名和视频标题已同步更新':'视频已移入系统回收站，可在系统回收站恢复',4000);}}/>}
  </div>;
}
