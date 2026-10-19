import type {WebContents} from 'electron';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const label=(value:unknown,max=96)=>typeof value==='string'&&value.length<=max&&/^[\w ().,+@-]+$/.test(value)?value:null;
export function safeGpu(info:any,features:any){
 const aux=info?.auxAttributes;
 return {features:Object.fromEntries(['video_decode','gpu_compositing','rasterization'].map(k=>[k,label(features?.[k])])),
  devices:(Array.isArray(info?.gpuDevice)?info.gpuDevice:[]).slice(0,8).map((d:any)=>({active:d.active===true,vendorId:number(d.vendorId),deviceId:number(d.deviceId),name:label(d.deviceString),driver:label(d.driverVersion)})),
  directComposition:typeof aux?.overlayInfo?.directComposition==='boolean'?aux.overlayInfo.directComposition:null,
  supportsOverlays:typeof aux?.overlayInfo?.supportsOverlays==='boolean'?aux.overlayInfo.supportsOverlays:null,
  sandboxed:typeof aux?.sandboxed==='boolean'?aux.sandboxed:null};
}
export function safeDecoder(properties:Record<string,unknown>){
 const platform=properties.kIsPlatformVideoDecoder;
 const resolution=properties.kResolution;
 return {name:label(properties.kVideoDecoderName,64),platform:platform==='true'?true:platform==='false'?false:null,
  resolution:typeof resolution==='string'&&/^\d{1,5}x\d{1,5}$/.test(resolution)?resolution:null};
}

