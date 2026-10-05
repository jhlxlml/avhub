import {useEffect,useRef,type RefObject} from 'react';

// Keep the last decoded picture while MSE temporarily has no current data.
// This never marks a seek complete; only an actual new frame/seeked can retire it.
export function useSeekFrame(video:RefObject<HTMLVideoElement|null>,offset:RefObject<number>) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const target=useRef<number|null>(null);
  const callback=useRef<number|null>(null);
  const presented=useRef(false);
  const seekConfirmed=useRef(false);
  const requestedSeek=useRef(false);
  const timer=useRef<number|undefined>(undefined);
  const clear=()=>{
    target.current=null;
    presented.current=false;
    seekConfirmed.current=false;
    requestedSeek.current=false;
    if(canvas.current)canvas.current.hidden=true;
    if(callback.current!==null)video.current?.cancelVideoFrameCallback?.(callback.current);
    callback.current=null;window.clearTimeout(timer.current);
  };
  const settle=()=>{
    const element=video.current;
    if(element&&presented.current&&!element.seeking&&element.readyState>=2)clear();
  };
  const observe=()=>{
    const element=video.current;
    if(!element||target.current===null||callback.current!==null||!element.requestVideoFrameCallback)return;
    callback.current=element.requestVideoFrameCallback((_,frame)=>{
      callback.current=null;
      if(target.current===null)return;
      // Paused seeks can present their only frame before readyState/seeked settles.
      // On busy decoders the first delivered callback can be several frames
      // beyond the exact target. A witnessed seeked at the requested point plus
      // an actual frame at the current playback cursor is equally valid proof.
      // Do not accept a stale pre-seek frame just because seeked has fired.
      if(Math.abs(frame.mediaTime+offset.current-target.current)<.35||
          (seekConfirmed.current&&!element.seeking&&Math.abs(frame.mediaTime-element.currentTime)<.35)) {
        presented.current=true;settle();
      }
      else observe();
    });
  };
  const begin=(point:number)=>{
    const element=video.current,surface=canvas.current;
    if(!element||!surface)return;
    if(surface.hidden&&element.readyState>=2&&element.videoWidth&&element.videoHeight) {
      try {
        surface.width=element.videoWidth;surface.height=element.videoHeight;
        surface.getContext('2d',{alpha:false})?.drawImage(element,0,0,surface.width,surface.height);
        surface.hidden=false;
      } catch {surface.hidden=true;}
    }
    target.current=point;
    presented.current=false;
    seekConfirmed.current=false;
    requestedSeek.current=false;
    if(callback.current!==null)element.cancelVideoFrameCallback?.(callback.current);
    callback.current=null;
    window.clearTimeout(timer.current);
    // A genuine failure must not leave a frozen picture indefinitely.
    timer.current=window.setTimeout(clear,45000);
    observe();
  };
  useEffect(()=>{
    const element=video.current;if(!element)return;
    const seeking=()=>{
      if(target.current!==null&&Math.abs(element.currentTime+offset.current-target.current)<.35)
        requestedSeek.current=true;
    };
    const seeked=()=>{
      if(target.current!==null&&!element.seeking&&element.readyState>=2&&
          (Math.abs(element.currentTime+offset.current-target.current)<.35||
            requestedSeek.current&&Math.abs(element.currentTime+offset.current-target.current)<1.5)) {
        // MSE can move the requested point over a short buffered-range gap.
        // Only allow this after witnessing the original seek, and still wait
        // for a decoded frame matching the settled cursor before hiding canvas.
        seekConfirmed.current=true;
        if(typeof element.requestVideoFrameCallback==='function'){settle();observe();}else clear();
      }
    };
    const metadata=()=>{
      // load()/MediaSource replacement can retire a previously registered
      // callback. Re-arm at the new metadata before its paused frame arrives.
      if(target.current===null)return;
      if(callback.current!==null)element.cancelVideoFrameCallback?.(callback.current);
      callback.current=null;presented.current=false;seekConfirmed.current=false;requestedSeek.current=false;observe();
    };
    element.addEventListener('seeked',seeked);
    element.addEventListener('seeking',seeking);
    element.addEventListener('loadedmetadata',metadata);
    element.addEventListener('loadeddata',observe);
    element.addEventListener('canplay',settle);
    element.addEventListener('error',clear);
    element.addEventListener('ended',clear);
    return()=>{
      clear();element.removeEventListener('seeked',seeked);element.removeEventListener('loadeddata',observe);
      element.removeEventListener('seeking',seeking);
      element.removeEventListener('loadedmetadata',metadata);
      element.removeEventListener('canplay',settle);
      element.removeEventListener('error',clear);element.removeEventListener('ended',clear);
      if(canvas.current){canvas.current.width=0;canvas.current.height=0;}
    };
  },[video,offset]);
  return {canvas,begin,clear};
}
