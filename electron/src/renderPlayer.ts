import {prepareNativeShaderCache} from './nativeShaderCache';
import {app,BrowserWindow,dialog,type IpcMainInvokeEvent} from 'electron';
import {existsSync} from 'node:fs';import {realpath,stat} from 'node:fs/promises';import {randomBytes} from 'node:crypto';import path from 'node:path';
import {RenderHostClient,verifyRenderRuntime,type NativeRenderSnapshot} from './renderHostClient';
import {RenderTextureBridge} from './renderTexture';
import {resolveRenderRuntime} from './renderRuntimeLayout';
import type {renderHostTermination} from './renderHostTermination';
import {captureNativeFrame} from './nativeCapture';
import {nativeTrackChoice,rememberedTrack,type MediaPlaybackState} from './nativeTrackMemory';
import {subtitleStyle,defaultSubtitleAppearance} from './nativeSubtitle';
type Deps={root:string;origin:()=>string;token:()=>string;data:()=>string;main:()=>BrowserWindow|null;log:(s:string)=>void;mode:(v:any)=>unknown;windowAction:(v:string)=>unknown;settled:()=>Promise<void>;windowState:()=>{purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean}};
import {MpvSeekEvidence,type SeekPolicy,type SeekDiagnostics} from './mpvClient';
type RenderActivity={owner:string;media_id:number;present:boolean;playing:boolean;preparing:boolean};
type Active={shaderCache?:string;session:string;generation:number;mediaId:number;owner:string;surface:string;web:Electron.WebContents;client:RenderHostClient;bridge?:RenderTextureBridge;releaseWindowClock?:()=>void;sourceColor?:Record<string,unknown>;videoSize?:{width:number;height:number};title:string;props:Record<string,any>;revision:number;closing:boolean;error:string;saveError:string;timer?:ReturnType<typeof setTimeout>;heartbeat?:ReturnType<typeof setInterval>;poll?:Promise<void>;saving?:Promise<void>;closingTask?:Promise<void>;capture?:Promise<unknown>;opened:number;firstFrameDeadline:number;firstFrame:number|null;presented?:{serial:number;positionSec:number;seekId:number};pendingSeek:number|null;seekTarget:number|null;lastSnapshot:number;seekStarted:number;seekInputMs?:number|null;seekDistance?:number;seekPlaying?:boolean;seekEvidence?:MpvSeekEvidence;seekDispatch?:Promise<void>;seekRequestedAt?:number;seekPolicy?:SeekPolicy;seekStrategy?:'exact'|'keyframe';seekDiagnostics?:SeekDiagnostics&{seekId:number;correctionMs:number|null};lastSeek:number|null;lastFrame:number;intent:boolean;ended:boolean;memory:MediaPlaybackState|null;dirtyMemory:boolean;prefs:Record<string,any>;dirty:number;saved:number;rotation:number;transform:{zoom:number;x:number;y:number}};
const number=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const commands=new Set(['play','pause','seek','cancel-seek','volume','mute','rate','track','subtitle-delay']);

/** Desktop owner of the source lease, helper and texture readers. Still opt-in:
 * no production packaging/default-selection policy is changed by this service. */
