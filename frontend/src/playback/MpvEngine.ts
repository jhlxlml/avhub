import {cancelled,type MediaSource,type PlaybackEngine,type PlaybackState,type PlaybackTarget,type Track} from './types';

export type NativeSnapshot={session:string;generation:number;mediaId:number;revision:number;status:PlaybackState['status'];positionSec:number;durationSec:number|null;volume:number;muted:boolean;rate:number;videoSize?:{width:number;height:number};tracks:Track[];error?:PlaybackState['error'];seekDiagnostics?:{seekId:number;strategy:'exact'|'keyframe';target:number};presented?:{serial:number;positionSec:number;seekId:number};sourceIdentity?:string|null;subtitleDelaySec?:number;playIntent?:boolean};
export type NativeCommand='play'|'pause'|'seek'|'cancel-seek'|'volume'|'mute'|'rate'|'track'|'subtitle-delay';
export type NativeOpen={mediaId:number;generation:number;startSec:number;autoplay:boolean};
export interface NativeEnginePort {
 attach(surface:HTMLElement):Promise<()=>Promise<void>>;
 open(source:NativeOpen):Promise<NativeSnapshot>;
 command(session:string,generation:number,action:NativeCommand,value?:unknown):Promise<void>;
 subscribe(listener:(snapshot:NativeSnapshot)=>void):()=>void;
 close(session:string,generation:number):Promise<void>;
}
type Session={id:string;generation:number;mediaId:number};
const statuses=new Set<PlaybackState['status']>(['loading','ready','playing','paused','buffering','ended','error']);
const finite=(v:unknown,min:number,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
function validSnapshot(s:NativeSnapshot){return s&&typeof s.session==='string'&&s.session.length>0&&Number.isSafeInteger(s.generation)&&s.generation>0&&Number.isSafeInteger(s.mediaId)&&s.mediaId>0&&Number.isSafeInteger(s.revision)&&s.revision>=0&&statuses.has(s.status)&&finite(s.positionSec,0)&&(s.durationSec===null||finite(s.durationSec,0))&&finite(s.volume,0,1)&&typeof s.muted==='boolean'&&finite(s.rate,.25,4)&&Array.isArray(s.tracks)&&s.tracks.length<=128&&s.tracks.every(t=>t&&typeof t.id==='string'&&t.id.length>0&&t.id.length<=64&&['audio','subtitle'].includes(t.type)&&typeof t.selected==='boolean')&&(s.sourceIdentity===undefined||s.sourceIdentity===null||typeof s.sourceIdentity==='string'&&/^[a-f0-9]{64}$/.test(s.sourceIdentity))&&(s.subtitleDelaySec===undefined||finite(s.subtitleDelaySec,-10,10))&&(s.playIntent===undefined||typeof s.playIntent==='boolean');}

/** Renderer adapter only. The trusted main process resolves media IDs and
 * owns decoding/GPU/read leases. A command acknowledgement is not a shown frame. */
export class MpvEngine implements PlaybackEngine {
 readonly kind='mpv' as const;
 private source:MediaSource|null=null;private session:Session|null=null;
 private state:PlaybackState={status:'idle',engine:'mpv',generation:0,mediaId:null,positionSec:0,durationSec:null,bufferedRanges:[],volume:1,muted:false,rate:1};
 private listeners=new Set<(s:PlaybackState)=>void>();private tracks:Track[]=[];
 private detach:(()=>Promise<void>)|null=null;private unlisten:(()=>void)|null=null;
 private initializing:Promise<void>|null=null;private surface:HTMLElement|null=null;
 private loading:AbortController|null=null;private disposed=false;private stopping:Promise<void>|null=null;private tail:Promise<void>=Promise.resolve();
 private revision=-1;private signature='';private early:NativeSnapshot[]=[];private openingGeneration:number|null=null;
 private seekId=0;private lastPresented=0;
 private sourceIdentity:string|null=null;private subtitleDelay=0;private playIntent=false;
 private clockTimer:ReturnType<typeof setTimeout>|null=null;
 private seeking:{id:number;target:number;after:number;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
 constructor(private port:NativeEnginePort,private seekTimeoutMs=15000){}
 init(target:PlaybackTarget):Promise<void>{
  if(this.disposed)return Promise.reject(cancelled());
  if(!('nativeSurface' in target)||!target.nativeSurface)return Promise.reject(new Error('MPV 需要原生画面表面'));
  if(this.surface){if(this.surface!==target.nativeSurface)return Promise.reject(new Error('原生表面已经初始化'));if(this.initializing)return this.initializing;return this.detach&&this.unlisten?Promise.resolve():Promise.reject(new Error('原生表面尚未完成清理'));}
  this.surface=target.nativeSurface;
  const task=(async()=>{try{
   const detach=await this.port.attach(target.nativeSurface);this.detach=detach;
   if(this.disposed)throw cancelled();
   this.unlisten=this.port.subscribe(s=>this.receive(s));
  }catch(error){if(!this.disposed&&this.detach){try{await this.detach();this.detach=null;}catch(cleanup){throw new Error('原生表面初始化失败且仍待清理',{cause:cleanup});}}if(!this.detach)this.surface=null;throw error;}})();
  this.initializing=task;void task.finally(()=>{if(this.initializing===task)this.initializing=null;}).catch(()=>{});return task;
 }
 async load(source:MediaSource,options:{signal?:AbortSignal;generation?:number}={}){
  if(this.disposed||!this.detach)throw cancelled();
  if(!Number.isSafeInteger(source.mediaId)||source.mediaId<=0||source.uri!==`avhub-media:${source.mediaId}`||source.transport!=='direct'||source.offsetSec!==0)throw new Error('原生播放只接受已授权媒体 ID，不能接受路径或地址');
  const start=source.resumePositionSec??0;if(!finite(start,0))throw new RangeError('续播位置无效');
  const generation=options.generation??this.state.generation+1;if(!Number.isSafeInteger(generation)||generation<=this.state.generation)throw new Error('原生会话代次无效');
  this.loading?.abort();this.cancelSeek();const abort=new AbortController();this.loading=abort;
  this.source=source;this.revision=-1;this.tracks=[];this.sourceIdentity=null;this.subtitleDelay=0;this.playIntent=source.autoplay!==false;this.state={...this.state,status:'loading',generation,mediaId:source.mediaId,positionSec:start,durationSec:source.durationSec??null,error:undefined};this.publish();
  const cancel=()=>abort.abort();options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
  let rejectAbort:(e:Error)=>void=()=>{};const cancelledTask=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>rejectAbort(cancelled());abort.signal.addEventListener('abort',onAbort,{once:true});if(abort.signal.aborted)onAbort();
  const task=this.tail.then(async()=>{
   if(this.session){const old=this.session;await this.port.close(old.id,old.generation);if(this.session===old)this.session=null;}
   if(abort.signal.aborted||this.disposed)throw cancelled();
   this.openingGeneration=generation;this.early=[];
   let opened:NativeSnapshot;
   try{opened=await this.port.open({mediaId:source.mediaId,generation,startSec:start,autoplay:source.autoplay!==false});}
   finally{if(this.openingGeneration===generation)this.openingGeneration=null;}
   // An aborted open still has to return its real session and close it. Do
   // not release the source/read lease merely because renderer waiting ended.
   if(!opened||typeof opened.session!=='string'||!opened.session||opened.generation!==generation||opened.mediaId!==source.mediaId)throw new Error('原生会话身份不匹配');
   const owned={id:opened.session,generation,mediaId:source.mediaId};this.session=owned;this.lastPresented=0;
   if(abort.signal.aborted||this.disposed){await this.port.close(owned.id,generation);if(this.session===owned)this.session=null;throw cancelled();}
   if(!validSnapshot(opened)){await this.port.close(owned.id,generation);if(this.session===owned)this.session=null;throw new Error('原生会话状态不匹配');}
   this.receive(opened);for(const event of this.early.splice(0))this.receive(event);
  });
  this.tail=task.catch(error=>{if(!abort.signal.aborted&&!this.disposed&&this.state.generation===generation){this.state={...this.state,status:'error',error:{code:'NATIVE_OPEN',message:error instanceof Error?error.message:'原生播放未打开',recoverable:false}};this.publish();}});
  try{await Promise.race([task,cancelledTask]);}finally{abort.signal.removeEventListener('abort',onAbort);options.signal?.removeEventListener('abort',cancel);}
 }
 private receive(value:NativeSnapshot){
  if(this.disposed||!validSnapshot(value))return;
  const active=this.session;
  if(!active){if(this.openingGeneration===value.generation){this.early.push(value);if(this.early.length>16)this.early.shift();}return;}
  if(value.session!==active.id||value.generation!==active.generation||value.mediaId!==active.mediaId||value.generation!==this.state.generation||value.revision<=this.revision)return;
  const before=JSON.stringify([{...this.state,positionSec:0},this.tracks,this.sourceIdentity,this.subtitleDelay,this.playIntent]);
  this.revision=value.revision;this.tracks=value.tracks.map(t=>({...t}));
  this.sourceIdentity=value.sourceIdentity??null;this.subtitleDelay=value.subtitleDelaySec??0;this.playIntent=value.playIntent??(value.status==='playing'?true:value.status==='paused'?false:this.playIntent);
  this.state={...this.state,status:value.status,positionSec:value.positionSec,durationSec:value.durationSec,volume:value.volume,muted:value.muted,rate:value.rate,error:value.error,videoSize:value.videoSize?{...value.videoSize}:undefined};
  let seekComplete=false;const frame=value.presented;if(frame&&Number.isSafeInteger(frame.serial)&&frame.serial>this.lastPresented&&finite(frame.positionSec,0)){
   this.lastPresented=frame.serial;const seek=this.seeking;
   if(seek&&frame.seekId===seek.id&&frame.serial>seek.after&&(Math.abs(frame.positionSec-seek.target)<=.1||value.seekDiagnostics?.seekId===seek.id&&value.seekDiagnostics.strategy==='keyframe'&&value.seekDiagnostics.target===seek.target)){this.seeking=null;clearTimeout(seek.timer);seekComplete=true;seek.resolve();}
  }
  if(value.status==='error')this.cancelSeek(new Error(value.error?.message||'原生跳播失败'));this.publish(seekComplete||before!==JSON.stringify([{...this.state,positionSec:0},this.tracks,this.sourceIdentity,this.subtitleDelay,this.playIntent]));
 }
 private current(){if(this.disposed||!this.session||this.state.generation!==this.session.generation)throw cancelled();return this.session;}
 private async command(action:NativeCommand,value?:unknown){const active=this.current();await this.port.command(active.id,active.generation,action,value);if(this.disposed||this.session!==active||this.state.generation!==active.generation)throw cancelled();}
 private playRequest=0;
 async play(){
  const request=++this.playRequest;
  // libmpv keep-open retains EOF; unpausing alone cannot replay it. Preserve
  // a user-selected pending seek, and wait for a real first frame at zero.
  if(this.state.status==='ended'&&!this.seeking)await this.seekTo(0);
  if(request===this.playRequest)await this.command('play');
 }
 pause(){this.playRequest++;return this.command('pause');}
 seekTo(seconds:number):Promise<void>{
  if(!finite(seconds,0))return Promise.reject(new RangeError('跳播时间无效'));
  try{this.current();}catch(error){return Promise.reject(error);}
  this.cancelSeek();const id=++this.seekId;
  return new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{if(this.seeking?.id===id){this.seeking=null;void this.command('cancel-seek',{seekId:id}).catch(()=>{});reject(new Error('尚未收到目标画面的呈现确认，请重试跳播'));}},this.seekTimeoutMs);
   this.seeking={id,target:seconds,after:this.lastPresented,resolve,reject,timer};
   void this.command('seek',{seconds,seekId:id}).catch(error=>{if(this.seeking?.id===id)this.cancelSeek(error);});
  });
 }
 private cancelSeek(error:Error=cancelled()){const seek=this.seeking;if(seek){this.seeking=null;clearTimeout(seek.timer);seek.reject(error);}}
 async cancelPendingSeek(){const seek=this.seeking;this.cancelSeek();if(seek&&this.session&&!this.disposed)await this.command('cancel-seek',{seekId:seek.id});}
 async setVolume(value:number){if(!finite(value,0,1))throw new RangeError('音量无效');await this.command('volume',value);}
 async setMuted(value:boolean){if(typeof value!=='boolean')throw new TypeError('静音状态无效');await this.command('mute',value);}
 async setRate(value:number){if(!finite(value,.25,4))throw new RangeError('倍速无效');await this.command('rate',value);}
 async listTracks(type?:Track['type']){this.current();return this.tracks.filter(t=>!type||t.type===type).map(t=>({...t}));}
 async selectTrack(type:Track['type'],id:string|null){this.current();if(!['audio','subtitle'].includes(type)||id!==null&&!this.tracks.some(t=>t.type===type&&t.id===id))throw new Error('轨道不属于当前媒体');await this.command('track',{type,id});}
 async setSubtitleDelay(seconds:number){if(!finite(seconds,-10,10))throw new RangeError('字幕延迟无效');await this.command('subtitle-delay',seconds);}
 getState():PlaybackState{return {...this.state,bufferedRanges:[],videoSize:this.state.videoSize?{...this.state.videoSize}:undefined,error:this.state.error?{...this.state.error}:undefined};}
 getSession(){return this.session?{...this.session}:null;}
 getPresentedSerial(){return this.lastPresented;}
 getPlayIntent(){return this.playIntent;}
 getTrackSelection(){return {sourceIdentity:this.sourceIdentity,audio:this.tracks.find(t=>t.type==='audio'&&t.selected)?.id??null,subtitle:this.tracks.find(t=>t.type==='subtitle'&&t.selected)?.id??null,delaySec:this.subtitleDelay};}
 private publish(immediate=true){
  if(!immediate){if(!this.clockTimer)this.clockTimer=setTimeout(()=>{this.clockTimer=null;if(!this.disposed)this.publish();},200);return;}
  if(this.clockTimer){clearTimeout(this.clockTimer);this.clockTimer=null;}
  const state=this.getState(),signature=JSON.stringify([state,this.tracks,this.sourceIdentity,this.subtitleDelay,this.playIntent]);if(signature===this.signature)return;this.signature=signature;for(const listener of this.listeners)listener(state);
 }
 subscribe(listener:(state:PlaybackState)=>void){if(this.disposed)return()=>{};this.listeners.add(listener);listener(this.getState());return()=>this.listeners.delete(listener);}
 dispose(){
  if(this.stopping)return this.stopping;this.disposed=true;this.loading?.abort();this.cancelSeek();if(this.clockTimer){clearTimeout(this.clockTimer);this.clockTimer=null;}
  const task=(async()=>{await this.initializing?.catch(()=>{});await this.tail;const active=this.session;if(active){await this.port.close(active.id,active.generation);if(this.session===active)this.session=null;}await this.detach?.();this.detach=null;this.surface=null;this.unlisten?.();this.unlisten=null;this.state={...this.state,status:'destroyed'};this.listeners.clear();})();
  this.stopping=task;void task.catch(()=>{if(this.stopping===task)this.stopping=null;});return task;
 }
}
