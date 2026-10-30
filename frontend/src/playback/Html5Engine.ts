import {Html5Delivery,type DeliveryOptions} from './Html5Delivery';
import {cancelled,type PlaybackEngine,type PlaybackState,type PlaybackTarget,type MediaSource,type Track,type TrackPorts} from './types';
export class Html5Engine implements PlaybackEngine {
 readonly kind='html5' as const;
 readonly delivery:Html5Delivery;
 private video:HTMLVideoElement|null=null;
 private source:MediaSource|null=null;
 private generation=0;
 private destroyed=false;
 private listeners=new Set<(state:PlaybackState)=>void>();
 private cleanup:(()=>void)[]=[];
 private clockTimer:ReturnType<typeof setTimeout>|undefined;
 private signature='';
 private status:PlaybackState['status']='idle';
 private seekAbort:AbortController|null=null;
 private options:DeliveryOptions;
 private tracks?:TrackPorts;
 constructor(options:DeliveryOptions,tracks?:TrackPorts,delivery=new Html5Delivery()){this.options=options;this.tracks=tracks;this.delivery=delivery;}
 async init(target:PlaybackTarget){
  if('nativeSurface' in target)throw new Error('HTML5 需要视频元素');const video=target;
  if(this.destroyed)throw cancelled();if(this.video){if(this.video!==video)throw new Error('播放表面不可替换');return;}this.video=video;
  for(const name of ['loadeddata','playing','pause','waiting','ended','error','durationchange','progress','volumechange','ratechange','timeupdate','seeked','seeking','resize']){
   const listener=()=>{
    if(this.destroyed||!this.source)return;
    if(name==='error')this.status='error';else if(name==='ended')this.status='ended';else if(name==='waiting'||name==='seeking')this.status='buffering';
    else if(name==='playing')this.status='playing';else if(['loadeddata','seeked','pause'].includes(name))this.status=video.paused?'paused':'playing';
    if(name==='timeupdate'){if(!this.clockTimer)this.clockTimer=setTimeout(()=>{this.clockTimer=undefined;this.publish();},200);}else this.publish();
   };video.addEventListener(name,listener);this.cleanup.push(()=>video.removeEventListener(name,listener));
  }
 }
 async load(source:MediaSource,options:{signal?:AbortSignal;generation?:number}={}){
  const video=this.current();this.seekAbort?.abort();this.generation=options.generation??this.generation+1;const generation=this.generation;this.source=source;this.status='loading';this.publish();
  try{await this.delivery.load(video,source,this.options,options.signal);}catch(error){if(!this.destroyed&&generation===this.generation&&!options.signal?.aborted){this.status='error';this.publish();}throw error;}
 }
 private current(){if(this.destroyed||!this.video)throw cancelled();return this.video;}
 async play(){const generation=this.generation;await this.current().play();if(this.destroyed||generation!==this.generation)throw cancelled();}
 async pause(){this.current().pause();}
 seekTo(seconds:number):Promise<void>{
  const video=this.current();if(!Number.isFinite(seconds)||seconds<0)return Promise.reject(new RangeError('跳播时间无效'));
  this.seekAbort?.abort();const abort=new AbortController();this.seekAbort=abort;
  const relative=Math.max(0,seconds-(this.source?.offsetSec??0));
  if(Math.abs(video.currentTime-relative)<.05&&!video.seeking){this.seekAbort=null;return Promise.resolve();}
  return new Promise((resolve,reject)=>{
   let timer:ReturnType<typeof setTimeout>;
   const cleanup=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);abort.signal.removeEventListener('abort',stop);if(this.seekAbort===abort)this.seekAbort=null;};
   const stop=()=>{cleanup();reject(cancelled());};
   const done=()=>{if(video.seeking||Math.abs(video.currentTime-relative)>.55)return;cleanup();resolve();};
   video.addEventListener('seeked',done);abort.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{cleanup();reject(new Error('跳播尚未到达目标，请重试'));},15000);
   try{video.currentTime=relative;}catch(error){cleanup();reject(error);}
  });
 }
 async setVolume(value:number){if(!Number.isFinite(value)||value<0||value>1)throw new RangeError('音量无效');this.current().volume=value;}
 async setMuted(value:boolean){if(typeof value!=='boolean')throw new TypeError('静音状态无效');this.current().muted=value;}
 async setRate(value:number){if(!Number.isFinite(value)||value<.25||value>4)throw new RangeError('倍速无效');this.current().playbackRate=value;}
 async listTracks(type?:Track['type']){this.current();return (this.tracks?.list()??[]).filter(t=>!type||t.type===type).map(t=>({...t}));}
 async selectTrack(type:Track['type'],id:string|null){this.current();if(!['audio','subtitle'].includes(type)||id!==null&&!(await this.listTracks(type)).some(t=>t.id===id))throw new Error('轨道不属于当前媒体');if(!this.tracks)throw new Error('轨道服务不可用');await this.tracks.select(type,id);}
 async setSubtitleDelay(seconds:number){this.current();if(!Number.isFinite(seconds)||seconds< -10||seconds>10)throw new RangeError('字幕延迟无效');if(!this.tracks)throw new Error('字幕服务不可用');await this.tracks.delay(seconds);}
 getState():PlaybackState{
  const v=this.video,offset=this.source?.offsetSec??0,ranges:(readonly[number,number])[]=[];
  if(v)for(let i=0;i<v.buffered.length;i++)ranges.push([v.buffered.start(i)+offset,v.buffered.end(i)+offset]);
  return {status:this.status,engine:this.kind,generation:this.generation,mediaId:this.source?.mediaId??null,positionSec:v&&Number.isFinite(v.currentTime)?v.currentTime+offset:0,
   durationSec:this.source?.durationSec??(v&&Number.isFinite(v.duration)?v.duration+offset:null),bufferedRanges:ranges,volume:v?.volume??1,muted:v?.muted??false,rate:v?.playbackRate??1,
   ...(v?.videoWidth?{videoSize:{width:v.videoWidth,height:v.videoHeight}}:{}),...(this.status==='error'?{error:{code:'HTML5_MEDIA',message:'视频解码或载入失败',recoverable:true}}:{})};
 }
 private publish(){if(this.destroyed)return;const state=this.getState(),signature=JSON.stringify(state);if(signature===this.signature)return;this.signature=signature;this.listeners.forEach(listener=>listener(state));}
 subscribe(listener:(state:PlaybackState)=>void){if(this.destroyed)return()=>{};this.listeners.add(listener);listener(this.getState());return()=>{this.listeners.delete(listener);};}
 async dispose(){if(this.destroyed)return;this.destroyed=true;this.status='destroyed';this.seekAbort?.abort();clearTimeout(this.clockTimer);this.cleanup.forEach(stop=>stop());this.cleanup=[];this.listeners.clear();this.delivery.destroy();this.video?.pause();}
}