// These functions run only during an explicitly requested eight-second capture.
// No screenshots/readback, source replacement or preference writes. No sampling
// work is scheduled outside this explicit bounded capture.
function beginObservation(key:string){
 const v=document.querySelector<HTMLVideoElement>('.player-shell video');
 if(!v||!v.currentSrc||v.readyState<2)throw new Error('请先打开现有播放器的视频，再采集播放诊断');
 const source=v.currentSrc,mode=document.querySelector('.playback-diagnostics summary')?.textContent??'';
 const state:any={v,source,mode,key,events:{waiting:0,stalled:0,seeking:0,pause:0,ratechange:0,loadstart:0},handlers:[],callback:null,firstPresented:null,lastPresented:null,lastFrameAt:null,gapMax:0,gaps:[],frames:0,closed:false};
 for(const name of Object.keys(state.events)){
  const handler=()=>state.events[name]++;v.addEventListener(name,handler);state.handlers.push([name,handler]);
 }
 const frame=(now:number,data:VideoFrameCallbackMetadata)=>{
  if(state.closed)return;
  state.firstPresented??=data.presentedFrames;state.lastPresented=data.presentedFrames;state.frames++;
  if(state.lastFrameAt!==null){const gap=now-state.lastFrameAt;state.gapMax=Math.max(state.gapMax,gap);if(state.gaps.length<2048)state.gaps.push(gap);}
  state.lastFrameAt=now;state.callback=v.requestVideoFrameCallback(frame);
 };
 if(v.requestVideoFrameCallback)state.callback=v.requestVideoFrameCallback(frame);
 (window as any)[key]=state;
 return source;
}
function readObservation(key:string){
 const s=(window as any)[key];if(!s)throw new Error('播放诊断已结束');
 const v=s.v as HTMLVideoElement;if(!v.isConnected||v.currentSrc!==s.source)throw new Error('视频已切换，请在当前视频上重新采集');
 const q=v.getVideoPlaybackQuality?.();let ahead:number|null=null;
 for(let n=0;n<v.buffered.length;n++)if(v.currentTime>=v.buffered.start(n)&&v.currentTime<=v.buffered.end(n))ahead=v.buffered.end(n)-v.currentTime;
 const gaps=s.gaps.slice().sort((a:number,b:number)=>a-b);
 const bounds=v.getBoundingClientRect(),inViewport=bounds.right>0&&bounds.bottom>0&&bounds.left<innerWidth&&bounds.top<innerHeight;
 return {at:performance.now(),time:v.currentTime,rate:v.playbackRate,paused:v.paused,seeking:v.seeking,ready:v.readyState,
  width:v.videoWidth,height:v.videoHeight,total:q?.totalVideoFrames??null,dropped:q?.droppedVideoFrames??null,
  ahead,visible:document.visibilityState==='visible'&&inViewport,error:v.error?.code??null,events:{...s.events},
  presented:typeof v.requestVideoFrameCallback==='function'?(s.lastPresented===null?0:s.lastPresented-s.firstPresented+1):null,callbacks:s.frames,
  frameGapMs:{median:gaps.length?gaps[Math.floor(gaps.length/2)]:null,max:s.lastFrameAt===null?null:s.gapMax},
  mode:s.mode.includes('原文件直放')?'direct':s.mode.includes('无损优化副本')?'prepared':s.mode.includes('转码')?'transcode':s.mode.includes('封装')||s.mode.includes('索引')?'remux':'unknown'};
}
function endObservation(key:string){
 const s=(window as any)[key];if(!s)return;
 s.closed=true;for(const [name,handler] of s.handlers)s.v.removeEventListener(name,handler);
 if(s.callback!==null)s.v.cancelVideoFrameCallback?.(s.callback);delete (window as any)[key];
}
type CaptureDependencies={gpu:()=>Promise<unknown>;features:()=>unknown;build:unknown;durationMs?:number};
export async function captureChromiumDiagnostics(contents:WebContents,signal:AbortSignal,deps:CaptureDependencies){
 const duration=deps.durationMs??8000;if(duration<100||duration>10000)throw new Error('诊断时长无效');
 const key=`__avhubPlaybackDiagnostic_${randomBytes(12).toString('hex')}`;
 const run=async<T>(fn:Function,cleaning=false):Promise<T>=>{
  if(!cleaning)signal.throwIfAborted();
  const deadline=new AbortController(),relay=()=>deadline.abort(signal.reason);
  if(!cleaning)signal.addEventListener('abort',relay,{once:true});
  try{
   return await Promise.race([
    contents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(key)})`,false) as Promise<T>,
    delay(cleaning?500:2500,undefined,{signal:deadline.signal}).then(()=>{throw new Error('播放页面响应超时，已停止诊断，请稍后重试');}),
   ]);
  }finally{deadline.abort();if(!cleaning)signal.removeEventListener('abort',relay);}
 };
 const players=new Map<string,{properties:Record<string,unknown>;matches:boolean;destroyed:boolean}>();
 let owned=false,decoderStatus='unavailable',source='',networkEnabled=false,collecting=false,lastByteOffset:number|null=null;
 const requests=new Set<string>();
 const network={newRequests:0,rangeRequests:0,receivedBytes:0,offsetSwitchesOver64MiB:0,truncated:false};
 const listener=(_event:unknown,method:string,params:any)=>{
  if(collecting&&method==='Network.requestWillBeSent'&&params.request?.url===source&&typeof params.requestId==='string'){
   network.newRequests++;
   if(requests.size<4096)requests.add(params.requestId);else network.truncated=true;
   const headers=params.request.headers??{},range=headers.Range??headers.range;
   if(typeof range==='string'){
    network.rangeRequests++;const match=/^bytes=(\d+)-/.exec(range);
    if(match){const offset=Number(match[1]);if(Number.isSafeInteger(offset)){
     if(lastByteOffset!==null&&Math.abs(offset-lastByteOffset)>64*1024**2)network.offsetSwitchesOver64MiB++;
     lastByteOffset=offset;
    }}
   }
  }
  if(collecting&&method==='Network.dataReceived'&&requests.has(params.requestId))network.receivedBytes+=number(params.dataLength)??0;
  if(method==='Media.playerPropertiesChanged'&&typeof params.playerId==='string'){
   if(!players.has(params.playerId)&&players.size<32)players.set(params.playerId,{properties:{},matches:false,destroyed:false});
   const p=players.get(params.playerId);if(!p)return;
   for(const item of Array.isArray(params.properties)?params.properties:[]){
    // URLs exist only in this comparison; never copy them into public state.
    if((item.name==='kURL'||item.name==='url')&&item.value===source)p.matches=true;
    if(['kVideoDecoderName','kIsPlatformVideoDecoder','kResolution'].includes(item.name))p.properties[item.name]=typeof item.value==='string'&&item.value.length<=128?item.value:null;
   }
  }
  if(method==='Media.playerEventsAdded'){
   const p=players.get(params.playerId);
   if(p&&(params.events??[]).some((event:any)=>typeof event.value==='string'&&event.value.includes('kWebMediaPlayerDestroyed')))p.destroyed=true;
  }
 };
 try{
  signal.throwIfAborted();source=await run<string>(beginObservation);signal.throwIfAborted();
  if(!contents.debugger.isAttached()){
   try{contents.debugger.attach('1.3');owned=true;contents.debugger.on('message',listener);await contents.debugger.sendCommand('Media.enable');decoderStatus='observing';
    try{await contents.debugger.sendCommand('Network.enable');networkEnabled=true;}catch{}
   }
   catch{decoderStatus='unavailable';}
  }else decoderStatus='debugger-busy';
  const first=await run<any>(readObservation),samples:any[]=[];const began=performance.now();collecting=true;
  while(performance.now()-began<duration){
   await delay(Math.min(500,duration-(performance.now()-began)),undefined,{signal});signal.throwIfAborted();
   samples.push(await run<any>(readObservation));
  }
  collecting=false;const last=samples.at(-1);if(!last)throw new Error('播放诊断尚未取得数据');
  const continuous=!first.paused&&!first.seeking&&samples.every(s=>!s.paused&&!s.seeking&&s.rate===first.rate&&s.visible&&!s.error)&&
   ['pause','seeking','ratechange','loadstart'].every(k=>last.events[k]===first.events[k]);
  const elapsed=(last.at-first.at)/1000,advance=last.time-first.time;
  const active=[...players.values()].filter(p=>!p.destroyed&&safeDecoder(p.properties).name),matching=active.filter(p=>p.matches);
  const candidates=matching.length?matching:active,decoder=candidates.length===1?safeDecoder(candidates[0].properties):null;
  const info=await Promise.race([deps.gpu().catch(()=>null),delay(2500, null, {signal})]);signal.throwIfAborted();
  const delta=(k:string)=>number(first[k])!==null&&number(last[k])!==null?Math.max(0,last[k]-first[k]):null;
  const ahead=samples.map(s=>number(s.ahead)).filter((n):n is number=>n!==null);
  return {schema:1,capturedAt:new Date().toISOString(),engine:'chromium',build:deps.build,
   runtime:{electron:process.versions.electron??null,chromium:process.versions.chrome??null,platform:process.platform,arch:process.arch},
   gpu:safeGpu(info,deps.features()),decoder:{status:decoder?'identified':candidates.length>1?'ambiguous':decoderStatus,...decoder},
   delivery:{status:networkEnabled&&first.mode==='direct'?'observed':first.mode!=='direct'?'not-original-file':'unavailable',...network},
   playback:{mode:last.mode,resolution:{width:last.width,height:last.height},rate:last.rate,continuous,wallSeconds:elapsed,
    clockSeconds:advance,clockRatio:continuous&&elapsed>0?advance/elapsed:null,totalFrames:delta('total'),droppedFrames:delta('dropped'),
    presentedFrames:delta('presented'),frameCallbacks:delta('callbacks'),frameGapMs:last.frameGapMs,
    minBufferedAheadSeconds:ahead.length?Math.min(...ahead):null,
    events:Object.fromEntries(Object.keys(last.events).map(k=>[k,Math.max(0,last.events[k]-first.events[k])])),visible:samples.every(s=>s.visible)},
   limitations:['Manual bounded diagnostic, not a repair or a guarantee of smooth playback.','Clock ratio omitted after pause/seek/rate/source changes; frame counts can include seek effects.',
    'A decoder is reported only for one matching/remaining candidate; GPU feature support alone is not per-file decoder proof.',
    'Delivery counts cover newly observed requests during capture, not earlier in-flight bytes or physical disk I/O.',
    'No source path, title, URL, audio device ID, pixels or preferences are exported. Physical sound/HDR appearance are not verified.']};
 }finally{
  if(!contents.isDestroyed())await run(endObservation,true).catch(()=>{});
  if(owned){contents.debugger.removeListener('message',listener);try{contents.debugger.detach();}catch{}}
 }
}
