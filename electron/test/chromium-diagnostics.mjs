// Pure lifecycle/privacy contract. Real desktop export is checked separately.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {captureChromiumDiagnostics,safeGpu,safeDecoder} from '../dist/chromiumDiagnostics.js';

const secret='http://127.0.0.1:9999/media/42/file';
function fixture({busy=false,ambiguous=false,changed=false,paused=false,hung=false}={}){
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
  if(n>0)for(let i=0;i<2;i++){
   const requestId=`${n}-${i}`;
   debug.emit('message',{},'Network.requestWillBeSent',{requestId,request:{url:secret,headers:{Range:`bytes=${i?5*1024**3:0}-`}}});
   debug.emit('message',{},'Network.dataReceived',{requestId,dataLength:2048});
  }
  return {at:n*500,time:n*.5,rate:1,paused:paused&&n>0,seeking:false,ready:4,width:1920,height:1080,total:100+n*15,dropped:n,
   ahead:null,visible:true,error:null,events:{waiting:0,stalled:0,seeking:0,pause:paused?n:0,ratechange:0,loadstart:0},presented:n*14,callbacks:n*14,
   frameGapMs:{median:33.3,max:40},mode:'direct'};
 }};
 return {wc,state:()=>({attached,detaches,cleanups,listeners:debug.listenerCount('message')})};
}
const deps={gpu:async()=>({gpuDevice:[{active:true,deviceString:'Intel(R) UHD Graphics 770',driverVersion:'32.0.1',description:'PRIVATE'}],privatePath:'E:/downloads/PRIVATE'}),features:()=>({video_decode:'enabled',private:'PRIVATE'}),build:{version:'test'},durationMs:100};
{
 const f=fixture(),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,deps);
 assert.equal(r.decoder.name,'D3D11VideoDecoder');assert.equal(r.decoder.platform,true);assert.equal(r.decoder.status,'identified');
 assert.equal(r.playback.clockRatio,1);assert.equal(r.playback.minBufferedAheadSeconds,null);assert.ok(r.playback.droppedFrames>=1);
 assert.equal(r.delivery.status,'observed');assert.ok(r.delivery.newRequests>=2);assert.ok(r.delivery.receivedBytes>=4096);assert.ok(r.delivery.offsetSwitchesOver64MiB>=1);
 assert.deepEqual(f.state(),{attached:false,detaches:1,cleanups:1,listeners:0});
 for(const privateText of [secret,'PRIVATE','127.0.0.1','downloads'])assert.ok(!JSON.stringify(r).includes(privateText));
}
{
 const f=fixture({busy:true}),r=await captureChromiumDiagnostics(f.wc,new AbortController().signal,deps);
 assert.equal(r.decoder.status,'debugger-busy');assert.deepEqual(f.state(),{attached:true,detaches:0,cleanups:1,listeners:0});
}
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
{
 const f=fixture({hung:true});await assert.rejects(captureChromiumDiagnostics(f.wc,new AbortController().signal,deps),/播放页面响应超时/);
 assert.equal(f.state().cleanups,1);assert.equal(f.state().detaches,1);
}
console.log('Chromium diagnostic contracts passed: bounded/manual capture, privacy, decoder ambiguity, pause, cancellation, source change and debugger ownership.');
