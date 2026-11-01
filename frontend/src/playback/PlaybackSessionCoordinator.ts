import {cancelled,type MediaSource} from './types';

export type SessionEngineKind='chromium'|'mpv-independent'|'libmpv-d3d11';
export type SessionFailureKind='cancelled'|'runtime-missing'|'initialization'|'unsupported'|'integrity'|'device-lost'|'unauthorized'|'source-invalid'|'media-offline'|'backend-aborted'|'save'|'cleanup'|'unknown';
export class PlaybackSessionFailure extends Error {
 readonly recoveryHint:string;
 constructor(readonly kind:SessionFailureKind,message:string,readonly operation:string,options?:ErrorOptions){super(message,options);this.name='PlaybackSessionFailure';this.recoveryHint=recoveryHints[kind];}
}
const recoveryHints:Record<SessionFailureKind,string>={cancelled:'操作已取消，可重新打开视频',
 'runtime-missing':'重新检测完整运行库，或手动选择其他原画播放路径',initialization:'可重试播放或切换其他原画路径，不自动授权转码',unsupported:'请选择其他原画播放路径，不自动降低画质',
 integrity:'请重新验证或更换完整运行库；完整性错误不会自动隐藏','device-lost':'恢复窗口或显卡设备后重试，也可手动切换原画路径',unauthorized:'恢复媒体目录授权后重试',
 'source-invalid':'检查源文件并刷新索引，不改写源视频','media-offline':'连接媒体所在磁盘或重新定位目录后重试','backend-aborted':'检查本地服务与播放诊断后重试',
 save:'重试保存后再关闭，保留尚未释放的文件占用保护',cleanup:'重试关闭，实际回收完成前保留文件占用保护',unknown:'查看播放诊断，或手动选择其他原画播放路径'};
export const isAutomaticRecoveryKind=(kind:SessionFailureKind)=>['runtime-missing','initialization','unsupported'].includes(kind);
export type SessionIdentity=Readonly<{sessionId:string;generation:number;mediaId:number;engineKind:SessionEngineKind}>;
export type SessionSnapshot=Readonly<{positionSec:number;paused:boolean;volume:number;muted:boolean;rate:number;
 tracks:Readonly<{sourceIdentity:string|null;audio:string|null;subtitle:string|null;delaySec:number}>}>;
export type SessionState=Readonly<{rootId:string;phase:'idle'|'opening'|'ready'|'closing'|'closed'|'error';identity:SessionIdentity|null;snapshot:SessionSnapshot|null;failure:PlaybackSessionFailure|null;automaticRecoveries:number}>;
/** A resolved open means the adapter has confirmed actual media readiness.
 * close must await resource reclamation, including an aborted native open.
 * The adapter owns track/source identity verification; no filesystem paths cross here. */
export interface SessionAdapter {
 open(source:MediaSource,identity:SessionIdentity,signal:AbortSignal,resume:SessionSnapshot|null):Promise<SessionSnapshot>;
 snapshot():SessionSnapshot;
 subscribe(listener:(snapshot:SessionSnapshot,failure?:PlaybackSessionFailure)=>void):()=>void;
 seekTo(seconds:number,signal:AbortSignal):Promise<void>;
 cancelPending():Promise<void>;
 save():Promise<void>;
 close():Promise<void>;
}
type Binding={owner:symbol;factory:()=>SessionAdapter};
type Owned={identity:SessionIdentity;source:Readonly<MediaSource>;binding?:Binding;adapter:SessionAdapter;unsubscribe:()=>void;closed:boolean;closing:Promise<void>|null;saving:Promise<void>|null;saved:string|null};
export type SessionCoordinator=Pick<PlaybackSessionCoordinator,'getState'|'subscribe'|'load'|'seekTo'|'flush'|'close'>;
const immutableSnapshot=(snapshot:SessionSnapshot)=>Object.freeze({...snapshot,tracks:Object.freeze({...snapshot.tracks})});
const recoverable=(failure:PlaybackSessionFailure)=>isAutomaticRecoveryKind(failure.kind);

