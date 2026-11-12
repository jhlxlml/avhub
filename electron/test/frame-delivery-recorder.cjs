// Test-only bounded recording. Never interpret a hint or a clock as scanout.
function createFrameDeliveryRecorder({capacity=2048,tailMs=1000,maxCaptures=4}={}){
 if(!Number.isInteger(capacity)||capacity<16||capacity>8192||!Number.isFinite(tailMs)||tailMs<0||tailMs>5000||!Number.isInteger(maxCaptures)||maxCaptures<1||maxCaptures>8)throw Error('Invalid recorder bounds');
 const ring=new Array(capacity),captures=[],worst={};let written=0,previousDrops=null,stopped=null;
 function record(entry){
  if(stopped)return;
  const end=entry.observedAt??entry.at+entry.ms;ring[written++%capacity]=entry;
  if(!worst[entry.kind]||entry.ms>worst[entry.kind].ms)worst[entry.kind]=entry;
  for(const capture of captures)if(!capture.complete&&end>capture.at){
   if(capture.after.length<capacity)capture.after.push(entry);else capture.truncated=true;
   if(end>=capture.at+tailMs)capture.complete=true;
  }
  if(entry.kind!=='snapshot'||!Number.isSafeInteger(entry.outputDrops)||entry.outputDrops<0)return;
  const delta=previousDrops===null?0:entry.outputDrops-previousDrops;previousDrops=entry.outputDrops;
  if(delta<=0)return;
  let slot=captures.length;
  if(slot>=maxCaptures){slot=captures.reduce((smallest,c,index)=>c.delta<captures[smallest].delta?index:smallest,0);if(delta<=captures[slot].delta)return;}
  const count=Math.min(written,capacity),start=written-count;
  captures[slot]={at:end,delta,outputDrops:entry.outputDrops,complete:tailMs===0,truncated:false,before:Array.from({length:count},(_,index)=>ring[(start+index)%capacity]),after:[]};
 }
 return {record,status:()=>({written,stored:Math.min(written,capacity),captures:captures.length}),stop:()=>stopped??(stopped={scope:'Bounded main-clock call intervals around observed counter growth; no exact drop timestamp or causal/scanout claim',capacity,tailMs,maxCaptures,written,worst,captures})};
}
async function installFrameDeliveryRecorder({app}){
 const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
 const {RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js'),{RenderTextureBridge}=require(app.getAppPath()+'/electron/dist/renderTexture.js');
 const recorder=createFrameDeliveryRecorder();
 const {PerformanceObserver,performance:nodePerformance}=require('node:perf_hooks'),{sharedTexture}=require('electron');
 const gc=new PerformanceObserver(list=>{for(const entry of list.getEntries())recorder.record({kind:'gc',at:entry.startTime,ms:entry.duration,observedAt:performance.now(),gcKind:entry.detail?.kind});});gc.observe({entryTypes:['gc']});
 let profiler=null,profileAnchor=null;const post=(method,params={})=>new Promise((resolve,reject)=>profiler.post(method,params,(error,value)=>error?reject(error):resolve(value)));
 if(process.env.AVHUB_TEST_CPU_PROFILE==='1'){const {Session}=require('node:inspector');profiler=new Session();profiler.connect();await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:10000});const before=performance.now();await post('Profiler.start');profileAnchor={before,after:performance.now(),samplingIntervalUs:10000};}
 let importId=0;
 const importTexture=sharedTexture.importSharedTexture;
 sharedTexture.importSharedTexture=function(options){const at=performance.now(),id=++importId,release=options.allReferencesReleased;const result=importTexture.call(this,{...options,allReferencesReleased:()=>{release();recorder.record({kind:'texture-all-released',at:performance.now(),ms:0,importId:id});}});const nativeRelease=result.subtle.release;
  result.subtle.release=function(callback){const began=performance.now();recorder.record({kind:'main-native-release-start',at:began,ms:0,importId:id,textureId:result.textureId});return nativeRelease.call(this,()=>{recorder.record({kind:'main-native-release-done',at:began,ms:performance.now()-began,importId:id,textureId:result.textureId});callback?.();});};
  recorder.record({kind:'texture-import',at,ms:performance.now()-at,importId:id,textureId:result.textureId});return result;};
 const sendTexture=sharedTexture.sendSharedTexture;
 sharedTexture.sendSharedTexture=function(...args){const at=performance.now();return sendTexture.apply(this,args).then(result=>{recorder.record({kind:'texture-send',at,ms:performance.now()-at});return result;},error=>{recorder.record({kind:'texture-send',at,ms:performance.now()-at,failed:true});throw error;});};
 for(const method of ['frame','snapshot','acknowledge','control','resources']){
  const original=RenderHostClient.prototype[method];
  RenderHostClient.prototype[method]=function(...args){const at=performance.now();return original.apply(this,args).then(result=>{
   recorder.record({kind:method,at,ms:performance.now()-at,...(method==='snapshot'?{outputDrops:result.properties['frame-drop-count'],decoderDrops:result.properties['decoder-frame-drop-count'],paused:result.properties.pause,seeking:result.properties.seeking}:method==='frame'?{waiting:result.waiting,serial:result.serial,seekId:result.seekId}:method==='control'?{action:args[0]}:{})});return result;
  },error=>{recorder.record({kind:method,at,ms:performance.now()-at,failed:true});throw error;});};
 }
 const present=RenderTextureBridge.prototype.present;
 RenderTextureBridge.prototype.present=function(...args){const at=performance.now();return present.apply(this,args).then(result=>{recorder.record({kind:'present',at,ms:performance.now()-at,gpuAt:result.gpuAt,serial:result.serial,position:result.positionSec,seekId:result.seekId});return result;},error=>{recorder.record({kind:'present',at,ms:performance.now()-at,failed:true});throw error;});};
 const metrics=app.getAppMetrics;
 app.getAppMetrics=function(){const at=performance.now(),result=metrics.call(this);recorder.record({kind:'app-metrics',at,ms:performance.now()-at});return result;};
 let previous=performance.now(),previousCpu=process.cpuUsage(),previousLoop=nodePerformance.eventLoopUtilization();const interval=setInterval(()=>{const now=performance.now(),cpu=process.cpuUsage(),loop=nodePerformance.eventLoopUtilization(),late=Math.max(0,now-previous-50);if(late>20)recorder.record({kind:'event-loop-late',at:previous+50,ms:late,mainCpuMs:(cpu.user+cpu.system-previousCpu.user-previousCpu.system)/1000,loopActiveMs:loop.active-previousLoop.active,loopIdleMs:loop.idle-previousLoop.idle});previous=now;previousCpu=cpu;previousLoop=loop;},50);interval.unref();
 let stopped;return {status:recorder.status,stop:()=>stopped??(stopped=(async()=>{clearInterval(interval);gc.disconnect();const result={...recorder.stop(),timeOrigin:performance.timeOrigin};if(!profiler)return result;try{const {profile}=await post('Profiler.stop');return {...result,cpuProfile:profile,profileAnchor};}finally{profiler.disconnect();}})())};
}
exports.createFrameDeliveryRecorder=createFrameDeliveryRecorder;
exports.installFrameDeliveryRecorder=installFrameDeliveryRecorder;
