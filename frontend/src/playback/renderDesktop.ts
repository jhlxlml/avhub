import {MpvEngine,type NativeEnginePort} from './MpvEngine';
import {PlaybackController} from './PlaybackController';
import {selectEngine} from './EngineSelector';
type Desktop=NonNullable<Window['avhubDesktop']>;
/** Reuse the existing desktop playback UI, while standard transport controls go
 * through PlaybackEngine. No media paths or native commands are accepted here. */
export function createRenderDesktop(base:Desktop){
 let element:HTMLElement|null=null,surface='',engine:MpvEngine|null=null,controller:PlaybackController|null=null,generation=0,latest:any=null,pendingTarget:number|null=null,seekSequence=0;
 const states=new Set<(s:any)=>void>(),events=new Set<(s:any)=>void>(),closed=new Set<(s:any)=>void>();
 const view=(s:any)=>({...s,presentation:'render',error:s.error?.message||'',pendingSeek:s.pendingSeek??null});
 const dispatch=(s:any)=>{if(!surface||s.surface!==surface)return;latest=s;if(s.properties)base.transformRenderSurface(surface,{rotation:Number(s.properties['video-rotate']||0),zoom:Number(s.properties['video-zoom']||0),x:Number(s.properties['video-pan-x']||0),y:Number(s.properties['video-pan-y']||0)});for(const listener of states)listener(view(s));};
 const unsubscribe:(()=>void)[]=[];function listen(){if(unsubscribe.length)return;unsubscribe.push(base.onRenderState(dispatch),base.onRenderEvent(e=>{for(const fn of events)fn(e);}),base.onRenderClosed(e=>{for(const fn of closed)fn(e);}));}
 const port:NativeEnginePort={
  attach:async target=>{const id='avhub-render-'+crypto.randomUUID(),previous=target.id;target.id=id;await base.attachRenderSurface(id);surface=id;return async()=>{await base.detachRenderSurface(id);if(target.id===id)target.id=previous;if(surface===id)surface='';};},
  open:async source=>{const value=await base.renderPlayer('open',source);dispatch(value);return value;},
  command:async(session,generation,action,value)=>{await base.renderPlayer('command',{session,generation,action,value});},
  subscribe:listener=>base.onRenderState(value=>{if(surface&&value.surface===surface)listener(value);}),
  close:async(session,generation)=>{await base.renderPlayer('close',{session,generation});},
 };
 const request=(action:string,value?:unknown)=>{const s=engine?.getSession();if(!s)throw new Error('原生播放尚未就绪');return base.renderPlayer(action,{session:s.id,generation:s.generation,value});};
 async function retire(){const owned=engine,control=controller;try{await (control??owned)?.dispose();}catch(error){if(!surface)throw error;await base.renderPlayer('recover',{surface});await (control??owned)?.dispose();}if(engine===owned){engine=null;controller=null;}}
 async function seek(seconds:number){if(!controller)throw new Error('原生播放尚未就绪');const current=++seekSequence,length=controller.getState().durationSec;pendingTarget=Math.max(0,Math.min(length?Math.max(0,length-.01):Number.MAX_VALUE,seconds));try{await controller.seekTo(pendingTarget);}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))throw e;}finally{if(current===seekSequence)pendingTarget=null;}return {ok:true};}
 const nativePlayer:Desktop['nativePlayer']=async(action,input)=>{
  if(action==='status')return base.renderPlayer('status');
  if(action==='open'){
   if(!element||engine||selectEngine({preference:'mpv',nativeEnabled:true,registered:['html5','mpv'],nativeScope:'sdr-trial',sourceKind:'local'}).kind!=='mpv')throw new Error('原生播放区域不可用');const r=input as {mediaId:number;start:number;paused?:boolean};engine=new MpvEngine(port);controller=new PlaybackController(engine,generation++);
   try{await engine.init({nativeSurface:element});await controller.load({mediaId:r.mediaId,uri:`avhub-media:${r.mediaId}`,transport:'direct',offsetSec:0,resumePositionSec:r.start,autoplay:r.paused!==true});const s=engine.getSession();return {session:s!.id,presentation:'render'};}
   catch(error){try{await retire();}catch{/* Retain ownership; recover/close is explicitly retried. */}throw error;}
  }
  if(action==='close'||action==='recover'){
   if(action==='close'&&input!==engine?.getSession()?.id)throw new Error('原生播放会话已过期');await retire();return {ok:true};
  }
  if(action==='snapshot'){const s=await request('snapshot');dispatch(s);return view(s);}
  if(action==='flush'){if(input!==engine?.getSession()?.id)throw new Error('原生播放会话已过期');return request('flush');}
  if(!engine||!controller)throw new Error('原生播放已关闭');
  const supplied=typeof input==='string'?input:(input as {session?:unknown})?.session;
  if(!engine.getSession()||supplied!==engine.getSession()!.id)throw new Error('原生播放会话已过期');
  const value=(input as {value?:any})?.value;
  if(action==='pause'){await (value?controller.pause():controller.play());return {ok:true};}
  if(action==='seek')return seek(Number(value));if(action==='seek-relative')return seek((pendingTarget??engine.getState().positionSec)+Number(value));
  if(action==='volume'){await controller.setVolume(Number(value)/100);return {ok:true};}if(action==='mute'){await controller.setMuted(value);return {ok:true};}if(action==='speed'){await controller.setRate(value);return {ok:true};}
  if(action==='track'){await controller.selectTrack(value.kind==='sub'?'subtitle':'audio',value.id==='no'?null:String(value.id));return {ok:true};}if(action==='sub-delay'){await controller.setSubtitleDelay(value);return {ok:true};}
  if(action==='navigate'){if(!['next','previous','queue','retry'].includes(value))throw new Error('队列操作无效');for(const fn of events)fn({session:engine.getSession()!.id,kind:value});return {ok:true};}
  if(action==='replay'){await seek(0);await controller.play();return {ok:true};}
  if(action==='diagnostics')return {engine:'libmpv-render-d3d11',phase:latest?.phase,firstFrameMs:latest?.firstFrameMs,lastSeekMs:latest?.lastSeekMs,sourceLoads:1,transport:latest?.transport,dimensions:engine.getState().videoSize};
  if(['screenshot','subtitle-import','subtitle-style','transform','rotate','window'].includes(action))return request(action,value);
  throw new Error('此原生操作尚未接通');
 };
 return {...base,nativePlayer,onNativeState:(fn:(s:any)=>void)=>{states.add(fn);return()=>states.delete(fn);},onNativeEvent:(fn:(s:any)=>void)=>{events.add(fn);return()=>events.delete(fn);},onNativeClosed:(fn:(s:any)=>void)=>{closed.add(fn);return()=>closed.delete(fn);},
  attachSurface:(node:HTMLElement)=>{element=node;listen();},disposeEvents:()=>{unsubscribe.splice(0).forEach(fn=>fn());states.clear();events.clear();closed.clear();},
 };
}
