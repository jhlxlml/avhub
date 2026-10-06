import { useSyncExternalStore } from 'react';
import {rendererTest} from './api';

// Runtime window state, not a preference: never reopen an unexpectedly pinned
// window. A shared store survives video/playlist remounts without decoder resets.
let state: WindowPlaybackState & {busy:boolean} = {purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false,busy:false};
const listeners = new Set<()=>void>();
let writes = Promise.resolve();
let pending = 0;
function update(value: Partial<typeof state>) {
  state = {...state,...value};
  document.documentElement.classList.toggle('pure-playback',state.purePlayback);
  document.documentElement.classList.toggle('native-video-fullscreen',state.fullScreen);
  listeners.forEach(listener=>listener());
}
export function useWindowMode() {
  return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>state);
}
export function connectWindowMode() {
  const desktop=window.avhubDesktop;
  if(!desktop)return()=>{};
  let active=true,revision=0;
  const stop=desktop.onWindowStateChanged(value=>{revision++;if(active)update(value);});
  const initial=revision;
  void desktop.getWindowState().then(value=>{if(active && initial===revision)update(value);}).catch(()=>{});
  return()=>{active=false;stop();};
}
export function setWindowMode(value:{purePlayback?:boolean;alwaysOnTop?:boolean;videoAspectRatio?:number}) {
  pending++;update({busy:true});
  const task=writes.then(async()=>{
    // Late metadata from an old player must never resize the library window.
    if(value.videoAspectRatio!==undefined && value.purePlayback===undefined && !state.purePlayback)return;
    if(window.avhubDesktop)update(await window.avhubDesktop.setWindowMode(value));
    else if(rendererTest)update({purePlayback:value.purePlayback??state.purePlayback}); // Component layout simulation only.
    else throw new Error('窗口操作需要 AVHub 桌面组件');
  });
  writes=task.catch(()=>{});
  return task.finally(()=>{pending--;update({busy:pending>0});});
}
export function resetPlaybackWindow() {
  // Always enqueue: a late in-flight enter must not leave the library borderless.
  return setWindowMode({purePlayback:false,alwaysOnTop:false});
}
