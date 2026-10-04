import {useEffect,useState,type RefObject} from 'react';

// A normal local seek emits waiting even if the next frame is ready in ~20ms.
// Delay feedback, not playback; sustained waits must remain visible.
export const PLAYBACK_FEEDBACK_DELAY_MS = 350;

export function usePlaybackFeedback(video:RefObject<HTMLVideoElement|null>,phase:string,sourceKey:number) {
  const [preparingKey,setPreparingKey]=useState<number|null>(null);
  const [buffering,setBuffering]=useState(false);
  useEffect(()=>{
    setPreparingKey(null);
    if(phase!=='preparing')return;
    const timer=window.setTimeout(()=>setPreparingKey(sourceKey),PLAYBACK_FEEDBACK_DELAY_MS);
    return()=>window.clearTimeout(timer);
  },[phase,sourceKey]);

  useEffect(()=>{
    setBuffering(false);
    const element=video.current;
    if(!element||phase!=='ready')return;
    let timer:number|null=null;
    let frame:number|null=null;
    let disposed=false;
    const needsData=()=>!element.error&&!element.ended &&
      (element.seeking||element.readyState<2||!element.paused&&element.readyState<3);
    const clear=()=>{
      if(timer!==null)window.clearTimeout(timer);
      if(frame!==null)element.cancelVideoFrameCallback?.(frame);
      timer=null;frame=null;
      if(!disposed)setBuffering(false);
    };
    const check=()=>{
      timer=null;
      if(disposed)return;
      if(!needsData()){clear();return;}
      setBuffering(true);
      // Readiness can recover without another playing event (especially paused).
      timer=window.setTimeout(check,100);
    };
    const observeFrame=()=>{
      if(frame!==null||!element.requestVideoFrameCallback)return;
      frame=element.requestVideoFrameCallback((_,metadata)=>{
        frame=null;
        if(disposed)return;
        if(Math.abs(metadata.mediaTime-element.currentTime)<1.5&&(element.paused||element.readyState>=3))clear();
        else if(needsData())observeFrame();
      });
    };
    const update=()=>{
      if(!needsData()){clear();return;}
      if(timer===null)timer=window.setTimeout(check,PLAYBACK_FEEDBACK_DELAY_MS);
      observeFrame();
    };
    const reset=()=>clear();
    const events=['waiting','stalled','seeking','seeked','loadeddata','canplay','canplaythrough','playing','pause'];
    for(const event of events)element.addEventListener(event,update);
    for(const event of ['emptied','error','ended'])element.addEventListener(event,reset);
    update();
    return()=>{
      disposed=true;clear();
      for(const event of events)element.removeEventListener(event,update);
      for(const event of ['emptied','error','ended'])element.removeEventListener(event,reset);
    };
  },[video,phase,sourceKey]);
  return {preparing:phase==='preparing'&&preparingKey===sourceKey,buffering:phase==='ready'&&buffering};
}
