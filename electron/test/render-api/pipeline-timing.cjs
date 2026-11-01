// Test-only observer installed in the real Electron main process. No playback
// method is skipped or completed early; histogram storage has a fixed bound.
module.exports=function installPipelineTiming({app},{highResolutionClock=false,eventLoop=true}={}){
 const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
 const {RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js');
 const {RenderTextureBridge}=require(app.getAppPath()+'/electron/dist/renderTexture.js');
 const {RenderPlayer}=require(app.getAppPath()+'/electron/dist/renderPlayer.js');
 const {monitorEventLoopDelay}=require('node:perf_hooks');
 const delay=monitorEventLoopDelay({resolution:10}),histograms=new Map(),pumps=new WeakMap();
 let enabled=false,began=0,slow=[],dropChanges=[],lastDrops,clockEnd;
 const clock={testOnly:true,requestedMs:highResolutionClock?1:null,beginResult:null,endResult:null};
 const record=(name,ms)=>{
  if(!enabled)return;
  let h=histograms.get(name);if(!h){h={bins:new Uint32Array(20001),count:0,sum:0,max:0,over40Ms:0,overflow:0};histograms.set(name,h);}
  h.bins[Math.min(20000,Math.ceil(ms*10))]++;h.count++;h.sum+=ms;h.max=Math.max(h.max,ms);if(ms>=40)h.over40Ms++;if(ms>2000)h.overflow++;
  if(ms>=40){slow.push({name,ms,atMs:performance.now()-began});if(slow.length>128)slow.shift();}
 };
 for(const name of ['frame','snapshot','acknowledge']){
  const original=RenderHostClient.prototype[name];
  RenderHostClient.prototype[name]=function(...args){const start=performance.now();return original.apply(this,args).then(value=>{
   record(name==='frame'?(value.waiting?'host.frame.ready':'host.frame.empty'):'host.'+name,performance.now()-start);
   if(enabled&&name==='snapshot'){
    const count=value.properties['frame-drop-count'];
    if(count!==lastDrops){dropChanges.push({atMs:performance.now()-began,count});if(dropChanges.length>128)dropChanges.shift();lastDrops=count;}
   }
   return value;
  },error=>{record('host.'+name+'.failed',performance.now()-start);throw error;});};
 }
 const present=RenderTextureBridge.prototype.present;
 RenderTextureBridge.prototype.present=function(...args){const start=performance.now();return present.apply(this,args).then(value=>{record('texture.presentAndRelease',performance.now()-start);return value;},error=>{record('texture.presentAndRelease.failed',performance.now()-start);throw error;});};
 const pump=RenderPlayer.prototype.pump;
 RenderPlayer.prototype.pump=function(active){
  const now=performance.now(),previous=pumps.get(active);if(previous?.end!==undefined)record('pump.waitAfterTask',now-previous.end);
  const result=pump.call(this,active),task=active.poll;
  if(task&&task!==previous?.task){const row={task,end:undefined};pumps.set(active,row);void task.then(()=>{row.end=performance.now();record('pump.task',row.end-now);},()=>{row.end=performance.now();record('pump.task.failed',row.end-now);});}
  return result;
 };
 globalThis.__startPipelineTiming=()=>{
  if(highResolutionClock){
   // The session's RenderTextureBridge has already verified and loaded this
   // pinned FFI module. Only the current test Electron process requests it;
   // restore it before idle assessment, including the failure path.
   const {resolveRenderRuntime}=require(app.getAppPath()+'/electron/dist/renderRuntimeLayout.js');
   const layout=resolveRenderRuntime(app.getAppPath(),app.isPackaged,process.resourcesPath);
   const ffi=require(layout.ffiBase+'/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node');
   const mm=ffi.load('winmm.dll'),begin=mm.func('uint32_t __stdcall timeBeginPeriod(uint32_t)');clockEnd=mm.func('uint32_t __stdcall timeEndPeriod(uint32_t)');
   clock.beginResult=begin(1);if(clock.beginResult!==0)throw new Error('Test timer resolution request failed');
  }
  histograms.clear();slow=[];dropChanges=[];lastDrops=undefined;began=performance.now();delay.reset();if(eventLoop)delay.enable();enabled=true;
 };
 globalThis.__stopPipelineTiming=()=>{
  enabled=false;delay.disable();if(clockEnd&&clock.beginResult===0&&clock.endResult===null)clock.endResult=clockEnd(1);
  const percentile=(h,fraction)=>{const rank=Math.ceil(h.count*fraction);let sum=0;return h.bins.findIndex(value=>(sum+=value)>=rank)/10;};
  return {scope:'Test-only real main-process method observers; 0.1ms histogram bins capped at 2000ms; max/overflow retained; measured interval includes resume and final observation',elapsedMs:performance.now()-began,
   methods:Object.fromEntries([...histograms].map(([name,h])=>[name,{count:h.count,meanMs:h.sum/h.count,p50Ms:percentile(h,.5),p95Ms:percentile(h,.95),maxMs:h.max,over40Ms:h.over40Ms,overflow:h.overflow}])),
   eventLoop:eventLoop?{p50Ms:delay.percentile(50)/1e6,p95Ms:delay.percentile(95)/1e6,maxMs:delay.max/1e6}:null,clock,slow,dropChanges};
 };
};
