// Serialized into a test renderer; never imported by production or packaged.
function observePlayback(){
 const original=HTMLMediaElement.prototype.play;
 HTMLMediaElement.prototype.play=function(...args){
  if(this.closest('.player-shell')&&!this.dataset.probed){
   this.dataset.probed='1';const v=this,start=performance.now(),q=()=>{const p=v.getVideoPlaybackQuality();let ahead=null;for(let i=0;i<v.buffered.length;i++)if(v.currentTime>=v.buffered.start(i)&&v.currentTime<=v.buffered.end(i))ahead=v.buffered.end(i)-v.currentTime;return{at:performance.now()-start,time:v.currentTime,total:p.totalVideoFrames,dropped:p.droppedVideoFrames,ready:v.readyState,ahead,visible:document.visibilityState,focused:document.hasFocus()};};
   const trace=window.__frameProbe={events:[],inputs:[],frames:[],samples:[q()],animationFrames:[],longTasks:[],visible:document.visibilityState,focused:document.hasFocus()};let observing=true;
   const input=e=>{
    if(trace.inputs.length>=64)return;
    // No typed text, title or element label. Retain only playback-key codes
    // and coarse pointer/window events to identify interrupted measurements.
    const allowed=['Space','KeyK','KeyJ','KeyL','KeyM','KeyF','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape'];
    trace.inputs.push({at:performance.now()-start,type:e.type,trusted:e.isTrusted,code:e.type==='keydown'?(allowed.includes(e.code)?e.code:'other'):null,
     region:e.target instanceof Element?(e.target.closest('.player-controls')?'controls':e.target.closest('.player-shell')?'player':'other'):null});
   };
   for(const name of ['keydown','pointerdown','visibilitychange'])document.addEventListener(name,input,true);
   for(const name of ['blur','focus'])window.addEventListener(name,input);
   for(const event of ['playing','pause','waiting','stalled','loadstart','seeking','seeked'])v.addEventListener(event,()=>trace.events.push({event,...q()}));
   const frame=(_,m)=>{trace.frames.push({at:performance.now()-start,mediaTime:m.mediaTime,presented:m.presentedFrames,processingMs:m.processingDuration*1000});if(observing&&v.isConnected)v.requestVideoFrameCallback(frame);};v.requestVideoFrameCallback(frame);
   const animation=now=>{trace.animationFrames.push(now-start);if(observing&&v.isConnected)requestAnimationFrame(animation);};requestAnimationFrame(animation);
   const timer=setInterval(()=>{trace.samples.push(q());if(!v.isConnected)clearInterval(timer);},100);
   const observer=new PerformanceObserver(list=>{for(const item of list.getEntries())trace.longTasks.push({at:item.startTime-start,duration:item.duration});});observer.observe({entryTypes:['longtask']});
   trace.stop=()=>{observing=false;clearInterval(timer);observer.disconnect();trace.samples.push(q());for(const name of ['keydown','pointerdown','visibilitychange'])document.removeEventListener(name,input,true);for(const name of ['blur','focus'])window.removeEventListener(name,input);};
  }
  return original.apply(this,args);
 };
}
function summarizeFrameTrace(trace){
 const bins=[];let previous={total:0,dropped:0};
 for(const end of [1000,4000,8000,Infinity]){const rows=trace.samples.filter(s=>s.at<=end),last=rows.at(-1)??previous;bins.push({throughMs:Number.isFinite(end)?end:'end',frames:last.total-previous.total,dropped:last.dropped-previous.dropped});previous=last;}
 const firstPlaying=trace.events.find(e=>e.event==='playing')?.at??Infinity;
 return{bins,unexpectedReloads:trace.events.filter(e=>e.event==='loadstart'&&e.at>firstPlaying).length};
}
module.exports={observePlayback,summarizeFrameTrace};
