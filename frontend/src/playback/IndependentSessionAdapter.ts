import {cancelled,type MediaSource} from './types';
import {PlaybackSessionFailure,type SessionAdapter,type SessionIdentity,type SessionSnapshot} from './PlaybackSessionCoordinator';
import {classifyNativeFailure} from './nativeRecovery';
import {nativeErrorText} from '../nativeError';

export type IndependentSessionPort={
 invoke:(action:string,input?:unknown)=>Promise<unknown>;
 onState:(listener:(value:unknown)=>void)=>()=>void;
 onClosed:(listener:(value:unknown)=>void)=>()=>void;
};
const finite=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
// The native IPC boundary owns decoding unknown messages. Only typed values
// enter the adapter; source paths and raw MPV commands never cross this port.
function readState(input:unknown){
 if(!input||typeof input!=='object')return null;
 const v=input as Record<string,unknown>;
 if(typeof v.session!=='string'||!v.session||!Number.isSafeInteger(v.mediaId)||Number(v.mediaId)<1||!Number.isSafeInteger(v.revision)||Number(v.revision)<0||typeof v.phase!=='string'||!['starting','ready','ended','error','closed'].includes(v.phase)||!v.properties||typeof v.properties!=='object'||Array.isArray(v.properties)||!Number.isSafeInteger(v.restarts)||Number(v.restarts)<0)return null;
 const p=v.properties as Record<string,unknown>;
 const snapshot:SessionSnapshot|null=finite(p['time-pos'])&&typeof p.pause==='boolean'&&finite(p.volume,0,100)&&typeof p.mute==='boolean'&&finite(p.speed,.25,4)?{
  positionSec:p['time-pos'],paused:p.pause,volume:p.volume/100,muted:p.mute,rate:p.speed,
  tracks:{sourceIdentity:typeof v.sourceIdentity==='string'&&/^[a-f0-9]{64}$/.test(v.sourceIdentity)?v.sourceIdentity:null,
   audio:finite(p.aid,1)?String(p.aid):null,subtitle:finite(p.sid,1)?String(p.sid):null,delaySec:finite(p['sub-delay'],-10,10)?p['sub-delay']:0},
 }:null;
 return {session:v.session,mediaId:Number(v.mediaId),revision:Number(v.revision),phase:v.phase,restarts:Number(v.restarts),snapshot,
  pending:v.pendingSeek!=null||v.seekMode!=null||p.seeking===true,
  target:finite(v.lastSeekTarget)?v.lastSeekTarget:null,position:finite(v.lastSeekPosition)?v.lastSeekPosition:null,
  duration:finite(p.duration)?p.duration:null,error:typeof v.error==='string'?v.error:'',
  recovery:v.recovery==='save'||v.recovery==='cleanup'?v.recovery:null};
}

/** Lifecycle/seek orchestration over the existing authoritative native owner.
 * Native window controls keep using MpvClient's queue without a renderer hop.
 * Aborting a JS wait does not pretend the decoder or read lease has exited. */