/** Cross-engine orchestration only. Main-process resource owners remain authoritative. */
export class PlaybackSessionCoordinator {
 readonly id=crypto.randomUUID();
 private active:Owned|null=null;
 private pending:Owned|null=null;
 private generation=0;
 private intent=new AbortController();
 private seekIntent=new AbortController();
 private tail:Promise<void>=Promise.resolve();
 private cancellation:Promise<void>=Promise.resolve();
 private closing:Promise<void>|null=null;private flushing:Promise<void>|null=null;
 private recoveryMedia:number|null=null;
 private requested:Readonly<MediaSource>|null=null;
 private recoveries=0;
 private listeners=new Set<(state:SessionState)=>void>();
 private requestedOwner:symbol|null=null;
 private pendingFlushes=new Set<Promise<void>>();
 private state:SessionState=Object.freeze({rootId:this.id,phase:'idle',identity:null,snapshot:null,failure:null,automaticRecoveries:0});
 constructor(private factories:Partial<Record<SessionEngineKind,()=>SessionAdapter>>){}
 getState(){return this.state;}
 subscribe(listener:(state:SessionState)=>void){this.listeners.add(listener);listener(this.state);return()=>this.listeners.delete(listener);}
 /** A component can retire only its own owner, including after a newer mount
  * has opened another engine. Native resource ownership stays in the adapter. */
 scope(kind:SessionEngineKind,factory:()=>SessionAdapter):SessionCoordinator{
  const binding={owner:Symbol(kind),factory};let flushing:Promise<void>|null=null,closing:Promise<void>|null=null;
  const getState=():SessionState=>{
   const owned=[this.pending,this.active].find(value=>value?.binding?.owner===binding.owner);
   const current=this.requestedOwner===binding.owner;
   if(!current&&!owned)return Object.freeze({...this.state,phase:'closed',identity:null,snapshot:null,failure:null});
   const identity=owned&&owned.identity.sessionId===this.state.identity?.sessionId?owned.identity:null;
   return Object.freeze({...this.state,phase:current?this.state.phase:'closing',identity,snapshot:owned?immutableSnapshot(owned.adapter.snapshot()):null,failure:current?this.state.failure:null});
  };
  return {
   getState,subscribe:listener=>this.subscribe(()=>listener(getState())),
   load:(source,requestedKind)=>requestedKind!==kind?Promise.reject(new PlaybackSessionFailure('unsupported','会话作用域与播放引擎不匹配','open')):this.transition(source,kind,null,false,binding),
   seekTo:seconds=>this.seekForOwner(seconds,binding.owner),
   flush:()=>{
    if(flushing)return flushing;
    const task=this.enqueue(async()=>{if(this.active?.binding?.owner===binding.owner)await this.save(this.active);});
    const settled=task.finally(()=>{this.pendingFlushes.delete(settled);if(flushing===settled)flushing=null;});
    flushing=settled;this.pendingFlushes.add(settled);return settled;
   },
   close:()=>{
    if(closing)return closing;
    const pendingFlush=flushing,request=this.requestedOwner===binding.owner?this.supersede():null;
    const task=this.enqueue(async()=>{
     if(request){if(this.requestedOwner===binding.owner&&request.generation===this.generation)this.publish({phase:'closing',failure:null});await this.cancellation;}
     await pendingFlush;
     if(this.pending?.binding?.owner===binding.owner)await this.retire(this.pending);
     if(this.active?.binding?.owner===binding.owner)await this.retire(this.active);
     if(this.requestedOwner===binding.owner&&request?.generation===this.generation)this.publish({phase:'closed',identity:null,failure:null});
    }).catch(error=>{
     const failure=error instanceof PlaybackSessionFailure?error:new PlaybackSessionFailure('cleanup','播放会话仍待清理，请重试关闭','close',{cause:error});
     if(this.requestedOwner===binding.owner)this.publish({phase:'error',failure});throw failure;
    });
    const settled=task.finally(()=>{if(closing===settled)closing=null;});closing=settled;return settled;
   },
  };
 }
 private publish(change:Partial<SessionState>){
  const snapshot=change.snapshot;
  this.state=Object.freeze({...this.state,...change,...(change.failure?{failure:Object.freeze(change.failure)}:{}),...(snapshot?{snapshot:immutableSnapshot(snapshot)}:{}),automaticRecoveries:this.recoveries});
  this.listeners.forEach(listener=>listener(this.state));
 }
 private enqueue<T>(action:()=>Promise<T>){
  const task=this.tail.then(action);this.tail=task.then(()=>{},()=>{});return task;
 }
 private supersede(){
  this.intent.abort();this.seekIntent.abort();this.intent=new AbortController();this.generation++;
  const adapter=this.pending?.adapter??this.active?.adapter;
  if(adapter){const prior=this.cancellation;this.cancellation=prior.then(()=>adapter.cancelPending(),()=>adapter.cancelPending());void this.cancellation.catch(()=>{});}
  return {generation:this.generation,signal:this.intent.signal};
 }
 private save(owned:Owned):Promise<void>{
  const signature=JSON.stringify(owned.adapter.snapshot());
  if(owned.saved===signature)return Promise.resolve();
  if(owned.saving)return owned.saving.then(()=>this.save(owned));
  const task=owned.adapter.save().then(()=>{owned.saved=signature;}).catch(error=>{throw new PlaybackSessionFailure('save','播放记录尚未保存，请重试保存','save',{cause:error});});
  owned.saving=task;void task.finally(()=>{if(owned.saving===task)owned.saving=null;}).catch(()=>{});return task;
 }
 flush(){
  if(this.flushing)return this.flushing;
  const action=this.enqueue(async()=>{const active=this.active;if(active&&!active.closed)await this.save(active);});
  const settled=action.finally(()=>{if(this.flushing===settled)this.flushing=null;});this.flushing=settled;return settled;
 }

