import {cancelled,type MediaSource,type PlaybackEngine} from './types';
import {PlaybackSessionFailure,type SessionAdapter,type SessionIdentity,type SessionSnapshot} from './PlaybackSessionCoordinator';

/** Uses the existing delivery/controller and durable writer. No second HLS
 * instance, progress writer, source request or automatic conversion lives here. */
export class ChromiumSessionAdapter implements SessionAdapter {
 private cancellation=new AbortController();
 private frozen:SessionSnapshot|null=null;
 private frozenEnded=false;
 private decoded=false;
 constructor(private engine:Pick<PlaybackEngine,'getState'|'subscribe'|'seekTo'|'dispose'>&{cancelPending:()=>void},private video:HTMLVideoElement,private ports:{
  open:(source:MediaSource,identity:SessionIdentity,signal:AbortSignal)=>Promise<void>;
  tracks:()=>SessionSnapshot['tracks'];
  save:(snapshot:SessionSnapshot|null,ended:boolean)=>Promise<void>;
  release:()=>Promise<void>;
 }){}
 snapshot():SessionSnapshot{
  if(this.frozen)return this.frozen;
  const s=this.engine.getState();return {positionSec:s.positionSec,paused:this.video.paused,volume:s.volume,muted:s.muted,rate:s.rate,tracks:this.ports.tracks()};
 }
 // React cleanup resets shared refs before asynchronous close reaches its save
 // barrier. Capture the old source clock now; never read the replacement clock.
 captureForClose(){
  this.decoded=this.video.readyState>=2&&this.video.videoWidth>0;
  this.frozenEnded=this.video.ended;
  this.frozen={...this.snapshot(),tracks:{...this.ports.tracks()}};
 }
 subscribe(listener:Parameters<SessionAdapter['subscribe']>[0]){
  return this.engine.subscribe(state=>listener(this.snapshot(),state.status==='error'?new PlaybackSessionFailure('unsupported','视频解码或载入失败','playback'):undefined));
 }
 private waitForFrame(signal:AbortSignal,target?:number){
  return new Promise<void>((resolve,reject)=>{
   let frame=0,timer:ReturnType<typeof setTimeout>,settled=false,presentedTime:number|null=null;
   const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(frame)this.video.cancelVideoFrameCallback(frame);this.video.removeEventListener('seeked',check);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
   const abort=()=>finish(cancelled());
   const check=()=>{
    const s=this.engine.getState();
    if(signal.aborted){abort();return;}
    if(this.video.error){finish(new PlaybackSessionFailure('unsupported','视频解码或载入失败','playback'));return;}
    const offset=s.positionSec-this.video.currentTime;
    if(presentedTime!==null&&this.video.readyState>=2&&this.video.videoWidth>0&&!this.video.seeking&&(target===undefined||Math.abs(presentedTime+offset-target)<.55)){this.decoded=true;finish();}
   };
   const observe=(_now:number,metadata:VideoFrameCallbackMetadata)=>{frame=0;presentedTime=metadata.mediaTime;check();if(!settled)frame=this.video.requestVideoFrameCallback(observe);};
   timer=setTimeout(()=>finish(new PlaybackSessionFailure('unknown','尚未确认目标视频画面，请重试','playback')),45000);
   signal.addEventListener('abort',abort,{once:true});
   this.video.addEventListener('seeked',check);
   if(signal.aborted)abort();else frame=this.video.requestVideoFrameCallback(observe);
  });
 }
 async open(source:MediaSource,identity:SessionIdentity,signal:AbortSignal){
  const observation=new AbortController();
  const frame=this.waitForFrame(AbortSignal.any([signal,this.cancellation.signal,observation.signal]));void frame.catch(()=>{});
  try{await this.ports.open(source,identity,signal);await frame;return this.snapshot();}finally{observation.abort();}
 }
 async seekTo(seconds:number,signal:AbortSignal){
  const combined=AbortSignal.any([signal,this.cancellation.signal]);
  if(combined.aborted)throw cancelled();
  if(Math.abs(this.engine.getState().positionSec-seconds)<.05&&!this.video.seeking&&this.video.readyState>=2)return;
  // Register before dispatch: paused seeks may present their only frame before
  // the seeked promise's continuation executes.
  const observation=new AbortController();
  const frame=this.waitForFrame(AbortSignal.any([combined,observation.signal]),seconds);
  void frame.catch(()=>{});
  try{await this.engine.seekTo(seconds);await frame;}finally{observation.abort();}
 }
 async cancelPending(){this.cancellation.abort();this.cancellation=new AbortController();this.engine.cancelPending();}
 async save(){await this.ports.save(this.decoded?this.snapshot():null,this.frozen?this.frozenEnded:this.video.ended);}
 async close(){await this.cancelPending();await this.engine.dispose();await this.ports.release();}
}