export class IndependentSessionAdapter implements SessionAdapter {
 private nativeSession:string|null=null;private mediaId=0;private started=false;private retired=false;
 private latest:ReturnType<typeof readState>=null;
 private value:SessionSnapshot={positionSec:0,paused:true,volume:1,muted:false,rate:1,tracks:{sourceIdentity:null,audio:null,subtitle:null,delaySec:0}};
 private pending=new AbortController();
 private listeners=new Set<Parameters<SessionAdapter['subscribe']>[0]>();private checks=new Set<()=>void>();
 constructor(private port:IndependentSessionPort,private options:{timeoutMs?:number;onExternalClose?:()=>void}={}){}
 get session(){return this.nativeSession;}
 snapshot(){return this.value;}
 private receive(value:unknown){
  const state=readState(value);
  if(!state||this.retired||state.session!==this.nativeSession||state.mediaId!==this.mediaId||state.revision<(this.latest?.revision??-1))return;
  this.latest=state;if(state.snapshot)this.value=state.snapshot;
  const failure=state.phase==='error'?new PlaybackSessionFailure(classifyNativeFailure(state.error),nativeErrorText(new Error(state.error))||'独立播放失败','playback'):undefined;
  this.listeners.forEach(listener=>listener(this.value,failure));this.checks.forEach(check=>check());
 }
 subscribe(listener:Parameters<SessionAdapter['subscribe']>[0]){
  this.listeners.add(listener);
  const state=this.port.onState(value=>this.receive(value));
  const closed=this.port.onClosed(value=>{
   if(!value||typeof value!=='object'||!('session'in value)||value.session!==this.nativeSession||this.retired)return;
   this.retired=true;this.cancelPending();this.options.onExternalClose?.();
  });
  return()=>{this.listeners.delete(listener);state();closed();};
 }
 private waitFor(predicate:(state:NonNullable<ReturnType<typeof readState>>)=>boolean,signal:AbortSignal,operation:'open'|'seek'){
  return new Promise<void>((resolve,reject)=>{
   const finish=(error?:Error)=>{clearTimeout(timer);this.checks.delete(check);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
   const abort=()=>finish(cancelled());
   const check=()=>{const s=this.latest;if(signal.aborted||this.retired){abort();return;}if(s?.phase==='error'){finish(new PlaybackSessionFailure(classifyNativeFailure(s.error),nativeErrorText(new Error(s.error))||'独立播放失败',operation));return;}if(s&&predicate(s))finish();};
   const timer=setTimeout(()=>finish(new PlaybackSessionFailure('unknown',operation==='open'?'独立播放尚未确认解码就绪，请重试':'跳播尚未确认目标画面，请重试',operation)),this.options.timeoutMs??(operation==='open'?30000:15000));
   this.checks.add(check);signal.addEventListener('abort',abort,{once:true});check();
  });
 }
 async refresh(){const value=await this.port.invoke('snapshot');this.receive(value);return value;}
 async open(source:MediaSource,identity:SessionIdentity,signal:AbortSignal,resume:SessionSnapshot|null){
  this.mediaId=identity.mediaId;this.value=resume??{...this.value,positionSec:source.resumePositionSec??0,paused:source.autoplay===false};
  if(signal.aborted)throw cancelled();this.started=true;
  let result:unknown;
  try{result=await this.port.invoke('open',{mediaId:this.mediaId,start:this.value.positionSec,paused:this.value.paused});}
  catch(error){const text=nativeErrorText(error);throw error instanceof PlaybackSessionFailure?error:new PlaybackSessionFailure(classifyNativeFailure(text),text,'open',{cause:error});}
  if(!result||typeof result!=='object'||!('session'in result)||typeof result.session!=='string'||!result.session)throw new PlaybackSessionFailure('initialization','独立播放未返回有效会话','open');
  this.nativeSession=result.session;
  if(!('presentation'in result)||result.presentation!=='independent')throw new PlaybackSessionFailure('unsupported','播放窗口模式已改变，请重新打开视频','open');
  if(signal.aborted)throw cancelled();await this.refresh();
  await this.waitFor(s=>['ready','ended'].includes(s.phase)&&s.snapshot!==null,AbortSignal.any([signal,this.pending.signal]),'open');
  return this.value;
 }
 async seekTo(seconds:number,signal:AbortSignal){
  if(!this.nativeSession||this.retired||signal.aborted)throw cancelled();
  const state=this.latest;if(!state)throw new PlaybackSessionFailure('unknown','独立播放尚未就绪','seek');
  const target=Math.min(seconds,state.duration===null?Number.MAX_SAFE_INTEGER:Math.max(0,state.duration-.01)),before=state.restarts;
  const waitSignal=AbortSignal.any([signal,this.pending.signal]);
  await this.port.invoke('seek',{session:this.nativeSession,value:target});
  await this.waitFor(s=>!s.pending&&s.restarts>before&&s.target!==null&&Math.abs(s.target-target)<.01&&s.position!==null&&Math.abs(s.position-target)<.3,waitSignal,'seek');
 }
 async cancelPending(){this.pending.abort();this.pending=new AbortController();}
 async save(){if(this.nativeSession&&!this.retired)await this.port.invoke('flush',this.nativeSession);}
 async close(){
  await this.cancelPending();if(this.retired||!this.started)return;
  if(this.nativeSession)await this.port.invoke('close',this.nativeSession);else await this.port.invoke('recover');
  this.retired=true;
 }
}
