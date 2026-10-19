import {spawn,type ChildProcess} from 'node:child_process';
import {connect,type Socket} from 'node:net';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startupFailure} from './nativeFailure';
import {audioOutputStatus,audioOutputFailure,type AudioOutputStatus} from './nativeAudio';

export const mpvProperties=['time-pos','duration','pause','paused-for-cache','seeking','eof-reached','volume','mute','speed','video-params','video-codec','audio-codec-name','current-ao','hwdec-current','frame-drop-count','decoder-frame-drop-count','track-list','aid','sid','sub-delay','video-rotate','video-zoom','video-pan-x','video-pan-y','mpv-version'] as const;
export type NativeFailureCode='audio-output'|'video-output'|'decode'|'source'|'unknown';
export type MpvSnapshot={session:string;phase:'starting'|'ready'|'ended'|'error'|'closed';error?:string;failureCode?:NativeFailureCode|null;audioOutput?:AudioOutputStatus;properties:Record<string,unknown>;restarts:number;seeks:number;seekCorrections:number;pendingSeek:number|null;seekMode:'native'|'coordinated'|null;lastSeekTarget:number|null;lastSeekPosition:number|null;firstFrameMs:number|null;readyMs:number|null;lastSeekMs:number|null;lastSeekTotalMs:number|null;sourceLoads:number;bufferingEvents:number;bufferingMs:number};

/** Owned process, bounded JSON transport, acknowledgements, latest-intent seek queue.
 * Renderer never receives a raw mpv command interface or filesystem path.
 */
