// Acceptance-only observation. No timers, polling, frame callbacks or playback
// policy changes. Installed after the real application has started playback.
export function installPlaybackTimeline(video) {
 window.__playbackTimeline?.stop?.();
 const rows=[],longTasks=[],listeners=[];let stopped=false,restored=false,observer,returnObserver;
 const frame=()=>{const q=video.getVideoPlaybackQuality();return {time:video.currentTime,total:q.totalVideoFrames,dropped:q.droppedVideoFrames,paused:video.paused,seeking:video.seeking,ready:video.readyState};};
 const record=(kind,extra={})=>{if(stopped)return null;const row={kind,at:performance.now(),wallAt:Date.now(),...frame(),...extra};rows.push(row);if(rows.length>256)rows.shift();return row;};
 const longTasksSupported=typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask');
 window.__playbackTimeline={rows,longTasks,longTasksSupported,record,origin:performance.timeOrigin};
 if(longTasksSupported){
  observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({start:entry.startTime,duration:entry.duration});if(longTasks.length>128)longTasks.splice(0,longTasks.length-128);});
  observer.observe({type:'longtask'});
 }
 for(const kind of ['pause','play','playing','seeking','seeked','waiting','stalled','loadstart','ended']){const fn=()=>record(kind);video.addEventListener(kind,fn);listeners.push([kind,fn]);}
 const back=event=>{const button=event.target?.closest?.('.player-top button');if(button?.textContent?.includes('返回媒体库'))record('back-click');};
 if(typeof document!=='undefined')document.addEventListener('click',back,true);
 if(typeof document!=='undefined'&&typeof MutationObserver!=='undefined'){
  returnObserver=new MutationObserver(()=>{if(!document.querySelector('.player-shell')&&document.querySelector('.library .card')){record('library-dom');returnObserver.disconnect();}});
  returnObserver.observe(document.body,{childList:true,subtree:true});
 }
 const original=window.fetch;
 const wrapped=function(input,init){
  if(stopped)return original.apply(this,arguments);
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(!/\/api\/media\/\d+\/progress(?:\?|$)/.test(url)||init?.method!=='PUT')return original.apply(this,arguments);
  let body;try{body=JSON.parse(init.body);}catch{return original.apply(this,arguments);}
  const start=record('fetch-start',{updatedAt:body.updated_at,progress:body.progress});
  return original.apply(this,arguments).then(response=>{
   record('fetch-headers',{updatedAt:body.updated_at,status:response.status,scope:response.headers.get('x-avhub-save-trace'),
    serverHttpMs:response.headers.get('x-avhub-progress-http-ms'),serverHandlerMs:response.headers.get('x-avhub-progress-handler-ms'),
    serverBodyReadyMs:response.headers.get('x-avhub-progress-body-ms'),serverDispatchMs:response.headers.get('x-avhub-progress-dispatch-ms'),elapsed:performance.now()-start.at});
   return response;
  },error=>{record('fetch-error',{updatedAt:body.updated_at});throw error;});
 };
 window.fetch=wrapped;
 window.__playbackTimeline.stop=()=>{
  if(stopped)return restored;
  stopped=true;observer?.disconnect();returnObserver?.disconnect();
  for(const [kind,fn] of listeners)video.removeEventListener(kind,fn);
  if(typeof document!=='undefined')document.removeEventListener('click',back,true);
  if(window.fetch===wrapped){window.fetch=original;restored=true;}
  return restored;
 };
 record('installed');
}

// Intervals are classified from event boundaries, not from final paused state.
// Transition/paused drops remain visible and must not be reported as zero drops.
export function frameIntervals(rows) {
 let state='playing';const intervals=[];
 for(let n=1;n<rows.length;n++){
  const before=rows[n-1],after=rows[n];
  if(before.kind==='pause-call'||before.kind==='play-call')state='transition';
  if(before.kind==='pause')state='paused';
  if(before.kind==='playing')state='playing';
  intervals.push({from:before.kind,to:after.kind,state,ms:after.at-before.at,total:after.total-before.total,dropped:after.dropped-before.dropped});
 }
 return intervals;
}
