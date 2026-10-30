// Pure acceptance observation: usable without importing a debugging transport.
export function classifyChromiumWaits(events){
 const counts={startup:0,playback:0,seek:0};let phase='startup';
 for(const event of events){
   if(event.name==='seeking')phase='seek';
   else if(event.name==='playing'||event.name==='seeked')phase='playback';
   else if(event.name==='waiting')counts[phase]++;
 }
 return counts;
}

export function installChromiumCycleObserver(){
 const events=[];let video=null,frameId,firstFrameMs=null,lastFrame=null,sourceLoads=0,stopped=false;
 const started=performance.now(),listeners=[];
 const frame=(_,metadata)=>{
   if(stopped)return;
   if(firstFrameMs===null)firstFrameMs=performance.now()-started;
   lastFrame={at:performance.now(),mediaTime:metadata.mediaTime,presented:metadata.presentedFrames};
   frameId=video.requestVideoFrameCallback(frame);
 };
 const event=event=>{
   const target=event.target;
   if(!(target instanceof HTMLVideoElement)||!target.matches('.player-shell video'))return;
   if(event.type==='loadstart')sourceLoads++;
   if(events.length<128)events.push({name:event.type,at:performance.now()-started,time:target.currentTime});
   if(video!==target){
     if(video&&frameId!==undefined)video.cancelVideoFrameCallback(frameId);
     video=target;
     if(video.requestVideoFrameCallback)frameId=video.requestVideoFrameCallback(frame);
   }
 };
 for(const name of ['loadstart','playing','waiting','stalled','seeking','seeked','error']){
   document.addEventListener(name,event,true);listeners.push(name);
 }
 window.__chromiumLibraryCycle={
   snapshot(){return {firstFrameMs,lastFrame,sourceLoads,events:[...events],frameCallbacksSupported:typeof video?.requestVideoFrameCallback==='function'};},
   stop(){
     if(stopped)return;stopped=true;
     for(const name of listeners)document.removeEventListener(name,event,true);
     if(video&&frameId!==undefined)video.cancelVideoFrameCallback(frameId);
     video=null;frameId=undefined;
   },
 };
}
