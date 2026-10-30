import type Hls from 'hls.js';
import {cancelled,type MediaSource} from './types';
export type DeliveryOptions={startPosition:number;duration:number;indexedTs:boolean;indexedRemux:boolean;revision:()=>number;
 beforeAttach:()=>void;onMse:()=>void;onLevel:(value:{start:number;end:number;live:boolean;hasFragments:boolean})=>void;onBuffered:()=>void;onError:(value:{fatal:boolean;code?:number;level:boolean})=>void};
export class Html5Delivery {
 private instance:Hls|null=null;
 private revision=0;
 private runtime:typeof import('hls.js').default|null=null;
 private indexedRemux=false;
 async load(video:HTMLVideoElement,source:MediaSource,options:DeliveryOptions,signal?:AbortSignal){
  this.destroy();this.indexedRemux=options.indexedRemux;const revision=this.revision;
  const active=()=>revision===this.revision&&!signal?.aborted;
  const url=new URL(source.uri,location.href);
  if(!Number.isSafeInteger(source.mediaId)||source.mediaId<=0||url.origin!==location.origin||url.username||url.password||
    !([`/media/${source.mediaId}/file`,`/media/${source.mediaId}/prepared`].includes(url.pathname)||/^\/media\/hls\/[a-f0-9]{32}\/index\.m3u8$/.test(url.pathname)))throw new Error('播放来源必须是已授权媒体服务');
  if(!active())throw cancelled();
  if(source.transport==='hls'){
   const {default:Runtime}=await import('hls.js');if(!active())throw cancelled();this.runtime=Runtime;
   if(Runtime.isSupported()){
    const instance=new Runtime({startPosition:options.startPosition,autoStartLoad:true,backBufferLength:30,maxBufferLength:30,maxMaxBufferLength:90,
     liveSyncDuration:options.indexedTs?Math.max(120,options.duration+120):120,
     xhrSetup:(xhr,url)=>{if(options.indexedRemux){if(xhr.readyState===0)xhr.open('GET',url,true);xhr.setRequestHeader('X-AVHub-Seek-Revision',String(options.revision()));}}});
    this.instance=instance;options.onMse();
    instance.on(Runtime.Events.LEVEL_LOADED,(_,data)=>{if(active())options.onLevel({start:data.details.fragments[0]?.start??0,end:data.details.fragments.reduce((end,f)=>Math.max(end,f.start+f.duration),0),live:data.details.live,hasFragments:!!data.details.fragments.length});});
    instance.on(Runtime.Events.FRAG_BUFFERED,()=>{if(active())options.onBuffered();});
    instance.on(Runtime.Events.ERROR,(_,data)=>{if(active())options.onError({fatal:data.fatal,code:data.response?.code,level:data.context?.type==='level'});});
    options.beforeAttach();instance.loadSource(source.uri);instance.attachMedia(video);return;
   }
   if(!video.canPlayType('application/vnd.apple.mpegurl'))throw new Error('当前桌面解码器不支持此播放方式');
  }
  options.beforeAttach();video.src=source.uri;
 }
 prioritizeSeek(video:HTMLVideoElement,position:number){
  if(!this.indexedRemux||!this.instance||!Number.isFinite(position)||position<0)return;
  for(let i=0;i<video.buffered.length;i++)if(position>=video.buffered.start(i)&&position<video.buffered.end(i)-.05)return;
  // A superseded fragment can otherwise put hls.js in its one-second error
  // backoff. Restart only loading at the new demand, retaining this MediaSource
  // and its buffers; the existing controller owns currentTime and play intent.
  this.instance.startLoad(position,true);
 }
 refreshPlaylist(){
  const instance=this.instance,Runtime=this.runtime,level=instance?.loadLevelObj;if(!instance||!Runtime||!level)return false;
  instance.trigger(Runtime.Events.LEVEL_LOADING,{url:level.uri,level:instance.loadLevel,levelInfo:level,pathwayId:level.attrs['PATHWAY-ID'],id:0,deliveryDirectives:null});return true;
 }
 destroy(){this.revision++;this.instance?.destroy();this.instance=null;this.runtime=null;}
}
