import {cancelled,type PlaybackEngine,type MediaSource,type PlaybackState} from './types';
export class PlaybackController {
 private engine:PlaybackEngine;
 private generation=0;
 private abort:AbortController|null=null;
 private disposed=false;
 private stopping:Promise<void>|null=null;
 private lifetime=new AbortController();
 constructor(engine:PlaybackEngine,initialGeneration=0){if(!Number.isSafeInteger(initialGeneration)||initialGeneration<0)throw new Error('播放代次无效');this.engine=engine;this.generation=initialGeneration;}
 async load(source:MediaSource,options:{signal?:AbortSignal}={}){
  if(this.disposed)throw cancelled();this.abort?.abort();const abort=new AbortController();this.abort=abort;const generation=++this.generation;
  const cancel=()=>abort.abort();options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
  let unlisten=()=>{};
  const aborted=new Promise<never>((_,reject)=>{const stop=()=>reject(cancelled());if(abort.signal.aborted)stop();else abort.signal.addEventListener('abort',stop,{once:true});unlisten=()=>abort.signal.removeEventListener('abort',stop);});
  try{await Promise.race([this.engine.load(source,{signal:abort.signal,generation}),aborted]);if(generation!==this.generation||this.disposed)throw cancelled();}
  finally{unlisten();options.signal?.removeEventListener('abort',cancel);}
 }
 private run<T>(action:()=>Promise<T>):Promise<T>{
  if(this.disposed)return Promise.reject(cancelled());const signal=this.abort?.signal??this.lifetime.signal;
  if(signal.aborted)return Promise.reject(cancelled());
  return new Promise<T>((resolve,reject)=>{
   const stop=()=>reject(cancelled());signal.addEventListener('abort',stop,{once:true});
   let task:Promise<T>;try{task=action();}catch(error){signal.removeEventListener('abort',stop);reject(error);return;}
   Promise.resolve(task).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
  });
 }
 play(){return this.run(()=>this.engine.play());}pause(){return this.run(()=>this.engine.pause());}seekTo(seconds:number){return this.run(()=>this.engine.seekTo(seconds));}
 setVolume(value:number){return this.run(()=>this.engine.setVolume(value));}setMuted(value:boolean){return this.run(()=>this.engine.setMuted(value));}setRate(value:number){return this.run(()=>this.engine.setRate(value));}
 listTracks(type?:'audio'|'subtitle'){return this.run(()=>this.engine.listTracks(type));}selectTrack(type:'audio'|'subtitle',id:string|null){return this.run(()=>this.engine.selectTrack(type,id));}setSubtitleDelay(seconds:number){return this.run(()=>this.engine.setSubtitleDelay(seconds));}
 getState(){return this.engine.getState();}
 subscribe(listener:(state:PlaybackState)=>void){if(this.disposed)return()=>{};return this.engine.subscribe(value=>{if(!this.disposed&&value.generation===this.generation)listener(value);});}
 dispose(){if(this.stopping)return this.stopping;this.disposed=true;this.abort?.abort();this.lifetime.abort();this.generation++;
  let task:Promise<void>;try{task=Promise.resolve(this.engine.dispose());}catch(error){task=Promise.reject(error);}this.stopping=task;void task.catch(()=>{if(this.stopping===task)this.stopping=null;});return task;
 }
}
