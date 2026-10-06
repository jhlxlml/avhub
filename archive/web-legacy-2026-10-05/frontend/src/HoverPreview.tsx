import { useCallback, useEffect, useRef, useState } from 'react';
import type { Media } from './api';
import { preference } from './preferences';

export function loadPreviewPreference() {
  return preference('hoverPreview',false);
}

// A single hovered card owns this component. Never call the playback API or
// create FFmpeg jobs just to preview a file the browser may not support.
export function HoverPreview({ media }: { media: Media }) {
  const [ready,setReady]=useState(false);
  const [visible,setVisible]=useState(false);
  const [failed,setFailed]=useState(false);
  const video=useRef<HTMLVideoElement>(null);
  const attach=useCallback((element:HTMLVideoElement|null)=>{
    const previous=video.current;
    if(previous && previous!==element){previous.pause();previous.removeAttribute('src');previous.load();}
    video.current=element;
  },[]);
  const start=useRef(0);
  useEffect(()=>{
    const timer=window.setTimeout(()=>setReady(true),650);
    return ()=>{clearTimeout(timer);const element=video.current;if(element){element.pause();element.removeAttribute('src');element.load();}};
  },[media.id]);
  if(!ready || failed) return null;
  return <>
    <video ref={attach} className={`hover-preview${visible?' visible':''}`} src={`/media/${media.id}/file`} muted playsInline preload="metadata" aria-hidden="true"
      onLoadedMetadata={event=>{
        const element=event.currentTarget;
        const total=Number.isFinite(element.duration)?element.duration:media.duration||0;
        start.current=Math.max(0,Math.min(total*.12,60,Math.max(0,total-1)));
        element.currentTime=start.current;element.muted=true;
        void element.play().catch(()=>setFailed(true));
      }}
      onPlaying={()=>setVisible(true)} onError={()=>setFailed(true)}
      onTimeUpdate={event=>{if(event.currentTarget.currentTime>=start.current+6)event.currentTarget.currentTime=start.current;}}
      onEnded={event=>{event.currentTarget.currentTime=start.current;void event.currentTarget.play().catch(()=>setFailed(true));}} />
    {visible && <small className="hover-preview-badge">静音预览</small>}
  </>;
}
