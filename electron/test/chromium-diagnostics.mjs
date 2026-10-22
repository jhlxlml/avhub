// Pure lifecycle/privacy contract. Real desktop export is checked separately.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createContext,runInContext} from 'node:vm';
import {captureChromiumDiagnostics,safeGpu,safeDecoder,safeDisplay,diagnosticSummary} from '../dist/chromiumDiagnostics.js';

const secret='http://127.0.0.1:9999/media/42/file';
function fixture({busy=false,ambiguous=false,changed=false,paused=false,hung=false,mode='direct',noRequests=false}={}){
 const debug=new EventEmitter();let attached=busy,detaches=0,cleanups=0,reads=0;
 debug.isAttached=()=>attached;debug.attach=()=>{attached=true;};debug.detach=()=>{attached=false;detaches++;};
 debug.sendCommand=async command=>{
  if(command!=='Media.enable')return;
  for(let i=0;i<(ambiguous?2:1);i++)debug.emit('message',{},'Media.playerPropertiesChanged',{playerId:String(i),properties:[
   {name:'kVideoDecoderName',value:'D3D11VideoDecoder'},{name:'kIsPlatformVideoDecoder',value:'true'},
   {name:'kResolution',value:'1920x1080'},{name:'kFrameTitle',value:'PRIVATE TITLE'},
   {name:'kURL',value:ambiguous?'PRIVATE SOURCE':secret},
  ]});
 };
 const wc={debugger:debug,isDestroyed:()=>false,executeJavaScript:async code=>{
  if(code.includes('function beginObservation'))return secret;
  if(code.includes('function endObservation')){cleanups++;return;}
  if(hung)return new Promise(()=>{});
  if(changed&&reads>0)throw new Error('视频已切换');
  const n=reads++;
  if(n>0&&!noRequests)for(let i=0;i<2;i++){
   const requestId=`${n}-${i}`;
   debug.emit('message',{},'Network.requestWillBeSent',{requestId,request:{url:secret,headers:{Range:`bytes=${i?5*1024**3:0}-`}}});
   debug.emit('message',{},'Network.dataReceived',{requestId,dataLength:2048});
  }
  return {at:n*500,time:n*.5,rate:1,paused:paused&&n>0,seeking:false,ready:4,width:1920,height:1080,total:100+n*15,dropped:n,
   ahead:null,visible:true,error:null,events:{waiting:0,stalled:0,seeking:0,pause:paused?n:0,ratechange:0,loadstart:0},presented:n*14,callbacks:n*14,
   frameGapMs:{median:33.3,max:40},mode};
 }};
 return {wc,state:()=>({attached,detaches,cleanups,listeners:debug.listenerCount('message')})};
}
const deps={gpu:async()=>({gpuDevice:[{active:true,deviceString:'Intel(R) UHD Graphics 770',driverVersion:'32.0.1',description:'PRIVATE'}],privatePath:'E:/downloads/PRIVATE'}),features:()=>({video_decode:'enabled',private:'PRIVATE'}),build:{version:'test'},durationMs:100};
{
 const f=fixture(),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,deps);
 assert.equal(r.decoder.name,'D3D11VideoDecoder');assert.equal(r.decoder.platform,true);assert.equal(r.decoder.status,'identified');
 assert.equal(r.playback.clockRatio,1);assert.equal(r.playback.minBufferedAheadSeconds,null);assert.ok(r.playback.droppedFrames>=1);
 assert.equal(r.delivery.status,'observed');assert.ok(r.delivery.newRequests>=2);assert.ok(r.delivery.receivedBytes>=4096);assert.ok(r.delivery.offsetSwitchesOver64MiB>=1);
 assert.equal(r.schema,2);assert.equal(r.summary.droppedFramePercent,6.67);
 assert.deepEqual(f.state(),{attached:false,detaches:1,cleanups:1,listeners:0});
 for(const privateText of [secret,'PRIVATE','127.0.0.1','downloads'])assert.ok(!JSON.stringify(r).includes(privateText));
}
{
 const f=fixture({busy:true}),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,deps);
 assert.equal(r.decoder.status,'debugger-busy');assert.deepEqual(f.state(),{attached:true,detaches:0,cleanups:1,listeners:0});
 assert.equal(r.delivery.receivedBytes,null);assert.equal(r.delivery.rangeRequests,null);
}
{
 const f=fixture({mode:'remux'}),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,deps);
 assert.equal(r.delivery.status,'not-original-file');assert.equal(r.delivery.newRequests,null);assert.equal(r.delivery.receivedBytes,null);
 assert.ok(r.summary.observations.some(text=>text.includes('不是零读取')));
}
{
 const f=fixture({noRequests:true}),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,deps);
 assert.equal(r.delivery.status,'observed');assert.equal(r.delivery.newRequests,0);assert.equal(r.delivery.receivedBytes,0);
}
assert.equal(diagnosticSummary({totalFrames:0,droppedFrames:0,wallSeconds:0,presentedFrames:0},{status:'unavailable'}).droppedFramePercent,null);
{
 const f=fixture({ambiguous:true}),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,deps);
 assert.equal(r.decoder.status,'ambiguous');assert.equal(r.decoder.name,undefined);
}
{
 const f=fixture({paused:true}),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,deps);
 assert.equal(r.playback.clockRatio,null);assert.equal(r.playback.continuous,false);
}
{
 const f=fixture({changed:true});await assert.rejects(captureChromiumDiagnostics(f.wc,new AbortController().signal,deps),/视频已切换/);
 assert.equal(f.state().cleanups,1);assert.equal(f.state().detaches,1);
}
{
 const f=fixture(),cancel=new AbortController();setTimeout(()=>cancel.abort(),20);
 await assert.rejects(captureChromiumDiagnostics(f.wc,cancel.signal,deps),{name:'AbortError'});
 assert.equal(f.state().cleanups,1);assert.equal(f.state().detaches,1);
}
assert.equal(safeDecoder({kVideoDecoderName:'C:/PRIVATE/decoder.dll'}).name,null);
assert.equal(safeDecoder({kResolution:'1920x1080 PRIVATE'}).resolution,null);
assert.equal(safeGpu({gpuDevice:[{driverVersion:'C:/PRIVATE',deviceId:NaN}]},{}).devices[0].driver,null);
for(const withProcessing of [true,false]){
 // Execute the actual serialized renderer functions in a synthetic DOM.
 // Fast-forwarded callbacks exercise bounds/cleanup, not playback performance.
 const callbacks=new Map(),animations=new Map(),handlers=new Map();let next=0,clock=0,presented=0,cancelled=0;
 const video={currentSrc:secret,readyState:4,currentTime:0,playbackRate:1,paused:false,seeking:false,videoWidth:640,videoHeight:360,isConnected:true,
  buffered:{length:0},error:null,getBoundingClientRect:()=>({left:0,top:0,right:640,bottom:360}),
  getVideoPlaybackQuality:()=>({totalVideoFrames:presented,droppedVideoFrames:0}),
  addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(handlers.get(name),fn);handlers.delete(name);},
  requestVideoFrameCallback:fn=>{const id=++next;callbacks.set(id,fn);return id;},cancelVideoFrameCallback:id=>{callbacks.delete(id);cancelled++;}};
 const context=createContext({window:{},document:{visibilityState:'visible',querySelector:selector=>selector.includes('summary')?{textContent:'原文件直放'}:video},innerWidth:1000,innerHeight:800,performance:{now:()=>clock},
  requestAnimationFrame:fn=>{const id=++next;animations.set(id,fn);return id;},cancelAnimationFrame:id=>{animations.delete(id);cancelled++;}});
 const debug=new EventEmitter();debug.isAttached=()=>true;
 const wc={debugger:debug,isDestroyed:()=>false,executeJavaScript:async code=>{
  if(code.includes('function readObservation'))for(let n=0;n<5000;n++){
   clock++;video.currentTime=clock/1000;presented+=2;
   const [id,frame]=callbacks.entries().next().value;callbacks.delete(id);frame(clock,{presentedFrames:presented,expectedDisplayTime:clock,processingDuration:withProcessing ? .001 : undefined});
   const [animationId,animation]=animations.entries().next().value;animations.delete(animationId);animation(clock);
  }
  return runInContext(code,context);
 }};
 const r=await captureChromiumDiagnostics(wc,new AbortController().signal,deps);
 assert.equal(r.playback.scheduling.truncated,true);assert.equal(r.playback.scheduling.animationGapMs.count,4096);
 assert.equal(r.playback.scheduling.reportedProcessingMs.count,withProcessing?4096:0);assert.ok(r.playback.scheduling.missedFrameCallbacks>0);
 assert.equal(r.playback.scheduling.reportedProcessingMs.median,withProcessing?1:null);
 assert.deepEqual([callbacks.size,animations.size,handlers.size],[0,0,0]);assert.equal(cancelled,2);
 assert.equal(Object.keys(context.window).length,0);
}
assert.deepEqual(safeDisplay({displayFrequency:32,scaleFactor:2,size:{width:1440,height:900},id:'PRIVATE',label:'PRIVATE',bounds:{x:999,y:999}}),{reportedRefreshHz:32,scaleFactor:2,logicalSize:{width:1440,height:900}});
assert.deepEqual(safeDisplay({displayFrequency:0,scaleFactor:Infinity,size:{width:-1,height:999999}}),{reportedRefreshHz:null,scaleFactor:null,logicalSize:{width:null,height:null}});
{
 let reads=0;
 const f=fixture(),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,{...deps,display:()=>({displayFrequency:reads++?60:32,scaleFactor:2,size:{width:1440,height:900},label:'PRIVATE'})});
 assert.equal(reads,2);assert.equal(r.display.first.reportedRefreshHz,32);assert.equal(r.display.last.reportedRefreshHz,60);
 assert.ok(r.summary.observations.some(text=>text.includes('不是实测物理刷新率')));
 assert.ok(!JSON.stringify(r).includes('PRIVATE'));
}
{
 const f=fixture(),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,{...deps,display:()=>{throw new Error('PRIVATE');}});
 assert.equal(r.display.first.reportedRefreshHz,null);assert.equal(r.display.last.reportedRefreshHz,null);
}
{
 const f=fixture({hung:true});await assert.rejects(captureChromiumDiagnostics(f.wc,new AbortController().signal,deps),/播放页面响应超时/);
 assert.equal(f.state().cleanups,1);assert.equal(f.state().detaches,1);
}
console.log('Chromium diagnostic contracts passed: bounded/manual capture, privacy, decoder ambiguity, pause, cancellation, source change and debugger ownership.');
