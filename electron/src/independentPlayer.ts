import {mkdir,mkdtemp,writeFile,lstat,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {MpvClient} from './mpvClient';
import {independentInput} from './independentInput';
import {independentController} from './independentController';
import {captureNativeFrame} from './nativeCapture';
import {nativeTrackChoice,rememberedTrack,type MediaPlaybackState} from './nativeTrackMemory';
import {defaultSubtitleAppearance,subtitleOptions,subtitleStyle} from './nativeSubtitle';
import {startupFailure} from './nativeFailure';
type Deps={data:()=>string;runtime:()=>string;origin:()=>string;token:()=>string;log:(text:string)=>void;api:(route:string,method?:string,body?:unknown)=>Promise<any>;send:(channel:string,value:unknown)=>void};
type Session={client:MpvClient;mediaId:number;title:string;owner:string;directory?:string;closing:boolean;stopped:boolean;cleanupError:string;failed:boolean;failure?:unknown;ended:boolean;ready:boolean;timer:ReturnType<typeof setInterval>;publishTimer?:ReturnType<typeof setTimeout>;persist:Promise<unknown>;pending?:Promise<unknown>;capture?:Promise<unknown>;memory:MediaPlaybackState;externalSubtitles:string[];memoryRetired:boolean;lastMemory:string;lastAudio:string;saveError:string;revision:number;started:number};
type Activity={owner:string;media_id:number;present:boolean;playing:boolean;preparing:boolean};
/** A true MPV-owned window: no Electron video host or controls renderer. */
export class IndependentPlayer{
  private active:Session|null=null;private closing:Promise<void>|null=null;private cancelled=false;
  private activityWrites=new WeakMap<Session,Promise<unknown>>();
  private activityWanted=new WeakMap<Session,Activity>();
  private activityState=new WeakMap<Session,string>();
  constructor(private deps:Deps){}
  get hasSession(){return this.active!==null;}
  async prepareOpen(){
    const s=this.active;if(!s)return;
    if(s.stopped&&s.ready)throw new Error('播放窗口已关闭，请先重试保存或处理会话清理');
    if(!s.failed)throw new Error('请先关闭当前独立播放器');
    try{await this.close(!s.ready);}catch(cleanup){throw startupFailure(s.failure??new Error(s.client.snapshot.error||'原生会话清理未完成'),cleanup);}
  }
  private view(s:Session){return {...s.client.snapshot,session:s.client.session,mediaId:s.mediaId,title:s.title,presentation:'independent',embedded:false,revision:s.revision,saveError:s.saveError,stopped:s.stopped||s.client.snapshot.phase==='closed',recovery:s.stopped?(s.saveError?'save':'cleanup'):null,cleanupError:s.cleanupError};}
  private event(s:Session,kind:string,detail?:string){this.deps.send('avhub:native-event',{session:s.client.session,kind,detail});}
  private publish(s:Session){
    if(this.active!==s||s.closing)return;s.revision++;
    const activity=JSON.stringify(this.activityBody(s,true));
    if(this.activityState.get(s)!==activity){this.activityState.set(s,activity);void this.activity(s,true).catch(()=>this.deps.log('native-independent-priority-not-saved'));}
    if(s.client.snapshot.phase==='error'&&!s.failed){s.failed=true;this.event(s,'error',s.client.snapshot.error||'独立播放失败，未自动转码');}
    if(s.client.snapshot.phase==='ready')s.ended=false;
    if(s.ready&&s.client.snapshot.phase==='ended'&&s.client.endReason==='natural'&&!s.ended){s.ended=true;this.event(s,'ended');}
    if(!s.publishTimer)s.publishTimer=setTimeout(()=>{s.publishTimer=undefined;if(this.active===s&&!s.closing)this.deps.send('avhub:native-state',this.view(s));},200);
  }
  async open(mediaId:number,start:number){
    if(this.active)throw new Error('请先关闭当前独立播放器');this.cancelled=false;
    const owner=randomBytes(16).toString('hex');let s:Session|undefined;
    try{
      const [source,prefs,memory,item]=await Promise.all([this.deps.api(`/api/media/${mediaId}/native-read`,'POST',{owner}),this.deps.api('/api/preferences'),this.deps.api(`/api/media/${mediaId}/playback-state`),this.deps.api(`/api/media/${mediaId}`)]);
      if(this.cancelled)throw new Error('独立播放启动已取消');
      const client=new MpvClient(()=>{if(s)this.publish(s);},()=>{if(s&&this.active===s&&!s.closing)void this.close().catch(error=>this.event(s!,'error',String(error.message)));},args=>{
        if(!s||this.active!==s||s.closing||args.length!==2||args[0]!=='avhub')return;
        if(args[1]==='screenshot')void this.capture(s).catch(()=>{});
        else if(args[1]==='next'||args[1]==='previous')this.event(s,String(args[1]));
      });
      s={client,mediaId,title:String(source.title),owner,closing:false,stopped:false,cleanupError:'',failed:false,ended:false,ready:false,timer:setInterval(()=>{if(s&&!s.closing)void this.save(s).catch(()=>{});},3000),persist:Promise.resolve(),memory,externalSubtitles:(item.external_subtitles??[]).map((v:any)=>String(v.path)),memoryRetired:false,lastMemory:'',lastAudio:'',saveError:'',revision:0,started:performance.now()};
      this.active=s;
      await this.activity(s,true);
      const parent=path.join(this.deps.data(),'native-inputs');await mkdir(parent,{recursive:true});
      if((await lstat(parent)).isSymbolicLink()||await realpath(parent)!==path.join(await realpath(this.deps.data()),'native-inputs'))throw new Error('独立播放器配置目录含外部链接');
      s.directory=await mkdtemp(path.join(parent,'session-'));const input=path.join(s.directory,'input.conf');
      await writeFile(input,independentInput(prefs.values?.mouseSeekSeconds??5),{encoding:'utf8',flag:'wx'});
      const controller=path.join(s.directory,'avhub_ui.lua');await writeFile(controller,independentController,{encoding:'utf8',flag:'wx'});
      if(this.cancelled)throw new Error('独立播放启动已取消');
      const restore=async()=>{
        const tracks=await client.command(['get_property','track-list']) as any[];
        for(const [kind,choice] of [['audio',memory.audio],['sub',memory.subtitle]] as const){const id=nativeTrackChoice(tracks,kind,choice);if(id!==undefined)await client.command(['set_property',kind==='audio'?'aid':'sid',id]);}
        if(memory.subtitle&&!memory.subtitle.startsWith('embedded:')&&item.external_subtitles?.some((v:any)=>v.path===memory.subtitle))await client.command(['sub-add',memory.subtitle,'select']);
        await client.command(['set_property','sub-delay',memory.delay]);
      };
      const audio=prefs.values?.audio||{volume:1,muted:false},style=subtitleStyle(prefs.values?.subtitleAppearance??defaultSubtitleAppearance);
      await client.start(this.deps.runtime(),String(source.path),null,start,[`--volume=${Math.max(0,Math.min(100,Number(audio.volume)*100))}`,`--mute=${audio.muted===true?'yes':'no'}`,`--speed=${Number(prefs.values?.playbackSpeed)||1}`,'--sub-ass-override=no',...subtitleOptions(style).map(([key,value])=>`--${key}=${value}`)],memory.audio!==null||memory.subtitle!==null||memory.delay!==0?restore:undefined,input,controller);
      const uiDeadline=performance.now()+2000;let uiReady=false;
      do{
        try{uiReady=await client.command(['get_property','user-data/avhub-ui/version'])===1;}catch{}
        if(uiReady)break;if(s.closing||this.cancelled)throw new Error('独立播放启动已取消');
        await new Promise(resolve=>setTimeout(resolve,25));
      }while(performance.now()<uiDeadline);
      if(!uiReady)throw new Error('独立播放控制栏初始化失败，请重试或切回内嵌模式');
      await client.command(['script-message-to','avhub_ui','title',s.title]);
      if(this.active!==s||s.closing||this.cancelled||['closed','error'].includes(client.snapshot.phase))throw new Error(client.snapshot.error||'独立播放启动已取消');
      s.ready=true;this.publish(s);this.deps.log('native-player-start engine=mpv presentation=independent source=original');
      return {session:client.session,presentation:'independent'};
    }catch(error){
      if(s){s.failed=true;s.failure=error;try{await this.close(true);}catch(cleanup){throw startupFailure(error,cleanup);}}
      else{try{await this.deps.api(`/api/native-read/${owner}`,'DELETE');}catch(cleanup){throw startupFailure(error,cleanup);}}
      throw error;
    }
  }
  private activityBody(s:Session,present:boolean):Activity{
    const snap=s.client.snapshot,live=present&&!s.stopped&&snap.phase!=='closed';
    const preparing=live&&(snap.phase==='starting'||snap.pendingSeek!=null||snap.seekMode!=null||snap.properties.seeking===true);
    return {owner:s.owner,media_id:s.mediaId,present:present&&!s.stopped,playing:live&&(preparing||snap.properties.pause===false&&snap.properties['eof-reached']!==true),preparing};
  }
  private activity(s:Session,present:boolean):Promise<unknown>{
    this.activityWanted.set(s,this.activityBody(s,present));
    const running=this.activityWrites.get(s);if(running)return running;
    const task:Promise<unknown>=Promise.resolve().then(async()=>{
      while(this.activityWanted.has(s)){
        const body=this.activityWanted.get(s)!;this.activityWanted.delete(s);
        try{await this.deps.api('/api/playback/activity','POST',body);}catch(error){if(!this.activityWanted.has(s))throw error;}
      }
    }).finally(()=>{
      if(this.activityWrites.get(s)===task)this.activityWrites.delete(s);
      const remaining=this.activityWanted.get(s);if(remaining)return this.activity(s,remaining.present);
    });
    this.activityWrites.set(s,task);return task;
  }
  private save(s:Session,final=false){
    if(!final&&s.pending)return s.pending;
    const task=s.persist.catch(()=>{}).then(async()=>{
      const p=s.client.playbackProperties??s.client.snapshot.properties,writes:Promise<unknown>[]=[],values:Record<string,unknown>={};
      if(typeof p['time-pos']==='number')writes.push(this.deps.api(`/api/media/${s.mediaId}/progress`,'PUT',{progress:p['time-pos'],watched:p['eof-reached']===true,updated_at:Date.now()}));
      if(s.ready){
        const tracks=Array.isArray(p['track-list'])?p['track-list']:[],audio=rememberedTrack(tracks,'audio',p.aid as number);
        const external=tracks.find((t:any)=>t.type==='sub'&&t.id===p.sid&&t.external)?.['external-filename'];
        const subtitle=external&&s.externalSubtitles.includes(external)?external:rememberedTrack(tracks,'sub',p.sid===false?'no':p.sid as number|string);
        const changes={...(audio!==undefined?{audio}:{}),...(subtitle!==undefined?{subtitle}:{}),...(typeof p['sub-delay']==='number'?{delay:p['sub-delay']}:{})};
        const signature=JSON.stringify(changes);
        if(!s.memoryRetired&&signature!==s.lastMemory&&Object.keys(changes).length)writes.push(this.deps.api(`/api/media/${s.mediaId}/playback-state`,'PATCH',{source:s.memory.source,changes,updated_at:Date.now()}).then(()=>{s.lastMemory=signature;}).catch(error=>{if(error.status===409)s.memoryRetired=true;else throw error;}));
        if(typeof p.volume==='number'&&typeof p.mute==='boolean'&&typeof p.speed==='number'){
          const audioState={audio:{volume:Math.max(0,Math.min(1,p.volume/100)),muted:p.mute},...([.5,.75,1,1.25,1.5,2].includes(p.speed)?{playbackSpeed:p.speed}:{})};const audioSignature=JSON.stringify(audioState);
          if(audioSignature!==s.lastAudio){Object.assign(values,audioState);writes.push(this.deps.api('/api/preferences','PATCH',{values,updated_at:Date.now()}).then(()=>{s.lastAudio=audioSignature;}));}
        }
      }
      if(!final)void this.activity(s,true).catch(()=>this.deps.log('native-independent-priority-not-saved'));
      const previous=s.saveError;
      try{const settled=await Promise.allSettled(writes),failed=settled.find(value=>value.status==='rejected');if(failed?.status==='rejected')throw failed.reason;s.saveError='';}catch(error){s.saveError='播放进度或设置尚未保存，请重试保存';throw error;}
      finally{if(previous!==s.saveError)this.publish(s);}
    });s.persist=task;s.pending=task;void task.finally(()=>{if(s.pending===task)s.pending=undefined;}).catch(()=>{});return task;
  }
  private capture(s:Session){
    if(s.capture)return s.capture;if(s.closing)return Promise.reject(new Error('独立播放正在关闭'));
    const task=(async()=>{
      try{await s.client.command(['script-message-to','avhub_ui','capture','pending']);const result=await captureNativeFrame(this.deps,s);await s.client.command(['script-message-to','avhub_ui','capture','saved']).catch(()=>{});return result;}
      catch(error){await s.client.command(['script-message-to','avhub_ui','capture','error']).catch(()=>{});this.event(s,'error',error instanceof Error?error.message:'截图失败');throw error;}
    })();s.capture=task;void task.finally(()=>{if(s.capture===task)s.capture=undefined;}).catch(()=>{});return task;
  }
  async invoke(action:unknown,input:unknown){
    const s=this.active;if(!s)throw new Error('独立播放已关闭');
    if(action==='snapshot')return this.view(s);
    if(action==='recover'){await this.prepareOpen();return {ok:true};}
    if(['close','discard-close','show','flush','replay'].includes(String(action))){
      if(input!==s.client.session)throw new Error('独立播放会话已过期');
      if(s.closing&&action!=='close')throw new Error('独立播放正在关闭');
      if(action==='close')await this.close();
      else if(action==='discard-close'){
        if(!s.stopped||!s.saveError)throw new Error('没有可放弃的已关闭播放进度');
        await this.close(true);
      }
      else if(action==='flush')await this.save(s,true);
      else{
        if(s.stopped)throw new Error('播放窗口已关闭，请先处理未保存进度');
        if(action==='show')await s.client.command(['set_property','window-minimized',false]);
        else{s.client.seek(0);await s.client.command(['set_property','pause',false]);}
      }
      return {ok:true};
    }
    if(!input||typeof input!=='object'||(input as any).session!==s.client.session||s.closing)throw new Error('独立播放会话已过期');
    if(action==='screenshot')return this.capture(s);
    throw new Error('此操作由独立 MPV 窗口控制');
  }
  async cancelStartup(){this.cancelled=true;if(this.active)await this.active.client.stop();}
  close(discard=false):Promise<void>{
    if(this.closing)return this.closing;const s=this.active;if(!s)return Promise.resolve();
    this.closing=(async()=>{
      s.closing=true;clearInterval(s.timer);clearTimeout(s.publishTimer);
      s.publishTimer=undefined;s.cleanupError='';
      if(s.capture){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([s.capture.catch(()=>{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('截图仍在保存，请稍后重试关闭')),5000);})]);}finally{clearTimeout(timer);}}
      // Saving can fail after the user has closed the native window. Confirm
      // process exit and release its fence independently; retain the snapshot
      // for an explicit retry/discard instead of claiming it is still playing.
      let unsaved:unknown;
      if(discard)await s.persist.catch(()=>{});
      else await this.save(s,true).catch(error=>{unsaved=error;});
      await s.client.stop();s.stopped=true;
      try{
        await this.activity(s,false);await this.deps.api(`/api/native-read/${s.owner}`,'DELETE');
      }catch(error){s.cleanupError='播放窗口已关闭，文件占用保护尚未清理，请重试';throw error;}
      if(s.directory){const parent=path.join(await realpath(this.deps.data()),'native-inputs');if(!(await lstat(s.directory)).isSymbolicLink()&&await realpath(s.directory)===path.join(parent,path.basename(s.directory)))await rm(s.directory,{recursive:true,force:true});else this.deps.log('native-input-cleanup-refused ownership-changed');}
      s.directory=undefined;
      if(unsaved)throw new Error(s.saveError);
      this.active=null;this.deps.send('avhub:native-closed',{session:s.client.session,mediaId:s.mediaId,ended:s.client.snapshot.properties['eof-reached']===true});this.deps.log('native-independent-closed');
    })().finally(()=>{if(this.active===s){s.closing=false;if(!s.stopped)s.timer=setInterval(()=>{if(!s.closing)void this.save(s).catch(()=>{});},3000);this.publish(s);}this.closing=null;});return this.closing;
  }
}
