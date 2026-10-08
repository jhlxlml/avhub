import { useCallback, useEffect, useRef, useState } from 'react';
import { pageScrollTop } from './pageScroll';
import type {PlaylistPlayback} from './api';
type Guard=()=>Promise<boolean>;
type Route={mediaId:number|null;playlistId:number|null;scroll:number;playlistPlayback?:PlaylistPlayback};
function positive(value:string|null) {return value && /^[1-9]\d{0,14}$/.test(value)?Number(value):null;}
export function readPlaylistPlayback():PlaylistPlayback|undefined {
  const value=history.state?.avhubPlaylistPlayback;
  return value&&['sequential','random','repeat-one'].includes(value.mode)&&typeof value.autoNext==='boolean'?{mode:value.mode,autoNext:value.autoNext}:undefined;
}
function readRoute():Route {
  const p=new URL(location.href).searchParams;
  const playlistPlayback=readPlaylistPlayback();
  return {mediaId:positive(p.get('video')),playlistId:positive(p.get('playlist')),scroll:Number(history.state?.avhubScroll)||0,playlistPlayback};
}
// History navigation waits for the player's save guard. A failed save rolls
// history back without destroying the player or silently losing its progress.
export function useWatchRouter(onLibrary:()=>void) {
  const [route,setRoute]=useState(readRoute);
  const committed=useRef({href:location.href,index:Number(history.state?.avhubIndex)||0});
  const guard=useRef<Guard|null>(null);
  const changed=useRef(onLibrary);changed.current=onLibrary;
  const pending=useRef<{href:string;state:any}|null>(null);
  const busy=useRef(false);
  const restoring=useRef<number|null>(null);
  const skipGuard=useRef(false);
  const registerGuard=useCallback((value:Guard)=>{
    guard.current=value;return ()=>{if(guard.current===value)guard.current=null;};
  },[]);
  useEffect(()=>{
    history.replaceState({...history.state,avhubIndex:committed.current.index},'',location.href);
    const pop=async()=>{
      const target={href:location.href,state:history.state};
      if(restoring.current!==null && target.state?.avhubIndex===restoring.current){restoring.current=null;return;}
      pending.current=target;if(busy.current)return;busy.current=true;
      let accepted=true;
      try {if(!skipGuard.current && guard.current)accepted=await guard.current();}catch {accepted=false;}
      skipGuard.current=false;
      const latest=pending.current!;pending.current=null;busy.current=false;
      const index=Number(latest.state?.avhubIndex)||0;
      if(!accepted) {
        const delta=committed.current.index-index;
        if(delta){restoring.current=committed.current.index;history.go(delta);}
        else history.replaceState({...latest.state,avhubIndex:committed.current.index},'',committed.current.href);
        return;
      }
      committed.current={href:latest.href,index};setRoute(readRoute());changed.current();
    };
    window.addEventListener('popstate',pop);
    return ()=>window.removeEventListener('popstate',pop);
  },[]);
  const replaceHref=useCallback((url:URL,state?:{avhubPlaylistPlayback:Partial<PlaylistPlayback>})=>{
    if(busy.current || restoring.current!==null)return;
    history.replaceState({...history.state,...state},'',url);committed.current.href=url.href;
  },[]);
  const navigate=useCallback((mediaId:number|null,playlistId:number|null=null,replace=false,playlistPlayback?:Partial<PlaylistPlayback>)=>{
    if(busy.current || restoring.current!==null)return;
    const wasWatch=readRoute().mediaId!==null;
    const libraryScroll=wasWatch?Number(history.state?.avhubScroll)||0:pageScrollTop();
    if(!wasWatch)history.replaceState({...history.state,avhubScroll:libraryScroll},'',location.href);
    const url=new URL(committed.current.href);
    // "watch" is already used by the watched/unwatched library filter.
    if(mediaId)url.searchParams.set('video',String(mediaId));else url.searchParams.delete('video');
    if(mediaId && playlistId)url.searchParams.set('playlist',String(playlistId));else url.searchParams.delete('playlist');
    const index=committed.current.index+(replace?0:1);
    const state={...history.state,avhubIndex:index,avhubScroll:libraryScroll,
      avhubPlaylistPlayback:mediaId&&playlistId?(playlistPlayback??(readRoute().playlistId===playlistId?history.state?.avhubPlaylistPlayback:undefined)):undefined,
      avhubLibraryIndex:wasWatch?history.state?.avhubLibraryIndex:committed.current.index};
    history[replace?'replaceState':'pushState'](state,'',url);
    committed.current={href:url.href,index};setRoute(readRoute());
  },[]);
  const close=useCallback(()=>{
    if(busy.current || restoring.current!==null)return;
    const libraryIndex=history.state?.avhubLibraryIndex;
    if(Number.isInteger(libraryIndex) && libraryIndex<committed.current.index) {
      skipGuard.current=true;history.go(libraryIndex-committed.current.index);
    } else {navigate(null,null,true);changed.current();}
  },[navigate]);
  return {route,navigate,close,replaceHref,registerGuard};
}