export class RenderPlayer {
 private active:Active|null=null;private opening:Promise<any>|null=null;private attached:{web:Electron.WebContents;surface:string}|null=null;
 private retired=new Map<string,number>();
 private retiring:Promise<void>|null=null;
 private activityWrites=new WeakMap<Active,Promise<void>>();
 private activityWanted=new WeakMap<Active,RenderActivity>();
 private activityState=new WeakMap<Active,string>();
 constructor(private deps:Deps){}
 async prepareRuntime(){
  if(this.active||this.opening)return;
  const prefs=await this.api('/api/preferences');
  if(prefs.values?.playerEngine!=='mpv'||prefs.values?.nativeRenderEnabled!==true||this.active||this.opening)return;
  const began=performance.now();await verifyRenderRuntime(this.runtime());
  this.deps.log('render-runtime-prepared '+JSON.stringify({ms:performance.now()-began}));
 }
 retireRenderer(web:Electron.WebContents){
  if(this.retiring)return this.retiring;
  const task=(async()=>{await this.opening?.catch(()=>{});const a=this.active;if(a?.web===web){a.bridge?.invalidateReceiver();await this.close(a);}if(this.attached?.web===web)this.attached=null;})();this.retiring=task;void task.finally(()=>{if(this.retiring===task)this.retiring=null;}).catch(()=>this.deps.log('render-renderer-retirement-pending'));return task;
 }
 surfaceFailure(event:Electron.IpcMainEvent,value:any){const a=this.active;if(!a||event.sender!==a.web||event.senderFrame!==a.web.mainFrame||value?.surface!==a.surface||a.closing)return;this.failOutput(a,'原生画面设备异常，请重试或切换现有播放器');}
 private failOutput(a:Active,message:string){
  if(a.closing||this.active!==a)return;a.bridge?.setClockActive(false);if(!a.error)a.error=message;this.publish(a);
  // Read the real paused properties after the acknowledgement. Keeping the
  // last playing snapshot here leaves both controls and engine handoff stale.
  void a.client.control('pause').then(()=>a.client.snapshot()).then(s=>{if(!a.closing&&this.active===a){a.props=s.properties;this.publish(a);}}).catch(()=>{});
 }
 private trusted(event:IpcMainInvokeEvent){const main=this.deps.main();if(!main||main.isDestroyed()||event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame||new URL(event.senderFrame.url).origin!==this.deps.origin())throw new Error('原生播放请求来源无效');return main;}
 private packagedRuntime:ReturnType<typeof resolveRenderRuntime>|null=null;
 private runtime(){if(app.isPackaged)return this.packagedRuntime??=resolveRenderRuntime(this.deps.root,true,process.resourcesPath);return resolveRenderRuntime(this.deps.root,false,process.resourcesPath);}
 private async api(route:string,method='GET',body?:unknown){const r=await fetch(this.deps.origin()+route,{method,headers:{'X-AVHub-Token':this.deps.token(),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('本地播放服务响应异常');const result=await r.json() as any;if(!r.ok)throw new Error(result.detail||'本地播放请求失败');return result;}
 async invoke(event:IpcMainInvokeEvent,action:unknown,input:unknown){
  const main=this.trusted(event);
  if(action==='status'){const r=this.runtime();return {runtime:r.replayedCandidate?'发行同系 libmpv · D3D11':r.selfBuiltCandidate?'自建 libmpv · D3D11':'开发 libmpv · D3D11',available:(!app.isPackaged||r.localAcceptance||r.desktopEnabled)&&process.platform==='win32'&&[r.host,r.dll,r.manifest].every(existsSync),packaged:app.isPackaged,active:!!this.active,scope:r.desktopEnabled?'桌面原生嵌入；由用户选择启用':'原生嵌入试验；不改变默认引擎'};}
  if(action==='recover'){if(!object(input)||typeof input.surface!=='string')throw new Error('原生恢复表面无效');await this.opening?.catch(()=>{});if(this.active){if(this.active.surface!==input.surface)throw new Error('旧表面不能关闭新会话');await this.close(this.active);}return {ok:true};}
  if(app.isPackaged&&!this.runtime().localAcceptance&&!this.runtime().desktopEnabled)throw new Error('当前桌面包未包含可启用的原生嵌入运行库');
  if(action==='attach'){await this.retiring;if(this.active||this.opening||this.attached)throw new Error('请先关闭当前原生画面');if(typeof input!=='string'||!/^avhub-render-[a-f0-9-]{36}$/.test(input))throw new Error('原生表面标识无效');this.attached={web:event.sender,surface:input};return {ok:true};}
  if(action==='detach'){if(this.active||this.opening)throw new Error('原生播放尚未释放');if(!this.attached||this.attached.web!==event.sender||this.attached.surface!==input)throw new Error('原生表面已过期');this.attached=null;return {ok:true};}
  if(action==='open'){
   if(this.active||this.opening)throw new Error('请先关闭当前原生播放器');if(!this.attached||this.attached.web!==event.sender||!object(input)||!Number.isSafeInteger(input.mediaId)||input.mediaId<1||!Number.isSafeInteger(input.generation)||input.generation<1||!number(input.startSec,0,Number.MAX_VALUE)||typeof input.autoplay!=='boolean')throw new Error('原生播放参数无效');
   const task=this.start(main,{...input},this.attached.surface);this.opening=task;try{return await task;}finally{if(this.opening===task)this.opening=null;}
  }
  if(action==='close'&&object(input)&&this.retired.get(input.session)===input.generation)return {ok:true};
  const a=this.active;if(!a||!object(input)||input.session!==a.session||input.generation!==a.generation)throw new Error('原生播放会话已过期');
  if(action==='close'){await this.close(a);return {ok:true};}
  if(action==='snapshot')return this.view(a);
  if(action==='flush'){await this.save(a);return {ok:true};}
  if(a.closing)throw new Error('原生播放正在关闭');
  if(action==='seek-policy'){
   if(input.value!=='exact'&&input.value!=='fast'&&input.value!=='smart')throw new Error('跳播模式无效');
   a.seekPolicy=input.value;this.publish(a);return {ok:true};
  }
  if(action==='command'){
   if(a.error)throw new Error('原生画面异常，请重试播放或切换现有播放器');
   if(!commands.has(input.action)||a.capture)throw new Error('原生操作无效或截图正在保存');
   if(input.action==='play')a.intent=true;if(input.action==='pause'){a.intent=false;a.bridge?.setClockActive(false);}
   // GPU initialization must not consume the beginning of the source or let
   // audio run ahead. A pre-first-frame play is intent, not a decoder start.
   if(input.action==='play'&&(a.firstFrame===null||a.pendingSeek!==null)){this.publish(a);return {ok:true};}
   if(input.action==='cancel-seek'){
    if(!object(input.value)||!Number.isSafeInteger(input.value.seekId)||input.value.seekId<1)throw new Error('原生跳播参数无效');
    const id=input.value.seekId;if(a.pendingSeek!==id)return {ok:true};
    try{await a.client.control('cancel-seek',{seekId:id});if(a.pendingSeek===id&&!a.closing&&!a.error){const snapshot=await a.client.snapshot();if(snapshot.error)throw new Error(snapshot.error);a.props=snapshot.properties;if(a.pendingSeek===id&&a.intent&&snapshot.properties.pause===true){await this.resume(a);}if(a.pendingSeek===id){a.pendingSeek=null;a.seekTarget=null;this.publish(a);}}}catch(error){this.failOutput(a,'跳播恢复失败，请重试或切换现有播放器');throw error;}return {ok:true};
   }
   if(input.action==='seek'){
    if(!object(input.value)||!Number.isSafeInteger(input.value.seekId)||input.value.seekId<1||!number(input.value.seconds,0,Number.MAX_VALUE))throw new Error('原生跳播参数无效');
    const id=input.value.seekId;a.pendingSeek=id;a.seekTarget=input.value.seconds;a.seekRequestedAt=performance.now();
    const {seconds}=input.value,distance=Math.abs(seconds-Number(a.props['time-pos']||0));
    const playing=a.intent&&a.props.pause===false;
    const strategy=a.seekPolicy==='fast'||a.seekPolicy==='smart'&&playing&&distance>=10&&a.seekEvidence?.prefersKeyframes?'keyframe':'exact';
    const inputAt=number(input.inputAt,Date.now()-30000,Date.now()+100)?input.inputAt:null;
    a.seekStrategy=strategy;a.seekDistance=distance;a.seekPlaying=playing;
    this.publish(a);
    if(a.seekDispatch)await a.seekDispatch.catch(()=>{});
    if(a.pendingSeek!==id||a.closing||a.error)return {ok:true};
    a.seekStarted=performance.now();a.seekInputMs=inputAt===null?null:Math.max(0,Date.now()-inputAt);
    const dispatch=a.client.control(input.action,{seekId:id,seconds,keyframe:strategy==='keyframe'}).then(()=>{});
    a.seekDispatch=dispatch;
    try{await dispatch;}catch(error){if(a.pendingSeek===id){a.pendingSeek=null;a.seekTarget=null;this.publish(a);if(a.intent&&!a.closing&&!a.error)await this.resume(a).catch(()=>{});}throw error;}finally{if(a.seekDispatch===dispatch)a.seekDispatch=undefined;}
   }else {if(input.action==='play')await this.resume(a);else await a.client.control(input.action,input.value);if(input.action==='pause'){const snapshot=await a.client.snapshot();if(snapshot.error)throw new Error(snapshot.error);a.props=snapshot.properties;}if(input.action==='pause'||input.action==='play')this.publish(a);}
   if(input.action==='volume'){a.prefs.audio={...a.prefs.audio,volume:input.value};a.dirty++;}if(input.action==='mute'){a.prefs.audio={...a.prefs.audio,muted:input.value};a.dirty++;}if(input.action==='rate'){a.prefs.playbackSpeed=input.value;a.dirty++;}
   if(a.memory&&input.action==='track'){const kind=input.value.type==='audio'?'audio':'sub',choice=rememberedTrack(a.props['track-list']??[],kind,input.value.id===null?'no':Number(input.value.id));if(choice!==undefined){if(kind==='audio')a.memory.audio=choice as number;else a.memory.subtitle=choice as string;a.dirtyMemory=true;}}
   if(a.memory&&input.action==='subtitle-delay'){a.memory.delay=input.value;a.dirtyMemory=true;}return {ok:true};
  }
  if(action==='screenshot'){
   if(a.capture||a.pendingSeek!==null||!a.presented)throw new Error('画面尚未就绪或正在截图');
   const client={snapshot:{phase:a.error?'error':'ready',pendingSeek:a.pendingSeek,properties:a.props},command:async(args:any[])=>{if(args[0]==='get_property'&&args[1]==='time-pos'){const fresh=await a.client.snapshot();if(fresh.error||fresh.properties.seeking===true||fresh.properties['avhub-subtitle-refresh']===true)throw new Error('画面仍在定位或源参数已变化，请稍后截图');return fresh.properties['time-pos'];}if(args[0]==='screenshot-to-file'&&args[2]==='video')return a.client.captureOwnedPng(args[1]);throw new Error('截图命令无效');}};
   const task=captureNativeFrame(this.deps,{client,mediaId:a.mediaId});a.capture=task;try{return await task;}finally{a.capture=undefined;}
  }
  if(action==='subtitle-style'){if(a.capture)throw new Error('截图正在保存');const value=subtitleStyle(input.value);await a.client.setSubtitleStyle(value);a.prefs.subtitleAppearance=value;a.dirty++;this.publish(a);return {ok:true};}
  if(action==='subtitle-import'){
   if(a.capture)throw new Error('截图正在保存');const choice=await dialog.showOpenDialog(main,{properties:['openFile'],filters:[{name:'字幕',extensions:['srt','ass','ssa','vtt','sup']}]});if(choice.canceled)return {cancelled:true};if(this.active!==a||a.closing)throw new Error('原生会话已关闭');const file=await realpath(choice.filePaths[0]);if(path.extname(file).toLowerCase()!=='.sup'&&(await stat(file)).size>16*1024**2)throw new Error('文字字幕超过 16 MiB，无法导入');await a.client.addAuthorizedSubtitle(file);const media=await this.api(`/api/media/${a.mediaId}`),known=media.external_subtitles?.find((s:any)=>path.resolve(s.path).toLowerCase()===file.toLowerCase());if(known&&a.memory){a.memory.subtitle=known.path;a.dirtyMemory=true;return {memory:'saved'};}return {memory:'session'};
  }
  if(action==='transform'){if(!object(input.value)||!number(input.value.zoom,0,3)||!number(input.value.x,-4,4)||!number(input.value.y,-4,4))throw new Error('画面变换参数无效');a.transform={zoom:input.value.zoom,x:input.value.x,y:input.value.y};this.publish(a);return {ok:true};}
  if(action==='rotate'){if(![0,90,180,270].includes(input.value))throw new Error('旋转角度无效');a.rotation=input.value;await this.fit(a);this.publish(a);return {ok:true};}
  if(action==='window'){
   const v=input.value;if(['minimize','maximize','close'].includes(v))this.deps.windowAction(v);else if(v==='fullscreen')main.setFullScreen(!main.isFullScreen());else if(v==='pin')this.deps.mode({alwaysOnTop:!main.isAlwaysOnTop()});else if(v==='pure'){this.deps.mode({purePlayback:!this.deps.windowState().purePlayback});await this.fit(a);}else throw new Error('窗口操作无效');if(v!=='close'){this.deps.mode({});await this.deps.settled();this.publish(a);}return {ok:true};
  }
  throw new Error('未支持的原生操作');
 }
 private async start(main:BrowserWindow,input:Record<string,any>,surface:string){
  let a!:Active;const client=new RenderHostClient(this.runtime(),{drain:async()=>{await a.bridge?.drain();}});
  client.on('diagnostic',(value:ReturnType<typeof renderHostTermination>)=>this.deps.log('render-host-exit '+JSON.stringify(value)));
  a={session:randomBytes(16).toString('hex'),owner:randomBytes(16).toString('hex'),mediaId:input.mediaId,generation:input.generation,surface,web:main.webContents,client,title:'',props:{},revision:0,closing:false,error:'',saveError:'',opened:performance.now(),firstFrameDeadline:0,firstFrame:null,pendingSeek:null,seekTarget:null,lastSnapshot:0,seekStarted:0,lastSeek:null,lastFrame:0,intent:input.autoplay,ended:false,memory:null,dirtyMemory:false,prefs:{},dirty:0,saved:0,rotation:0,transform:{zoom:0,x:0,y:0}};this.active=a;
  try{
   const source=await this.api(`/api/media/${a.mediaId}/native-read`,'POST',{owner:a.owner,engine:'render-d3d11'});a.sourceColor=source.color;a.title=source.title;
   const prefs=await this.api('/api/preferences');a.seekPolicy=prefs.values?.mpvSeekPolicy??'exact';a.memory=await this.api(`/api/media/${a.mediaId}/playback-state`);a.prefs={audio:prefs.values?.audio??{volume:1,muted:false},playbackSpeed:prefs.values?.playbackSpeed??1,subtitleAppearance:prefs.values?.subtitleAppearance??defaultSubtitleAppearance};
   const shaderCache=await prepareNativeShaderCache(this.deps.data()).catch(()=>{this.deps.log('render-shader-cache-unavailable');return undefined;});
   a.shaderCache=shaderCache;const hwnd=main.getNativeWindowHandle();await client.open({shaderCache,path:source.path,startSec:input.startSec,autoplay:false,windowHandle:(hwnd.length===8?hwnd.readBigUInt64LE():BigInt(hwnd.readUInt32LE())).toString()});

   await client.control('volume',a.prefs.audio.volume);await client.control('mute',a.prefs.audio.muted);await client.control('rate',a.prefs.playbackSpeed);await client.setSubtitleStyle(subtitleStyle(a.prefs.subtitleAppearance));
   const deadline=Date.now()+30000;let s:NativeRenderSnapshot;do{s=await client.snapshot();if(s.error)throw new Error(s.error);if(s.loaded)break;const frame=s.frame;if(frame.waiting)await client.acknowledge(frame.serial);await new Promise(r=>setTimeout(r,15));}while(Date.now()<deadline);if(!s.loaded)throw new Error('原生媒体未能在期限内载入');a.props=s.properties;
   if(a.memory){for(const kind of ['audio','sub'] as const){const id=nativeTrackChoice(a.props['track-list']??[],kind,kind==='audio'?a.memory.audio:a.memory.subtitle);if(id!==undefined)await client.control('track',{type:kind==='audio'?'audio':'subtitle',id:id==='no'?null:id});}await client.control('subtitle-delay',a.memory.delay);if(a.memory.subtitle&&!a.memory.subtitle.startsWith('embedded:')){const item=await this.api(`/api/media/${a.mediaId}`);if(item.external_subtitles?.some((s:any)=>s.path===a.memory!.subtitle))await client.addAuthorizedSubtitle(a.memory.subtitle);}}
   a.bridge=new RenderTextureBridge(a.web,client.pid,a.session,this.deps.root);const stopClock=()=>a.bridge?.setClockActive(false);main.on('hide',stopClock);main.on('minimize',stopClock);a.releaseWindowClock=()=>{main.removeListener('hide',stopClock);main.removeListener('minimize',stopClock);};client.on('failure',(error:Error)=>{if(!a.closing){const timeout=error.message.startsWith('原生控制超时：'),operation=timeout?error.message.slice('原生控制超时：'.length):null;this.deps.log('render-player-failure '+JSON.stringify({kind:timeout?'command-timeout':'host-failure',operation,generation:a.generation,pendingSeek:a.pendingSeek!==null,hadFrame:a.firstFrame!==null}));a.bridge?.setClockActive(false);a.error=timeout?(operation==='seek'?'跳播命令响应超时，请重试原生播放或切换现有播放器':'原生播放控制响应超时，请重试或切换现有播放器'):'原生播放进程异常，请重试或切换现有播放器';this.publish(a);}});
   a.firstFrameDeadline=performance.now()+30000;this.pump(a);a.heartbeat=setInterval(()=>{void this.activity(a,true).catch(()=>this.deps.log('render-playback-priority-unavailable'));void this.save(a).catch(()=>{});},3000);return this.view(a);
  }catch(error){try{await this.close(a,true);}catch{throw new Error('原生打开失败且清理尚未完成，请重试关闭');}throw error;}
 }
 private async resume(a:Active){
  // Start the owned playback clock before unpausing, not at a later poll of
  // stale paused properties. Read back the real state before publishing it.
  const main=this.deps.main();a.bridge?.setClockActive(a.intent&&!!main&&!main.isDestroyed()&&main.isVisible()&&!main.isMinimized());
  await a.client.control('play');const snapshot=await a.client.snapshot();if(snapshot.error)throw new Error(snapshot.error);a.props=snapshot.properties;
  // A concurrent pump may have released the clock using the old paused
  // snapshot. Reconcile it with the real result and latest user/window intent.
  a.bridge?.setClockActive(a.intent&&a.props.pause===false&&a.props['eof-reached']!==true&&!!main&&!main.isDestroyed()&&main.isVisible()&&!main.isMinimized());return snapshot;
 }
 private pump(a:Active){if(a.closing||this.active!==a||a.error)return;const began=performance.now(),main=this.deps.main(),clockActive=a.intent&&a.props.pause===false&&a.props['eof-reached']!==true&&!!main&&!main.isDestroyed()&&main.isVisible()&&!main.isMinimized();a.bridge?.setClockActive(clockActive);const task=(async()=>{
  let stage:'frame'|'gpu'|'ack'|'snapshot'|'resume'|'first-frame'='frame';try{let urgent=false,snapshotFresh=false;const frame=await a.client.frame();if(a.closing||this.active!==a)return;if(frame.error)throw new Error(frame.error);
   if(frame.waiting&&frame.serial>a.lastFrame){a.lastFrame=frame.serial;stage='gpu';const {gpuAt,...receipt}=await a.bridge!.present(frame,a.surface),frameAt=gpuAt??performance.now();if(a.closing||this.active!==a)return;stage='ack';await a.client.acknowledge(frame.serial);if(a.videoSize?.width!==frame.width||a.videoSize?.height!==frame.height){a.videoSize={width:frame.width,height:frame.height};await this.fit(a);}a.presented=receipt;if(a.firstFrame===null){a.firstFrame=performance.now()-a.opened;urgent=true;
     // Keep display-driver enumeration out of the serial playback pipe. A
     // fire-and-forget request still delays the following play/seek commands
     // inside the native host. Explicit display diagnostics remain available.
     if(a.intent&&!a.closing&&!a.error&&a.pendingSeek===null){stage='resume';await this.resume(a);}}if(a.pendingSeek===receipt.seekId){
    const id=receipt.seekId,target=a.seekTarget!,started=a.seekStarted,requested=a.seekRequestedAt??started,inputMs=a.seekInputMs,strategy=frame.seekTiming?.exactFallback?'exact':a.seekStrategy??'exact';stage='snapshot';let snapshot=await a.client.snapshot();if(snapshot.error)throw new Error(snapshot.error);a.props=snapshot.properties;
    if(snapshot.properties.pause===true&&a.intent&&a.pendingSeek===id&&!a.closing&&!a.error){stage='resume';snapshot=await this.resume(a);}
    snapshotFresh=true;
    if(a.pendingSeek===id){
     const timing=frame.seekTiming,finished=performance.now(),position=receipt.positionSec;
     a.seekDiagnostics={seekId:id,strategy,target,position,errorSec:position-target,inputToDispatchMs:inputMs??null,queueMs:started-requested,nativeQueueMs:timing?.nativeQueueMs??null,seekEventMs:timing?.seekEventMs??null,restartMs:timing?.restartMs??null,restartToFrameMs:timing?.restartMs!=null?timing.nativeFrameMs-timing.restartMs:null,frameMs:frameAt-started,confirmationMs:finished-started,corrections:timing?.corrections??0,correctionMs:timing?.correctionMs??null,cacheWaitMs:timing?.cacheWaitMs??null,avSyncSec:a.props.avsync??null,sourceLoads:Number(a.props['avhub-source-loads']??0),hwdec:a.props['hwdec-current']??null};
     (a.seekEvidence??=new MpvSeekEvidence()).record(a.seekDiagnostics,a.seekPlaying===true,a.seekDistance??0);
     a.pendingSeek=null;a.seekTarget=null;a.lastSeek=finished-requested;urgent=true;
    }
   }}
   if(!a.presented){
    // A loaded/EOF ACK with zero output is not a usable video. Keep the
    // visible first-frame wait finite, without classifying timeout as damage
    // or safe automatic fallback. Hidden windows get their budget on restore.
    if(!main||main.isDestroyed()||!main.isVisible()||main.isMinimized())a.firstFrameDeadline=performance.now()+30000;
    else if(performance.now()>=a.firstFrameDeadline){stage='first-frame';this.deps.log('render-first-frame-timeout '+JSON.stringify({session:a.session,mediaId:a.mediaId,generation:a.generation,outputFrames:0}));throw new Error('原生输出未在 30 秒内呈现首帧，请重试或手动切换其他原画播放器');}
   }
   if(!a.closing&&this.active===a&&(urgent||performance.now()-a.lastSnapshot>=200)){a.lastSnapshot=performance.now();if(!snapshotFresh){stage='snapshot';const s=await a.client.snapshot();if(s.error)throw new Error(s.error);a.props=s.properties;}this.publish(a);if(a.props['eof-reached']===true&&a.props['avhub-subtitle-refresh']!==true&&a.intent&&!a.ended&&a.pendingSeek===null){a.ended=true;a.web.send('avhub:render-event',{session:a.session,kind:'ended'});}if(a.props['eof-reached']!==true)a.ended=false;}
  }catch(error){
   const detail=error instanceof Error?error.message:'',timeout=detail.startsWith('原生控制超时：');
   this.deps.log('render-output-failure '+JSON.stringify({stage,kind:timeout?'command-timeout':stage==='first-frame'?'first-frame-timeout':stage==='gpu'?'gpu-presentation':'native-output',elapsedMs:performance.now()-began,generation:a.generation,pendingSeek:a.pendingSeek!==null,hadFrame:a.firstFrame!==null,...(/^NATIVE_[A-Z_]+(?:-?\d+)?$/.test(detail)?{nativeCode:detail}:{})}));
   const message=stage==='first-frame'?'原生输出未在 30 秒内呈现首帧，请重试或手动切换其他原画播放器':stage==='gpu'?'原生画面 GPU 提交或释放失败，请重试或切换现有播放器':timeout?'原生播放控制响应超时，请重试或切换现有播放器':stage==='frame'?'原生解码或画面读取失败，请重试或切换现有播放器':'原生画面输出异常，请重试或切换现有播放器';
   this.failOutput(a,message);
  }
 })();a.poll=task;void task.finally(()=>{if(a.poll===task)a.poll=undefined;if(!a.closing&&!a.error){
  // Include frame/GPU work in the existing 10ms playing cadence instead of
  // adding another 10ms after it. Keep one task, yield at least 1ms, and leave
  // paused/hidden timing unchanged; no extra decoding or frame-copy queue.
  const delay=clockActive&&a.intent&&a.props.pause===false?Math.max(1,Math.ceil(10-(performance.now()-began))):10;
  a.timer=setTimeout(()=>this.pump(a),delay);
 }});}
 private view(a:Active){
  const p=a.props,w=this.deps.windowState(),tracks=Array.isArray(p['track-list'])?p['track-list']:[],status=a.error?'error':!a.presented?'loading':p['eof-reached']===true?'ended':p['paused-for-cache']===true?'buffering':p.pause===false?'playing':'paused';
  const safe:Record<string,any>={};for(const key of ['time-pos','duration','pause','volume','mute','speed','eof-reached','seeking','paused-for-cache','aid','sid','sub-delay','video-params','hwdec-current','current-demuxer','decoder-frame-drop-count','frame-drop-count','avhub-seek-corrections','avhub-seek-dispatches','avhub-seek-coalesced','avhub-subtitle-refresh','avhub-output-transfer','avhub-native-seek-trace'])safe[key]=p[key];safe['track-list']=tracks.map((t:any)=>({id:t.id,type:t.type,title:t.title,lang:t.lang,codec:t.codec,selected:t.selected,external:t.external}));safe['video-params']={...p['video-params'],rotate:a.rotation};Object.assign(safe,{'video-rotate':a.rotation,'video-zoom':a.transform.zoom,'video-pan-x':a.transform.x,'video-pan-y':a.transform.y});
  if(a.sourceColor?.hdr||a.sourceColor?.dynamic_hdr||p['avhub-output-transfer']==='pq'||p['avhub-output-transfer']==='hlg')safe['avhub-hdr-status']='HDR 播放 · 显示及动态元数据效果待验证';
  safe['avhub-source-color']=['primaries','transfer','matrix','range'].every(key=>a.sourceColor?.[key]&&a.sourceColor[key]!=='unknown')?'源色彩标记完整':'源色彩标记不完整 · MPV 自动解释';
  return {sourceIdentity:a.memory?.source??null,subtitleDelaySec:number(p['sub-delay'],-10,10)?p['sub-delay']:0,session:a.session,surface:a.surface,generation:a.generation,mediaId:a.mediaId,revision:++a.revision,status,positionSec:p['avhub-subtitle-refresh']===true&&a.presented?a.presented.positionSec:number(p['time-pos'],0,Number.MAX_VALUE)?p['time-pos']:0,durationSec:number(p.duration,0,Number.MAX_VALUE)?p.duration:null,volume:number(p.volume,0,100)?p.volume/100:1,muted:p.mute===true,rate:number(p.speed,.25,4)?p.speed:1,tracks:tracks.filter((t:any)=>['audio','sub'].includes(t.type)).map((t:any)=>({id:String(t.id),type:t.type==='sub'?'subtitle':'audio',title:t.title,language:t.lang,selected:t.selected===true,external:t.external===true})),videoSize:a.videoSize,presented:a.presented,error:a.error?{code:'NATIVE_RENDER',message:a.error,recoverable:true}:undefined,properties:safe,title:a.title,phase:a.error?'error':a.presented?'ready':'starting',embedded:true,playIntent:a.intent,pure:w.purePlayback,pinned:w.alwaysOnTop,fullscreen:w.fullScreen,maximized:w.maximized,firstFrameMs:a.firstFrame,lastSeekMs:a.lastSeek,pendingSeek:a.pendingSeek===null?null:a.seekTarget,seekPolicy:a.seekPolicy??'exact',seekDiagnostics:a.seekDiagnostics,sourceLoads:p['avhub-source-loads']??0,restarts:0,seeks:0,saveError:a.saveError,clock:a.bridge?.clockState()??null,subtitleAppearance:a.prefs.subtitleAppearance,transport:a.bridge?{...a.bridge.stats}:null};
 }
 private activityBody(a:Active,present:boolean){
  const live=present&&!a.closing&&!a.error,preparing=live&&(a.firstFrame===null||a.pendingSeek!==null||a.props.seeking===true);
  return {owner:a.owner,media_id:a.mediaId,present:present&&!a.closing,playing:live&&(preparing||a.props.pause===false&&a.props['eof-reached']!==true),preparing};
 }
 private activity(a:Active,present:boolean):Promise<void>{
  this.activityWanted.set(a,this.activityBody(a,present));const running=this.activityWrites.get(a);if(running)return running;
  const task:Promise<void>=Promise.resolve().then(async()=>{
   while(this.activityWanted.has(a)){
    const body=this.activityWanted.get(a)!;this.activityWanted.delete(a);
    try{await this.api('/api/playback/activity','POST',body);}catch(error){if(!this.activityWanted.has(a))throw error;}
   }
  }).finally(()=>{if(this.activityWrites.get(a)===task)this.activityWrites.delete(a);const remaining=this.activityWanted.get(a);if(remaining)return this.activity(a,remaining.present);});
  this.activityWrites.set(a,task);return task;
 }
 private publish(a:Active){
  if(!a.closing){const signature=JSON.stringify(this.activityBody(a,true));if(this.activityState.get(a)!==signature){this.activityState.set(a,signature);void this.activity(a,true).catch(()=>this.deps.log('render-playback-priority-unavailable'));}}
  if(!a.web.isDestroyed())a.web.send('avhub:render-state',this.view(a));
 }
 private fit(a:Active){if(a.videoSize&&this.deps.windowState().purePlayback)this.deps.mode({videoAspectRatio:a.rotation%180?a.videoSize.height/a.videoSize.width:a.videoSize.width/a.videoSize.height});return this.deps.settled();}
 private save(a:Active){if(a.saving)return a.saving;const revision=a.dirty,props={...a.props},position=a.presented?.positionSec,memory=a.dirtyMemory&&a.memory?{...a.memory}:null,prefs=JSON.parse(JSON.stringify(a.prefs));const task=(async()=>{try{
  if(number(position,0,Number.MAX_VALUE))await this.api(`/api/media/${a.mediaId}/progress`,'PUT',{progress:position,watched:props['eof-reached']===true&&props['avhub-subtitle-refresh']!==true&&a.pendingSeek===null,updated_at:Date.now()});
  if(revision>a.saved){await this.api('/api/preferences','PATCH',{values:prefs,updated_at:Date.now()});a.saved=revision;}
  if(memory){await this.api(`/api/media/${a.mediaId}/playback-state`,'PATCH',{source:memory.source,changes:{audio:memory.audio,subtitle:memory.subtitle,delay:memory.delay},updated_at:Date.now()});if(a.memory&&JSON.stringify(a.memory)===JSON.stringify(memory))a.dirtyMemory=false;}
  a.saveError='';
 }catch{a.saveError='播放记录尚未保存，请重试关闭';throw new Error(a.saveError);}finally{this.publish(a);}})();a.saving=task;void task.finally(()=>{if(a.saving===task)a.saving=undefined;}).catch(()=>{});return task;}
 private close(a:Active,discard=false){if(a.closingTask)return a.closingTask;a.closing=true;a.releaseWindowClock?.();a.releaseWindowClock=undefined;a.bridge?.setClockActive(false);clearTimeout(a.timer);clearInterval(a.heartbeat);const priorityRelease=this.activity(a,false).catch(()=>this.deps.log('render-playback-priority-release-unavailable'));const task=(async()=>{
  await a.capture;await a.poll;await a.saving?.catch(()=>{});if(a.client.alive){await a.client.control('pause').catch(()=>{});try{a.props=(await a.client.snapshot()).properties;}catch{}}if(!discard)await this.save(a);await a.client.close();if(a.shaderCache)await prepareNativeShaderCache(this.deps.data(),'closed').catch(()=>{this.deps.log('render-shader-cache-cleanup-unavailable');});await priorityRelease;await this.api(`/api/native-read/${a.owner}`,'DELETE');this.deps.log('render-player-closed '+JSON.stringify({generation:a.generation,helperAlive:a.client.alive,sourceLeaseReleased:true,clock:a.bridge?.clockState()??null,transport:a.bridge?.stats??null}));if(this.active===a)this.active=null;this.retired.set(a.session,a.generation);if(this.retired.size>32)this.retired.delete(this.retired.keys().next().value!);if(!a.web.isDestroyed())a.web.send('avhub:render-closed',{session:a.session});
 })();a.closingTask=task;void task.catch(()=>{a.closingTask=undefined;});return task;}
 async shutdown(discard=false){await this.retiring?.catch(()=>{});await this.opening?.catch(()=>{});if(this.active)await this.close(this.active,discard);}
}