 private retire(owned:Owned){
  if(owned.closed)return Promise.resolve();if(owned.closing)return owned.closing;
  const task=(async()=>{
   await this.save(owned);
   await owned.adapter.close().catch(error=>{throw new PlaybackSessionFailure('cleanup','播放资源尚未释放，请重试关闭','close',{cause:error});});
   owned.closed=true;owned.unsubscribe();if(this.active===owned)this.active=null;if(this.pending===owned)this.pending=null;
  })();owned.closing=task;void task.catch(()=>{if(owned.closing===task)owned.closing=null;});return task;
 }
 private async activate(source:MediaSource,kind:SessionEngineKind,resume:SessionSnapshot|null,request:{generation:number;signal:AbortSignal},binding?:Binding){
  if(request.signal.aborted||request.generation!==this.generation)throw cancelled();
  const identity=Object.freeze({sessionId:crypto.randomUUID(),generation:request.generation,mediaId:source.mediaId,engineKind:kind});
  const owned:Owned={identity,source,binding,adapter:(binding?.factory??this.factories[kind])!(),unsubscribe:()=>{},closed:false,closing:null,saving:null,saved:null};
  this.pending=owned;
  try{
   owned.unsubscribe=owned.adapter.subscribe((snapshot,failure)=>{if(this.active===owned&&!owned.closed)this.publish({snapshot,...(failure?{phase:'error',failure}:{} )});});
   const snapshot=await owned.adapter.open({...source},identity,request.signal,resume);
   if(request.signal.aborted||request.generation!==this.generation)throw cancelled();
   this.active=owned;this.pending=null;this.publish({phase:'ready',identity,snapshot,failure:null});return this.state;
  }catch(error){await this.retire(owned);throw error;}
 }
 private transition(source:MediaSource,kind:SessionEngineKind,resume:SessionSnapshot|null,rollback:boolean,binding?:Binding){
  if(!Number.isSafeInteger(source.mediaId)||source.mediaId<=0||!Number.isFinite(source.resumePositionSec??0)||(source.resumePositionSec??0)<0)return Promise.reject(new RangeError('媒体会话参数无效'));
  if(!binding&&!this.factories[kind])return Promise.reject(new PlaybackSessionFailure('unsupported','此播放引擎尚未注册','open'));
  if(this.closing&&!binding)return Promise.reject(cancelled());
  source=Object.freeze({...source});if(resume)resume=immutableSnapshot(resume);
  const request=this.supersede();
  this.requestedOwner=binding?.owner??null;
  // Publish the accepted intent before its queued task starts, so desktop
  // close can cancel even the first not-yet-acquired native session.
  this.publish({phase:'opening',failure:null});
  return this.enqueue(async()=>{
   if(request.signal.aborted)throw cancelled();
   const previous=this.active,previousValue=previous?.adapter.snapshot()??this.state.snapshot,previousSnapshot=previousValue?immutableSnapshot(previousValue):null;
   if(this.recoveryMedia!==source.mediaId){this.recoveryMedia=source.mediaId;this.recoveries=0;}
   try{
    await this.cancellation;
    if(this.pending)await this.retire(this.pending);
    this.requested=source;
    if(previous)await this.retire(previous);
    return await this.activate(source,kind,resume,request,binding);
   }catch(error){
    const failure=error instanceof PlaybackSessionFailure?error:new PlaybackSessionFailure(error instanceof DOMException&&error.name==='AbortError'?'cancelled':'unknown',error instanceof Error?error.message:'播放会话失败','open',{cause:error});
    if(request.generation!==this.generation||request.signal.aborted)throw failure;
    this.publish({phase:'error',failure});
    if(rollback&&previous?.closed&&previousSnapshot&&recoverable(failure)&&this.recoveries===0){
     this.recoveries++;
     await this.activate({...previous.source,resumePositionSec:previousSnapshot.positionSec,autoplay:!previousSnapshot.paused},previous.identity.engineKind,previousSnapshot,request,previous.binding)
       .catch(recovery=>{if(request.signal.aborted||request.generation!==this.generation)throw cancelled();const failed=new PlaybackSessionFailure('initialization','原播放路径恢复失败，请手动重试','recover',{cause:recovery});this.publish({phase:'error',failure:failed});throw failed;});
     this.publish({failure});
    }
    throw failure;
   }
  });
 }
 load(source:MediaSource,kind:SessionEngineKind){return this.transition(source,kind,null,false);}
 switchEngine(kind:SessionEngineKind){
  const owned=this.active;if(!owned)return Promise.reject(new PlaybackSessionFailure('unknown','当前没有可切换的播放会话','switch'));
  const snapshot=owned.adapter.snapshot();return this.transition({...owned.source,resumePositionSec:snapshot.positionSec,autoplay:!snapshot.paused},kind,snapshot,true);
 }
 recover(failure:PlaybackSessionFailure,kind:SessionEngineKind){
  if(!recoverable(failure)||this.recoveries>=1)return Promise.reject(failure);
  const active=this.active,source=active?.source??this.requested,snapshot=active?.adapter.snapshot()??(source&&this.state.identity?.mediaId===source.mediaId?this.state.snapshot:null);
  if(!source)return Promise.reject(failure);this.recoveries++;
  return this.transition({...source,...(snapshot?{resumePositionSec:snapshot.positionSec,autoplay:!snapshot.paused}:{})},kind,snapshot,false);
 }
 seekTo(seconds:number){return this.seekForOwner(seconds);}
 private seekForOwner(seconds:number,owner?:symbol){
  if(!Number.isFinite(seconds)||seconds<0)return Promise.reject(new RangeError('跳播时间无效'));
  const owned=this.active;if(!owned||this.closing)return Promise.reject(cancelled());
  if(owner&&(owned.binding?.owner!==owner||this.requestedOwner!==owner))return Promise.reject(cancelled());
  this.seekIntent.abort();const signal=(this.seekIntent=new AbortController()).signal;
  const cancel=owned.adapter.cancelPending();void cancel.catch(()=>{});
  return this.enqueue(async()=>{await cancel;if(signal.aborted||this.active!==owned)throw cancelled();await owned.adapter.seekTo(seconds,signal);if(signal.aborted||this.active!==owned)throw cancelled();this.publish({snapshot:owned.adapter.snapshot()});});
 }
 close(){
  if(this.closing)return this.closing;
  const pendingFlush=this.flushing,pendingScopedFlushes=[...this.pendingFlushes],request=this.supersede();
  const task=this.enqueue(async()=>{
   this.publish({phase:'closing',failure:null});
   await this.cancellation;await pendingFlush;await Promise.all(pendingScopedFlushes);
   if(this.pending)await this.retire(this.pending);
   if(this.active)await this.retire(this.active);
   this.publish({phase:request.generation===this.generation?'closed':'opening',identity:null,failure:null});
  }).catch(error=>{const failure=error instanceof PlaybackSessionFailure?error:new PlaybackSessionFailure('cleanup','播放会话仍待清理，请重试关闭','close',{cause:error});this.publish({phase:'error',failure});throw failure;});
  this.closing=task;void task.finally(()=>{if(this.closing===task)this.closing=null;}).catch(()=>{});return task;
 }
}
