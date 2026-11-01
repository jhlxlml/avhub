import {IndependentSessionAdapter} from './IndependentSessionAdapter';
import {PlaybackSessionCoordinator,PlaybackSessionFailure} from './PlaybackSessionCoordinator';
type Desktop=NonNullable<Window['avhubDesktop']>;

/** Explicit opt-in wrapper; the existing trusted main owns the real process,
 * native UI, read lease, track memory and durable writes. No new player window. */
export function createIndependentDesktop(base:Desktop,root=new PlaybackSessionCoordinator({})){
 let adapter:IndependentSessionAdapter|null=null;
 const coordinator=root.scope('mpv-independent',()=>adapter=new IndependentSessionAdapter({
  invoke:(action,input)=>base.nativePlayer(action,input),onState:base.onNativeState,onClosed:base.onNativeClosed,
 },{onExternalClose:()=>{void coordinator.close().catch(()=>{});}}));
 const nativePlayer:Desktop['nativePlayer']=async(action,input)=>{
  if(action==='open'){
   const value=input as {mediaId:number;start:number;paused?:boolean};
   await coordinator.load({mediaId:value.mediaId,uri:`avhub-media:${value.mediaId}`,transport:'direct',offsetSec:0,resumePositionSec:value.start,autoplay:value.paused!==true},'mpv-independent');
   const id=adapter?.session;if(!id)throw new PlaybackSessionFailure('initialization','独立播放未返回有效会话','open');
   return {session:id,presentation:'independent'};
  }
  if(action==='recover'){await coordinator.close();return {ok:true};}
  if(action==='close'||action==='flush'){
   if(input!==adapter?.session)throw new Error('独立播放会话已过期');
   if(action==='close')await coordinator.close();else await coordinator.flush();return {ok:true};
  }
  if(action==='snapshot')return adapter?adapter.refresh():base.nativePlayer(action,input);
  if(action==='seek'){
   const value=input as {session?:unknown;value?:unknown};
   if(value?.session!==adapter?.session||typeof value.value!=='number')throw new Error('独立播放会话或跳播参数无效');
   await coordinator.seekTo(value.value);return {ok:true};
  }
  return base.nativePlayer(action,input);
 };
 return {...base,nativePlayer,getSessionState:()=>coordinator.getState(),
  cancelOpeningSession:async()=>{if(coordinator.getState().phase==='opening')await coordinator.close();},
  // The adapter's subscriptions retire with its coordinator-owned close.
  disposeEvents:()=>{},
 };
}
