import {useEffect,type RefObject} from 'react';
import {playbackKeyIntent,playerShortcutTarget} from './playerShortcuts';
import {NativeLayoutQueue} from './nativeLayoutQueue';

export function measureNativeViewport(element:HTMLElement){
  const box=element.getBoundingClientRect(),scroll=document.getElementById('app-scroll-area')?.getBoundingClientRect();
  const immersive=document.documentElement.matches('.pure-playback,.native-video-fullscreen');
  const header=immersive?0:element.closest('.player-shell')?.querySelector('.player-top')?.getBoundingClientRect().bottom??0;
  const left=Math.max(box.left,scroll?.left??0,0),top=Math.max(box.top,scroll?.top??0,header,0);
  const right=Math.min(box.right,scroll?.right??innerWidth,innerWidth),bottom=Math.min(box.bottom,scroll?.bottom??innerHeight,innerHeight);
  const width=Math.max(1,box.width),height=Math.max(1,box.height);
  return {x:box.x,y:box.y,width,height,radius:Math.min(128,parseFloat(getComputedStyle(element).borderTopLeftRadius)||0),clip:{x:Math.min(width,Math.max(0,left-box.x)),y:Math.min(height,Math.max(0,top-box.y)),width:Math.max(0,right-left),height:Math.max(0,bottom-top)},visible:!document.hidden&&!element.closest('[inert]')&&!document.querySelector('.modal-backdrop,[role="dialog"][aria-modal="true"],.setting-popover,[role="menu"]')};
}

export function useNativeViewport(ref:RefObject<HTMLElement|null>,session:string|null,onError:(error:unknown)=>void){
  useEffect(()=>{
    const element=ref.current,desktop=window.avhubDesktop;if(!element||!desktop||!session)return;
    let frame=0,alive=true;
    const queue=new NativeLayoutQueue<ReturnType<typeof measureNativeViewport>>(viewport=>desktop.nativePlayer('layout',{session,viewport}),error=>{if(alive)onError(error);});
    const update=()=>{frame=0;if(!alive)return;const viewport=measureNativeViewport(element);queue.push(viewport,JSON.stringify(viewport));};
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const resize=new ResizeObserver(schedule);resize.observe(element);
    const mutation=new MutationObserver(schedule);mutation.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','inert','open']});
    let keyboard=false;
    const pointer=()=>{keyboard=false;};
    const key=(event:KeyboardEvent)=>{
      if(event.code==='Tab')keyboard=true;
      if(!playbackKeyIntent(event)||!playerShortcutTarget(event,null,keyboard)||document.querySelector('.modal-backdrop,.setting-popover,[role="menu"]'))return;
      event.preventDefault();event.stopPropagation();
      void desktop.nativePlayer('shortcut',{session,code:event.code,shiftKey:event.shiftKey,repeat:event.repeat}).catch(onError);
    };
    window.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',schedule);
    document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',key,true);schedule();
    const mouse=desktop.onMouseSeek?.(direction=>{if(!document.querySelector('.modal-backdrop,.setting-popover,[role="menu"]'))void desktop.nativePlayer('mouse-seek',{session,direction}).catch(onError);});
    return()=>{alive=false;queue.dispose();mouse?.();cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',schedule);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',key,true);};
  },[ref,session]);
}