export class MpvClient {
  readonly session=randomBytes(16).toString('hex');
  readonly snapshot:MpvSnapshot={session:this.session,phase:'starting',properties:{},restarts:0,seeks:0,seekCorrections:0,pendingSeek:null,seekMode:null,lastSeekTarget:null,lastSeekPosition:null,firstFrameMs:null,readyMs:null,lastSeekMs:null,lastSeekTotalMs:null,sourceLoads:0,bufferingEvents:0,bufferingMs:0};
  private child:ChildProcess|null=null;
  private socket:Socket|null=null;
  private sequence=0;
  private requests=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private buffer='';
  private started=performance.now();
  private seekActive=false;
  private seekDispatching=false;
  private restartWhileDispatching=false;
  private latestSeek:number|null=null;
  private seekStarted=0;
  private latestSeekRequestedAt=0;
  private seekRequestedAt=0;
  private bufferingStarted:number|null=null;
  private seekTarget=0;
  private seekRevision=0;
  private manualEnd=false;
  private settledPosition=0;
  private nativeTargetKnown=false;
  private seekWasPaused=false;
  private finalProperties:Record<string,unknown>|null=null;
  private lastPosition:number|null=null;
  endReason:'natural'|'seek'|null=null;
  private correcting=false;
  private restartWhileChecking=false;
  private correctionCount=0;
  private demuxerOffset=0;
  private seekTimer:ReturnType<typeof setTimeout>|undefined;
  private readyTimer:ReturnType<typeof setTimeout>|undefined;
  private startupExpired=false;
  private closed=false;
  private fileLoaded=false;
  private fileRestarted=false;
  private audioDevicesObserved=false;
  private nativeWindow=false;
  private nativeShutdown=false;
  private expectedNativeExit=false;
  private stopping:Promise<void>|null=null;
  private exited:Promise<void>=Promise.resolve();
  startupStage='process';
  constructor(private publish:(value:MpvSnapshot)=>void,private onExit:()=>void,private onMessage?:(args:unknown[])=>void){}
  get processId(){return this.child?.pid??null;}
  // MPV invalidates time/track properties while unloading on native Q/X.
  // Keep persistence separate from the live render snapshot: a saved clock
  // must never be used as evidence that a new frame has decoded.
  get playbackProperties(){const p=this.finalProperties??this.snapshot.properties;return typeof p['time-pos']==='number'||this.lastPosition===null?p:{...p,'time-pos':this.lastPosition};}
  private preservePlayback(){if(!this.finalProperties)this.finalProperties={...this.playbackProperties};}
  emit(){this.publish(structuredClone(this.snapshot));}
  async start(executable:string,source:string,handle:string|null,start:number,extra:string[]=[],beforePlay?:()=>Promise<void>,input?:string,controller?:string) {
    if(this.closed)throw new Error('原生播放启动已取消');
    const pipe=`\\\\.\\pipe\\avhub-mpv-${this.session}`;
    this.nativeWindow=handle===null;
    if(this.nativeWindow&&!input)throw new Error('独立播放器控制配置未就绪');
    const windowOptions=this.nativeWindow?['--osc='+(!controller?'yes':'no'),...(controller?[`--script=${controller}`,'--border=no','--input-builtin-dragging=no','--window-dragging=no','--cursor-autohide=400','--osd-bar=no','--osd-on-seek=no','--osd-font=Segoe UI','--osd-font-size=20','--osd-border-size=1.5','--osd-shadow-offset=0','--osd-color=#f2f2f4','--osd-border-color=#141416']:[]),'--input-vo-keyboard=yes','--input-cursor=yes','--force-window=yes','--title=AVHub · MPV','--autofit=85%x85%',`--input-conf=${input}`,'--drag-and-drop=no','--autocreate-playlist=no','--load-commands=no','--load-select=no','--load-context-menu=no']:['--osc=no','--input-vo-keyboard=no','--input-cursor=no',`--wid=${handle}`];
    this.child=spawn(executable,['--no-config','--load-scripts=no','--ytdl=no','--access-references=no',...windowOptions,'--input-default-bindings=no','--input-terminal=no','--terminal=no',
      '--keep-open=yes','--idle=yes','--pause=yes','--stop-playback-on-init-failure=yes','--hwdec=auto-safe','--vo=gpu-next','--gpu-api=d3d11','--hr-seek=yes','--cache=yes','--demuxer-max-bytes=96MiB','--demuxer-max-back-bytes=32MiB',
      // PNG level/filter affect encoding CPU and file size, never image quality.
      '--screenshot-format=png','--screenshot-png-compression=1','--screenshot-png-filter=1','--screenshot-high-bit-depth=no',`--input-ipc-server=${pipe}`,`--start=${start}`,...extra],
      {windowsHide:true,stdio:['ignore','ignore','pipe']});
    this.child.stderr?.resume(); // Never retain raw source paths in logs.
    this.exited=new Promise(resolve=>{
      this.child!.on('error',()=>{
        // A failed kill can also emit error. It is NOT evidence of process exit.
        if(!this.child?.pid){this.closed=true;this.fail('MPV 启动失败，请检查运行库');resolve();}
      });
      this.child!.once('exit',(code,signal)=>{this.preservePlayback();this.closed=true;this.clearRequests();this.socket?.destroy();clearTimeout(this.seekTimer);if(!this.stopping&&(code!==0||signal))this.fail('原生播放进程异常退出');else if(this.snapshot.phase!=='error')this.snapshot.phase='closed';this.emit();this.onExit();resolve();});
    });
    this.startupStage='ipc';const deadline=Date.now()+10000;
    while(!this.closed&&Date.now()<deadline){
      try{this.socket=await new Promise<Socket>((resolve,reject)=>{const socket=connect(pipe);socket.once('error',reject);socket.once('connect',()=>{socket.removeListener('error',reject);resolve(socket);});});break;}
      catch {await delay(50);}
    }
    if(!this.socket){const failure=new Error(this.snapshot.error||'连接 MPV 超时，未切换或转码原视频');try{await this.stop();}catch(cleanup){throw startupFailure(failure,cleanup);}throw failure;}
    this.socket.setEncoding('utf8');
    this.socket.on('data',(data:string)=>this.receive(data));
    this.socket.on('error',()=>{if(!this.nativeShutdown&&!this.expectedNativeExit&&!this.stopping)this.fail('原生播放连接中断');});
    this.socket.on('close',()=>{
      this.clearRequests();
      if(!this.closed&&!this.stopping)void (async()=>{
        // Windows can close the pipe just before reporting normal process exit;
        // some MPV shutdown paths do not deliver a final shutdown IPC event.
        // Hold the read fence and wait for OS evidence, never assume exit.
        await Promise.race([this.exited,delay(150)]);
        if(this.closed||this.stopping)return;
        if(!this.nativeShutdown&&!this.expectedNativeExit)this.fail('原生播放连接已关闭');
        await this.stop().catch(()=>this.fail('原生进程未确认退出，请重试关闭窗口'));
      })();
    });
    this.startupStage='observe';await Promise.all(mpvProperties.map((name,index)=>this.command(['observe_property',index+1,name])));
    this.readyTimer=setTimeout(()=>{if(this.snapshot.phase==='starting'){this.startupExpired=true;this.fail('原生播放超过 30 秒音视频仍未就绪，可重试或切回现有播放器；不会自动静音或转码');}},30000);
    // Observe BEFORE loading, so startup is measured at playback-restart,
    // never at metadata/command receipt or the mere presence of a video size.
    this.startupStage='load';await this.command(['loadfile',source,'replace']);
    if(beforePlay){
      this.startupStage='tracks';const deadline=Date.now()+30000;
      while(!this.fileLoaded&&!this.closed&&this.snapshot.phase!=='error'&&Date.now()<deadline)await delay(25);
      if(!this.fileLoaded||this.closed)throw new Error(this.snapshot.error||'原生轨道尚未就绪，未套用播放记忆');
      await beforePlay();
    }
    this.startupStage='unpause';await this.command(['set_property','pause',false]);
    this.startupStage='started';
    if(this.fileLoaded&&this.latestSeek!==null&&!this.seekActive)this.sendSeek();
    this.emit();
  }
  command(command:unknown[],timeoutMs=5000):Promise<unknown>{
    if(!this.socket||this.socket.destroyed||this.closed)return Promise.reject(new Error('播放器已关闭'));
    if(this.requests.size>=64)return Promise.reject(new Error('播放操作过多，请稍后重试'));
    const request_id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.requests.delete(request_id);reject(new Error('原生播放指令超时'));},timeoutMs);
      this.requests.set(request_id,{resolve,reject,timer});
      this.socket!.write(JSON.stringify({command,request_id})+'\n',error=>{if(error){clearTimeout(timer);this.requests.delete(request_id);reject(new Error('原生播放指令未发送'));}});
    });
  }
  private receive(data:string){
    this.buffer+=data;if(this.buffer.length>1024*1024){this.fail('原生播放响应超过限制');void this.stop().catch(()=>this.fail('原生进程未确认退出，请重试关闭窗口'));return;}
    let end:number;while((end=this.buffer.indexOf('\n'))>=0){
      const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);
      try{this.message(JSON.parse(line));}catch{/* Malformed event cannot escape into Electron. */}
    }
  }
  private message(value:{request_id?:number;error?:string;file_error?:string;data?:unknown;event?:string;name?:string;reason?:string;args?:unknown[]}){
    if(this.closed)return;
    // A confirmed MPV shutdown event precedes normal native-window/Q exit.
    // Keep OS-exit verification, but don't turn that expected IPC closure into
    // a playback failure. Unannounced transport loss remains an error.
    if(value.event==='shutdown')this.nativeShutdown=true;
    if(value.event==='end-file'||value.event==='shutdown')this.preservePlayback();
    if(value.event==='end-file'){this.fileLoaded=false;this.fileRestarted=false;}
    if(value.request_id!==undefined){const request=this.requests.get(value.request_id);if(request){clearTimeout(request.timer);this.requests.delete(value.request_id);if(value.error==='success')request.resolve(value.data);else request.reject(new Error(`原生播放操作失败：${value.error||'未知错误'}`));}return;}
    if(value.event==='start-file'){this.snapshot.sourceLoads++;this.finalProperties=null;this.lastPosition=null;this.fileLoaded=false;this.fileRestarted=false;}
    if(value.event==='client-message'&&Array.isArray(value.args)){
      // The owned Lua controller announces an intent, then immediately seeks
      // inside MPV. Observation never round-trips native input through React.
      const [owner,kind,target]=value.args;
      if(this.nativeWindow&&owner==='avhub'&&kind==='seek-intent'&&value.args.length===3&&typeof target==='string'&&target.trim()!==''&&Number.isFinite(Number(target))&&Number(target)>=0)this.observeNativeSeek(Number(target));
      else if(this.nativeWindow&&owner==='avhub'&&kind==='closing'&&value.args.length===2)this.expectedNativeExit=true;
      else this.onMessage?.(value.args);
    }
    if(this.nativeWindow&&value.event==='seek'&&!this.seekActive&&this.snapshot.phase!=='starting')this.observeNativeSeek(null);
    if(value.event==='file-loaded'){
      this.fileLoaded=true;
      if(this.startupStage==='started'&&this.latestSeek!==null&&!this.seekActive)this.sendSeek();
    }
    if(value.event==='property-change'&&value.name){
      if(value.name==='audio-device-list'){
        // Only observed AFTER an audio failure, never a startup preflight or a
        // poll. Hot-plug changes update advice, not playback/selected devices.
        // Raw device IDs and descriptions never enter public state or logs.
        this.snapshot.audioOutput=audioOutputStatus(value.data);
        if(this.snapshot.phase==='error'&&this.snapshot.failureCode==='audio-output')this.snapshot.error=audioOutputFailure(this.snapshot.audioOutput);
        this.emit();return;
      }
      if(value.name==='paused-for-cache'){
        if(value.data===true&&this.bufferingStarted===null){this.bufferingStarted=performance.now();this.snapshot.bufferingEvents++;}
        else if(value.data!==true&&this.bufferingStarted!==null){this.snapshot.bufferingMs+=performance.now()-this.bufferingStarted;this.bufferingStarted=null;}
      }
      this.snapshot.properties[value.name]=value.data;
      if(value.name==='time-pos'&&typeof value.data==='number'&&Number.isFinite(value.data))this.lastPosition=value.data;
      if(value.name==='pause'&&value.data===false)this.seekWasPaused=false;
      if(value.name==='time-pos'&&!this.seekActive&&this.snapshot.properties.pause===false&&typeof value.data==='number'&&value.data>this.settledPosition+.02)this.manualEnd=false;
      if(['time-pos','video-params','current-ao','track-list','aid'].includes(value.name))this.ready();
      this.emit();
    }
    if(value.event==='playback-restart'){
      this.snapshot.restarts++;if(this.fileLoaded)this.fileRestarted=true;this.ready();
      if(this.seekDispatching)this.restartWhileDispatching=true;
      else if(this.seekActive)void this.completeSeek();
      else if(this.latestSeek!==null)this.sendSeek();
      this.emit();
    }
    if(value.event==='end-file'&&value.reason==='error'){
      // file_error is MPV's structured error string, not a parsed log line.
      // Only fixed categories leave the decoder; never export arbitrary paths.
      const error=value.file_error??value.error;
      if(error==='audio output initialization failed'){
        this.fail(audioOutputFailure(this.snapshot.audioOutput??{state:'unknown',availableCount:null}),'audio-output');
        if(!this.audioDevicesObserved&&!this.stopping){
          this.audioDevicesObserved=true;
          void this.command(['observe_property',mpvProperties.length+1,'audio-device-list']).catch(()=>{});
        }
      }
      else if(error==='video output initialization failed')this.fail('视频输出初始化失败，请重试原生播放或切换现有播放器；未降低画质','video-output');
      else if(error==='loading failed'||error==='unrecognized file format')this.fail('原文件读取失败或格式无法识别，请确认文件仍可访问后重试；未自动转码','source');
      else this.fail('MPV 无法读取或解码此视频，未自动转码',error==='audio decoding failed'||error==='video decoding failed'?'decode':'unknown');
    }
    if(value.event==='property-change'&&value.name==='eof-reached'){
      if(!this.fileLoaded&&this.snapshot.phase==='error'&&this.snapshot.failureCode)return;
      if(value.data===true&&!this.seekActive&&this.latestSeek===null){
        this.endReason=this.manualEnd||this.seekWasPaused?'seek':'natural';
        this.snapshot.phase='ended';this.emit();
      }else if(value.data===false){this.endReason=null;this.manualEnd=false;if(this.snapshot.phase==='ended')this.snapshot.phase='ready';}
    }
  }
  private ready(){
    const video=this.snapshot.properties['video-params'] as {w?:number;h?:number}|undefined,clock=this.snapshot.properties['time-pos'];
    // A restart can also precede failed A/V initialization. It is not enough
    // on its own, nor are metadata, command ACK or an idle-window event.
    if(!this.closed&&this.fileLoaded&&this.fileRestarted&&Number.isFinite(video?.w)&&Number(video?.w)>0&&Number.isFinite(video?.h)&&Number(video?.h)>0&&typeof clock==='number'&&Number.isFinite(clock)&&(this.snapshot.phase==='starting'||this.startupExpired)){
      this.snapshot.firstFrameMs??=performance.now()-this.started;
      // Video can decode before an audio-output initialization failure. Keep
      // that real frame metric, but don't declare A/V ready without the chosen
      // output. Track metadata must belong to a selected video, not idle [].
      const list=this.snapshot.properties['track-list'];
      if(!Array.isArray(list))return;
      const tracks=list.filter((track):track is {type?:string;selected?:boolean;id?:unknown}=>Boolean(track)&&typeof track==='object');
      if(!tracks.some(track=>track.type==='video'&&track.selected===true))return;
      const aid=this.snapshot.properties.aid,ao=this.snapshot.properties['current-ao'];
      const needsAudio=tracks.some(track=>track.type==='audio'&&(track.selected===true||typeof aid==='number'&&track.id===aid||aid==='auto'));
      if(needsAudio&&(typeof ao!=='string'||!ao.trim()||ao==='null'))return;
      clearTimeout(this.readyTimer);this.startupExpired=false;this.snapshot.phase='ready';this.snapshot.error=undefined;this.snapshot.failureCode=null;this.snapshot.readyMs=performance.now()-this.started;
    }
  }
  private observeNativeSeek(target:number|null){
    if(this.closed||this.stopping||this.nativeShutdown||this.expectedNativeExit)return;
    if(!this.fileLoaded&&this.snapshot.phase==='error'&&this.snapshot.failureCode)return;
    this.finalProperties=null;
    const duration=this.snapshot.properties.duration;
    if(target!==null&&typeof duration==='number')target=Math.min(target,Math.max(0,duration-.01));
    this.seekRevision++;this.seekActive=true;this.latestSeek=null;this.manualEnd=false;this.endReason=null;
    this.seekWasPaused=this.snapshot.properties.pause===true;
    this.nativeTargetKnown=target!==null;this.seekTarget=target??0;this.seekStarted=this.seekRequestedAt=performance.now();
    this.snapshot.seeks++;this.snapshot.seekMode='native';this.snapshot.pendingSeek=target;this.snapshot.error=undefined;
    if(this.snapshot.phase==='ended')this.snapshot.phase='ready';
    const revision=this.seekRevision;
    clearTimeout(this.seekTimer);this.seekTimer=setTimeout(()=>{
      if(revision!==this.seekRevision)return;
      this.seekActive=false;this.snapshot.pendingSeek=null;this.snapshot.seekMode=null;
      this.snapshot.error='跳播目标尚未确认，请重试';this.emit();
    },15000);
    this.emit();
  }
  seek(target:number){
    if(this.closed)throw new Error('播放器已关闭');
    if(!Number.isFinite(target)||target<0)throw new Error('跳播位置无效');
    if(!this.fileLoaded&&this.snapshot.phase==='error'&&this.snapshot.failureCode)throw new Error('原生播放已失败，请重新打开视频');
    this.finalProperties=null;
    const duration=this.snapshot.properties.duration;
    target=typeof duration==='number'?Math.min(target,Math.max(0,duration-.01)):target;
    // Keep startup honest, but retain the last user intent instead of rejecting
    // clicks made before the initial frame/track load has finished.
    const starting=this.snapshot.phase==='starting';
    this.endReason=null;
    this.manualEnd=false;
    if(!starting){this.snapshot.phase='ready';this.snapshot.error=undefined;}
    this.latestSeek=target;this.latestSeekRequestedAt=performance.now();this.snapshot.pendingSeek=target;this.emit();
    // MPV already coalesces successive seeks. Wait only for the preceding
    // command ACK, not for an obsolete target to finish decoding. No fixed
    // debounce and no keyframe/quality downgrade is involved.
    if(!this.seekDispatching&&!this.correcting&&(!starting||this.fileLoaded&&this.startupStage==='started'))this.sendSeek();
  }
  seekBy(delta:number){
    if(!Number.isFinite(delta)||Math.abs(delta)>120)throw new Error('跳播步长无效');
    const base=this.latestSeek??this.snapshot.pendingSeek??Number(this.snapshot.properties['time-pos']||0);
    this.seek(Math.max(0,base+delta));
  }
  private sendSeek(){
    if(this.latestSeek===null||this.closed||this.stopping||this.seekDispatching||this.correcting)return;
    // A queued startup intent may precede duration discovery.
    const duration=this.snapshot.properties.duration;
    const target=typeof duration==='number'?Math.min(this.latestSeek,Math.max(0,duration-.01)):this.latestSeek;
    this.snapshot.pendingSeek=target;
    this.seekTarget=target;this.seekRequestedAt=this.latestSeekRequestedAt;this.seekRevision++;this.correctionCount=0;this.latestSeek=null;this.seekActive=true;this.seekStarted=performance.now();this.snapshot.seeks++;this.snapshot.seekMode='coordinated';
    this.seekWasPaused=this.snapshot.properties.pause===true;
    const revision=this.seekRevision;
    this.seekDispatching=true;this.restartWhileDispatching=false;
    const failed=(message:string)=>{
      if(revision!==this.seekRevision)return;
      clearTimeout(this.seekTimer);this.seekActive=false;
      // Failure belongs to this attempt, not to a newer user selection.
      if(this.latestSeek!==null&&!this.closed&&!this.stopping){this.snapshot.error=undefined;this.sendSeek();return;}
      this.snapshot.pendingSeek=null;this.snapshot.seekMode=null;this.snapshot.error=message;
      if(this.demuxerOffset)void this.command(['set_property','options/hr-seek-demuxer-offset',0]).then(()=>{this.demuxerOffset=0;}).catch(()=>{});
      this.emit();
    };
    clearTimeout(this.seekTimer);this.seekTimer=setTimeout(()=>failed('跳播超时，请重试或返回兼容引擎'),15000);
    void (async()=>{
      // A newer request can supersede a correction. Reset the temporary
      // offset BEFORE that ordinary seek, not just on successful correction.
      if(this.demuxerOffset){await this.command(['set_property','options/hr-seek-demuxer-offset',0]);this.demuxerOffset=0;}
      // time-pos uses MPV's absolute seek queue without the input-command
      // repeat delay. --hr-seek=yes keeps frame-accurate decoding mandatory.
      if(revision===this.seekRevision&&this.seekActive)await this.command(['set_property','time-pos',target]);
    })().catch(error=>failed(String(error.message))).finally(()=>{
      this.seekDispatching=false;
      if(this.closed||this.stopping)return;
      if(this.latestSeek!==null){this.restartWhileDispatching=false;this.sendSeek();}
      else if(this.restartWhileDispatching){this.restartWhileDispatching=false;if(this.seekActive)void this.completeSeek();}
    });
  }
  private async completeSeek(){
    // Playback-restart means a frame was restarted, not merely command receipt.
    // Read the actual time; do not trust a potentially queued property event.
    if(this.closed||!this.seekActive)return;
    if(this.seekDispatching){this.restartWhileDispatching=true;return;}
    if(this.correcting){this.restartWhileChecking=true;return;}
    this.correcting=true;
    const target=this.seekTarget,revision=this.seekRevision,native=this.snapshot.seekMode==='native',known=!native||this.nativeTargetKnown;
    const observedAt=performance.now(),observedPosition=Number(this.snapshot.properties['time-pos']);
    try{const position=await this.command(['get_property','time-pos']);if(this.closed||!this.seekActive||revision!==this.seekRevision)return;
      if(typeof position!=='number')return;
      // Account for a slow query only after a near-target clock was witnessed.
      // Elapsed time alone is never evidence of an accurate seek.
      const allowance=this.snapshot.properties.pause===false&&Math.abs(observedPosition-target)<=.5?
        (performance.now()-observedAt)/1000*Number(this.snapshot.properties.speed||1):0;
      if(known&&(position<target-.5||position>target+.5+allowance)){
        if(this.latestSeek!==null){clearTimeout(this.seekTimer);this.seekActive=false;this.sendSeek();return;}
        // Some TS demuxers land AFTER the requested frame even for an exact
        // seek. Retry only observed overshoot, with bounded earlier demuxing;
        // do not slow every MKV/MP4 seek with a blanket preroll parameter.
        // Do not inject decoder options into an MPV-owned native input queue.
        // Native seeks are verified, not silently retimed by a second owner.
        if(!native&&position>target+.5&&this.correctionCount<2){
          this.correctionCount++;this.snapshot.seekCorrections++;
          const offset=Math.min(8,(position-target+2)*this.correctionCount);
          await this.command(['set_property','options/hr-seek-demuxer-offset',offset]);this.demuxerOffset=offset;
          if(!this.seekActive||revision!==this.seekRevision)return;
          await this.command(['set_property','time-pos',target]);
        }
        return;
      }
      this.snapshot.properties['time-pos']=position;
      this.lastPosition=position;
      this.ready();
      this.snapshot.lastSeekMs=performance.now()-this.seekStarted;
      this.snapshot.lastSeekTotalMs=performance.now()-this.seekRequestedAt;
      this.snapshot.lastSeekTarget=known?target:null;this.snapshot.lastSeekPosition=position;
      if(this.demuxerOffset){await this.command(['set_property','options/hr-seek-demuxer-offset',0]);this.demuxerOffset=0;}
      if(!this.seekActive||revision!==this.seekRevision)return;
      clearTimeout(this.seekTimer);this.seekActive=false;
      this.settledPosition=position;
      const duration=Number(this.snapshot.properties.duration);
      this.manualEnd=Number.isFinite(duration)&&(known?target>=duration-.05:this.snapshot.properties.pause===true);
      if(this.latestSeek!==null)this.sendSeek();else{
        this.snapshot.pendingSeek=null;this.snapshot.seekMode=null;
        if(this.snapshot.properties['eof-reached']===true){this.snapshot.phase='ended';this.endReason=this.manualEnd||this.seekWasPaused?'seek':'natural';}
      }
      this.emit();
    }catch{/* Keep bounded timeout; a transport ACK is not a decoded frame. */}
    finally{
      this.correcting=false;
      // A decoded restart can arrive while the previous time query/correction
      // is still awaited. Retain it instead of leaving the next target pending.
      if(this.latestSeek!==null&&!this.closed&&!this.stopping){this.restartWhileChecking=false;this.sendSeek();}
      else if(this.restartWhileChecking){this.restartWhileChecking=false;if(!this.closed&&this.seekActive)void this.completeSeek();}
    }
  }
  private fail(message:string,code:NativeFailureCode|null=null){clearTimeout(this.readyTimer);if(code)this.startupExpired=false;this.snapshot.phase='error';this.snapshot.error=message;this.snapshot.failureCode=code;this.emit();}
  private clearRequests(){for(const request of this.requests.values()){clearTimeout(request.timer);request.reject(new Error('播放器已断开'));}this.requests.clear();}
  stop():Promise<void>{
    if(this.stopping)return this.stopping;
    this.stopping=(async()=>{
      clearTimeout(this.seekTimer);clearTimeout(this.readyTimer);this.latestSeek=null;this.seekActive=false;this.snapshot.pendingSeek=null;this.snapshot.seekMode=null;
      const exited=()=>this.closed||Boolean(this.child&&(this.child.exitCode!==null||this.child.signalCode!==null));
      if(this.child&&!exited()){void this.command(['quit']).catch(()=>{});await Promise.race([this.exited,delay(2000)]);if(!exited()){this.child.kill();await Promise.race([this.exited,delay(4000)]);}if(!exited())throw new Error('原生播放器仍未退出，保留文件占用保护');}
      this.closed=true;this.socket?.destroy();this.clearRequests();
    })().finally(()=>{this.stopping=null;});return this.stopping;
  }
}
