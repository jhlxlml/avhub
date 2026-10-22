// Explicit acceptance-only sampler; no React updates or playback mutations.
export function startSteadyFrames(video) {
 const frames=[],animations=[],samples=[],events=[];
 const sample=()=>{const q=video.getVideoPlaybackQuality();return {at:performance.now(),time:video.currentTime,total:q.totalVideoFrames,dropped:q.droppedVideoFrames,paused:video.paused,seeking:video.seeking,ready:video.readyState,visible:document.visibilityState,focused:document.hasFocus()};};
 let stopped=false,frameId,animationId,omitted=0,result;
 const append=(list,row,limit)=>{if(list.length<limit)list.push(row);else omitted++;};
 const frame=(_,m)=>{append(frames,{at:performance.now(),mediaTime:m.mediaTime,presented:m.presentedFrames,expected:m.expectedDisplayTime,processingMs:m.processingDuration*1000},4096);if(!stopped)frameId=video.requestVideoFrameCallback(frame);};
 const animation=at=>{append(animations,at,8192);if(!stopped)animationId=requestAnimationFrame(animation);};
 const listeners=[];
 for(const name of ['pause','playing','waiting','stalled','seeking','seeked','loadstart','ended']){const listener=()=>append(events,{name,...sample()},128);video.addEventListener(name,listener);listeners.push([name,listener]);}
 samples.push(sample());
 const timer=setInterval(()=>append(samples,sample(),256),250);
 if(video.requestVideoFrameCallback)frameId=video.requestVideoFrameCallback(frame);
 animationId=requestAnimationFrame(animation);
 window.__steadyFrames={stop(){if(result)return result;stopped=true;clearInterval(timer);if(frameId!==undefined)video.cancelVideoFrameCallback(frameId);cancelAnimationFrame(animationId);for(const [name,listener] of listeners)video.removeEventListener(name,listener);if(samples.length<256)samples.push(sample());else{samples[samples.length-1]=sample();omitted++;}return result={frames,animations,samples,events,omitted,frameCallbacksSupported:typeof video.requestVideoFrameCallback==='function'};}};
}

export function summarizeSteadyFrames(trace,fps) {
 const stats=values=>{if(!values.length)return {count:0,p50:null,p95:null,max:null};const sorted=values.slice().sort((a,b)=>a-b);return {count:sorted.length,p50:sorted[Math.floor((sorted.length-1)*.5)],p95:sorted[Math.floor((sorted.length-1)*.95)],max:sorted.at(-1)};};
 const differences=(rows,value)=>rows.slice(1).map((row,n)=>value(row)-value(rows[n]));
 const first=trace.samples[0],last=trace.samples.at(-1);
 // expectedDisplayTime is the browser's presentation estimate, not a
 // physical-display measurement. Callback gaps/misses are kept separately.
 const frameGaps=differences(trace.frames,row=>row.expected);
 return {elapsedMs:last.at-first.at,mediaSeconds:last.time-first.time,total:last.total-first.total,dropped:last.dropped-first.dropped,
  presentationMs:stats(frameGaps),callbackMs:stats(differences(trace.frames,row=>row.at)),
  mediaStepMs:stats(differences(trace.frames,row=>row.mediaTime*1000)),animationMs:stats(differences(trace.animations,row=>row)),
  longPresentationGaps:frameGaps.filter(value=>value>1500/fps).length,
  missedCallbackFrames:differences(trace.frames,row=>row.presented).reduce((sum,value)=>sum+Math.max(0,value-1),0),
  processingMs:stats(trace.frames.map(row=>row.processingMs).filter(Number.isFinite)),
  allPlaying:trace.samples.every(row=>!row.paused&&!row.seeking&&row.ready>=2),
  allVisible:trace.samples.every(row=>row.visible==='visible'),allFocused:trace.samples.every(row=>row.focused),events:trace.events.map(row=>row.name),omitted:trace.omitted};
}
