import {app,BaseWindow,BrowserWindow,screen,dialog,type IpcMainInvokeEvent} from 'electron';
import {existsSync} from 'node:fs';
import {stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {MpvClient,type MpvSnapshot} from './mpvClient';
import {fitPlaybackBounds,playbackMinimum} from './playbackGeometry';
import {defaultSubtitleAppearance,subtitleStyle,subtitleOptions,type SubtitleAppearance} from './nativeSubtitle';
import {nativeViewport,type NativeViewport} from './nativeEmbedding';
import {nativeTrackChoice,rememberedTrack,type MediaPlaybackState} from './nativeTrackMemory';
import {processMemorySnapshot} from './processDiagnostics';
import {startupFailure} from './nativeFailure';
import {ownedRendererExited} from './processLiveness';
import {IndependentPlayer} from './independentPlayer';
import {captureNativeFrame} from './nativeCapture';

type Dependencies={origin:()=>string;token:()=>string;runtime:()=>string;data:()=>string;main:()=>BrowserWindow|null;icon:()=>Electron.NativeImage;log:(text:string)=>void;mode:(value:{purePlayback?:boolean;alwaysOnTop?:boolean;videoAspectRatio?:number})=>unknown;windowAction:(value:string)=>unknown;settled:()=>Promise<void>;windowState:()=>{purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean}};
type Active={client:MpvClient;host:BaseWindow;overlay:BrowserWindow;mediaId:number;title:string;owner:string;closing:boolean;saveError:string;heartbeat:ReturnType<typeof setInterval>;persist:Promise<unknown>;pure:boolean;normal:Electron.Rectangle|null;normalMaximized:boolean;expanded:Electron.Rectangle|null;screenshotBusy:boolean;audioRevision:number;speedRevision:number;savedAudio:number;savedSpeed:number;publishTimer?:ReturnType<typeof setTimeout>;disposeWindows?:()=>void;subtitleAppearance:SubtitleAppearance;styleRevision:number;savedStyle:number;subtitlePicking:boolean;geometryGuardUntil:number;operations:Set<Promise<unknown>>};
const finite=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;

/** mpv owns decoding only. AVHub owns windows, controls, source IDs, progress,
 * screenshots and read reservations. No arbitrary command/path crosses IPC.
 */
export class NativePlayer {
  private active:Active|null=null;
  private startupTimings=new WeakMap<Active,Record<string,number>>();
  private rendererPids=new WeakMap<Active,number>();
  private controlsUnavailable(active:Active){
    if(this.active!==active||active.closing)return;
    this.deps.log('native-controls-process-gone');
    try{this.deps.main()?.webContents.send('avhub:native-event',{session:active.client.session,kind:'error',detail:'原生控制窗口异常退出，请重新打开视频'});}catch{this.deps.log('native-controls-error-notification-unavailable');}
    void this.close().catch(()=>this.deps.log('native-renderer-cleanup-failed'));
  }
  private heartbeat(active:Active){
    if(this.active!==active||active.closing)return;
    // Electron may delay the gone event for an already exited renderer.
    // Confirm OS exit only; an unresponsive/live renderer is not auto-killed.
    if(!active.overlay.isDestroyed()&&!active.overlay.webContents.isDestroyed()){
      const pid=active.overlay.webContents.getOSProcessId();if(pid>0)this.rendererPids.set(active,pid);
    }
    const gone=active.overlay.isDestroyed()||active.overlay.webContents.isDestroyed()||active.overlay.webContents.isCrashed()||ownedRendererExited(this.rendererPids.get(active)||0);
    if(gone){this.controlsUnavailable(active);return;}
    void this.save(active).catch(()=>{});
  }
  private embedded=new WeakMap<Active,NativeViewport>();
  private trackMemory=new WeakMap<Active,{state:MediaPlaybackState;changes:Partial<Pick<MediaPlaybackState,'audio'|'subtitle'|'delay'>>;revision:number;saved:number;invalidated?:boolean}>();
  private windowDrags=new WeakMap<Active,{x:number;y:number;left:number;top:number}>();
  private embeddingTasks=new WeakMap<Active,Promise<void>>();
  private layoutHistory=new WeakMap<Active,Record<string,unknown>[]>();
  private embed(active:Active):Promise<void>{
    const pending=this.embeddingTasks.get(active);if(pending)return pending;
    const task=(async()=>{
      let applied:string|undefined;
      while(!active.closing){
        const rect=this.embedded.get(active),main=this.deps.main();
        if(!rect||!main||main.isDestroyed()||active.host.isDestroyed()||active.overlay.isDestroyed())return;
        // Update Electron's cached normal bounds too. A raw SetWindowPos before
        // first show is otherwise undone by BrowserWindow.showInactive().
        const content=main.getContentBounds();
        // A move/DPI/mode transition can happen while the native bridge is in
        // flight without changing the DOM rectangle. Do not lose that latest
        // placement just because it shares the same viewport object.
        const visible=main.isVisible()&&!main.isMinimized();
        const signature=JSON.stringify([rect,content,visible,screen.getDisplayMatching(main.getBounds()).scaleFactor]);
        if(signature===applied)return;
        active.overlay.setBounds({x:Math.round(content.x+rect.x),y:Math.round(content.y+rect.y),width:Math.round(rect.width),height:Math.round(rect.height)});
        const hwnd=(window:BaseWindow)=>{const handle=window.getNativeWindowHandle();return Number(handle.length===8?handle.readBigUInt64LE():handle.readUInt32LE());};
        const effective={...rect,visible:rect.visible&&visible};
        await this.api(`/api/native-read/${active.owner}/embed`,'POST',{parent:hwnd(main),host:hwnd(active.host),overlay:hwnd(active.overlay),pid:process.pid,rect:effective});
        if(main.isDestroyed()||active.closing)return;
        const display=screen.getDisplayMatching(main.getBounds()),history=this.layoutHistory.get(active)??[];
        history.push({at:Date.now(),content,viewport:effective,display:{bounds:display.bounds,workArea:display.workArea,scale:display.scaleFactor},host:active.host.isDestroyed()?null:active.host.getContentBounds(),controls:active.overlay.isDestroyed()?null:active.overlay.getBounds()});
        if(history.length>16)history.splice(0,history.length-16);this.layoutHistory.set(active,history);
        // A layout request can finish after Windows minimizes the owner. Never
        // let that late ShowWindow resurrect the transparent owned controls.
        if(!main.isDestroyed()&&(!main.isVisible()||main.isMinimized())&&!active.overlay.isDestroyed())active.overlay.hide();
        else if(effective.visible&&(main.isFocused()||active.overlay.isFocused())){active.overlay.showInactive();active.overlay.moveTop();}
        applied=signature;
      }
    })();
    this.embeddingTasks.set(active,task);void task.finally(()=>this.embeddingTasks.delete(active)).catch(()=>{});return task;
  }
  private surfaceTasks=new WeakMap<Active,Promise<void>>();
  private raiseSurface(active:Active):Promise<void>{
    const pending=this.surfaceTasks.get(active);if(pending)return pending;
    const task=(async()=>{
      const pid=active.client.processId;if(!pid)return;
      let failure:unknown,attempt=0;
      const deadline=performance.now()+1000;
      do{
        if(active.closing||active.host.isDestroyed())return;
        const handle=active.host.getNativeWindowHandle();
        const hwnd=Number(handle.length===8?handle.readBigUInt64LE():handle.readUInt32LE());
        attempt++;
        try{
          await this.api(`/api/native-read/${active.owner}/surface`,'POST',{host:hwnd,host_pid:process.pid,decoder_pid:pid},Math.max(1,Math.ceil(deadline-performance.now())));
          const timings=this.startupTimings.get(active);if(timings&&timings.totalMs===undefined)timings.surfaceAttempts=attempt;
          return;
        }catch(error){
          failure=error;
          if(error instanceof Error&&'status' in error&&error.status!==409)throw error;
          const remaining=deadline-performance.now();if(remaining<=0)break;
          await new Promise(resolve=>setTimeout(resolve,Math.min(remaining,10+Math.min(attempt,6)*5)));
        }
      }while(performance.now()<deadline);
      if(!active.closing)throw failure;
    })();
    this.surfaceTasks.set(active,task);
    void task.finally(()=>this.surfaceTasks.delete(active)).catch(()=>{});
    return task;
  }
  private opening=false;
  private failedStartup:Active|null=null;
  private failedStartupError:Error|null=null;
  private pendingOpen:Promise<unknown>|null=null;
  private shuttingDown=false;
  private independent:IndependentPlayer;
  constructor(private deps:Dependencies){
    this.independent=new IndependentPlayer({...deps,api:(route,method,body)=>this.api(route,method,body),send:(channel,value)=>{try{const main=deps.main();if(main&&!main.isDestroyed())main.webContents.send(channel,value);}catch{deps.log('native-independent-notification-unavailable');}}});
  }
  status(){return {available:process.platform==='win32'&&existsSync(this.deps.runtime()),active:Boolean(this.active)||this.independent.hasSession,engine:'mpv',experimental:true};}
  private async api(route:string,method='GET',body?:unknown,timeoutMs=10000){
    const response=await fetch(this.deps.origin()+route,{method,headers:{'X-AVHub-Token':this.deps.token(),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
    const result=await response.json() as Record<string,any>;
    if(!response.ok)throw Object.assign(new Error(typeof result.detail==='string'?result.detail:'本地原生播放服务未完成'),{status:response.status});return result;
  }
  private trusted(event:IpcMainInvokeEvent,overlayOnly=false){
    const sender=BrowserWindow.fromWebContents(event.sender);
    if(!sender||event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).origin!==this.deps.origin()||
       (sender!==this.active?.overlay&&(overlayOnly||sender!==this.deps.main())))throw new Error('原生播放操作来源无效');
  }
  invoke(event:IpcMainInvokeEvent,action:unknown,input:unknown){
    const active=this.active,task=this.handleInvoke(event,action,input);
    if(active&&typeof action==='string'&&['volume','mute','speed','subtitle-style','track','sub-delay','rotate','transform'].includes(action)){
      active.operations.add(task);void task.then(()=>active.operations.delete(task),()=>active.operations.delete(task));
    }
    return task;
  }
  private async handleInvoke(event:IpcMainInvokeEvent,action:unknown,input:unknown){
    this.trusted(event);
    if(action==='status')return this.status();
    if(this.independent.hasSession&&action!=='open'){
      if(BrowserWindow.fromWebContents(event.sender)!==this.deps.main())throw new Error('独立播放器仅接受媒体库操作');
      if(action==='recover'&&this.pendingOpen)throw new Error('原生播放正在启动，请稍后重试');
      return this.independent.invoke(action,input);
    }
    if(action==='recover'){
      if(BrowserWindow.fromWebContents(event.sender)!==this.deps.main())throw new Error('仅媒体库窗口可以重试启动清理');
      if(this.pendingOpen||this.opening)throw new Error('原生播放正在启动，请稍后重试');
      if(this.active&&this.active!==this.failedStartup)throw new Error('当前原生会话仍在使用，请正常关闭播放器');
      try{await this.close(true);}catch(cleanup){throw startupFailure(this.failedStartupError??new Error('原生会话清理未完成'),cleanup);}return {ok:true};
    }
    if(action==='open'){
      if(BrowserWindow.fromWebContents(event.sender)!==this.deps.main())throw new Error('仅媒体库窗口可以启动视频');
      const value=input as {mediaId?:unknown;start?:unknown;viewport?:unknown};
      if(!value||!Number.isSafeInteger(value.mediaId)||Number(value.mediaId)<=0||!finite(value.start,0,1e8))throw new Error('原生播放参数无效');
      if(this.pendingOpen||this.shuttingDown)throw new Error('原生播放器正在启动或关闭');
      if(this.active&&this.active!==this.failedStartup)throw new Error('请先关闭当前原生播放器');
      const rect=value.viewport===undefined?undefined:nativeViewport(value.viewport);
      const pending=(async()=>{
        // Retrying a failed startup must retry its retained cleanup first,
        // even if the user has since changed the preferred window mode.
        if(this.active&&this.active===this.failedStartup){try{await this.close(true);}catch(cleanup){throw startupFailure(this.failedStartupError??new Error('原生会话清理未完成'),cleanup);}}
        await this.independent.prepareOpen();
        const prefs=await this.api('/api/preferences');
        if(this.shuttingDown)throw new Error('原生播放启动已取消');
        return prefs.values?.mpvWindowMode==='independent'?this.independent.open(Number(value.mediaId),Number(value.start)):this.open(Number(value.mediaId),Number(value.start),rect);
      })();this.pendingOpen=pending;
      try{return await pending;}finally{if(this.pendingOpen===pending)this.pendingOpen=null;}
    }
    const active=this.active;if(!active)throw new Error('原生播放窗口已关闭');
    if(action==='snapshot')return this.view(active);
    if(action==='mouse-seek'){
      const request=input as {session?:unknown;direction?:unknown};
      if(BrowserWindow.fromWebContents(event.sender)!==this.deps.main()||!this.embedded.has(active)||active.closing||!request||request.session!==active.client.session||!['back','forward'].includes(String(request.direction)))throw new Error('原生鼠标快捷键无效');
      active.overlay.webContents.send('avhub:mouse-seek',request.direction);return {ok:true};
    }
    if(action==='shortcut'){
      const request=input as {session?:unknown;code?:unknown;shiftKey?:unknown;repeat?:unknown};
      if(BrowserWindow.fromWebContents(event.sender)!==this.deps.main()||!this.embedded.has(active)||active.closing||!request||request.session!==active.client.session||typeof request.code!=='string'||!['Space','KeyK','KeyJ','KeyL','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyM','KeyR','KeyC','KeyF','KeyW','KeyN','KeyP','Escape'].includes(request.code)||typeof request.shiftKey!=='boolean'||typeof request.repeat!=='boolean')throw new Error('原生播放快捷键无效');
      active.overlay.webContents.send('avhub:native-shortcut',{code:request.code,shiftKey:request.shiftKey,repeat:request.repeat});return {ok:true};
    }
    if(action==='layout'){
      if(BrowserWindow.fromWebContents(event.sender)!==this.deps.main()||!input||typeof input!=='object'||(input as any).session!==active.client.session||!this.embedded.has(active)||active.closing)throw new Error('原生播放区域会话无效');
      this.embedded.set(active,nativeViewport((input as any).viewport));await this.embed(active);return {ok:true};
    }
    if(action==='show'){
      if(input!==active.client.session||active.closing)throw new Error('原生播放会话已过期');
      if(this.embedded.has(active)){const main=this.deps.main()!;if(main.isMinimized())main.restore();main.show();main.focus();return {ok:true};}
      active.geometryGuardUntil=Date.now()+300;if(active.host.isMinimized())active.host.restore();
      active.host.show();active.overlay.show();active.overlay.focus();return {ok:true};
    }
    // Main window may only close its exact session, never a newer launch.
    if(action==='close'){
      if(input!==active.client.session)throw new Error('原生播放会话已过期');
      await this.close();return {ok:true};
    }
    if(active.closing)throw new Error('原生播放正在关闭，请稍候');
    if(action==='replay'){
      if(input!==active.client.session)throw new Error('原生播放会话已过期');
      if(this.capturingFrames.has(active))throw new Error('正在截取画面，请稍后重播');
      active.client.seek(0);await active.client.command(['set_property','pause',false]);return {ok:true};
    }
    if(action==='flush'){
      if(input!==active.client.session)throw new Error('原生播放会话已过期');
      await this.save(active,true);return {ok:true};
    }
    this.trusted(event,true);
    if(!input||typeof input!=='object'||(input as {session?:unknown}).session!==active.client.session)throw new Error('原生播放会话已过期');
    const {value}=input as {value?:unknown};
    if(this.capturingFrames.has(active)&&['seek','seek-relative','pause','track','rotate','transform','sub-delay','subtitle-style','subtitle-import','speed'].includes(String(action)))throw new Error('正在截取画面，请稍后调整播放画面');
    if(action==='diagnostics'){
      const main=this.deps.main(),p=active.client.snapshot.properties,video=p['video-params'] as any;
      return {engine:'mpv',session:active.client.session,phase:active.client.snapshot.phase,failureCode:active.client.snapshot.failureCode??null,audioOutput:active.client.snapshot.audioOutput,firstFrameMs:active.client.snapshot.firstFrameMs,readyMs:active.client.snapshot.readyMs,sourceLoads:active.client.snapshot.sourceLoads,
        processMemory:processMemorySnapshot(app.getAppMetrics(),{main:process.pid,libraryRenderer:main&&!main.isDestroyed()?main.webContents.getOSProcessId():undefined,controlsRenderer:!active.overlay.isDestroyed()?active.overlay.webContents.getOSProcessId():undefined}),
        video:video?{width:video.dw,height:video.dh,rotation:video.rotate,pixelFormat:video.pixelformat}:null,
        transform:{zoom:p['video-zoom'],x:p['video-pan-x'],y:p['video-pan-y']},
        viewport:this.embedded.get(active)??null,layoutPending:this.embeddingTasks.has(active),
        displays:screen.getAllDisplays().map(display=>({bounds:display.bounds,workArea:display.workArea,scale:display.scaleFactor,rotation:display.rotation})),
        recentLayouts:this.layoutHistory.get(active)??[],
        window:main&&!main.isDestroyed()?{content:main.getContentBounds(),scale:screen.getDisplayMatching(main.getBounds()).scaleFactor,...this.deps.windowState()}:null,
        host:active.host.isDestroyed()?null:active.host.getContentBounds(),controls:active.overlay.isDestroyed()?null:active.overlay.getBounds(),
        dropped:p['frame-drop-count']??null,decoderDropped:p['decoder-frame-drop-count']??null,bufferingEvents:active.client.snapshot.bufferingEvents};
    }
    if(action==='window-drag'){
      const point=value as {phase?:string;x?:number;y?:number},main=this.deps.main();
      if(!this.embedded.has(active)||!main||!point||!['start','move','end'].includes(point.phase||'')||!finite(point.x,-32768,32768)||!finite(point.y,-32768,32768))throw new Error('窗口拖动参数无效');
      if(point.phase==='start'){if(!main.isMaximized()&&!main.isFullScreen()){const [left,top]=main.getPosition();this.windowDrags.set(active,{x:point.x!,y:point.y!,left,top});}}
      else if(point.phase==='end')this.windowDrags.delete(active);
      else{const drag=this.windowDrags.get(active);if(drag)main.setPosition(Math.round(drag.left+point.x!-drag.x),Math.round(drag.top+point.y!-drag.y));}
    }
    else if(action==='seek'){if(!finite(value,0,1e8))throw new Error('跳播参数无效');active.client.seek(Number(value));}
    else if(action==='seek-relative'){if(!finite(value,-120,120))throw new Error('跳播步长无效');active.client.seekBy(Number(value));}
    else if(action==='pause'){if(typeof value!=='boolean')throw new Error('暂停参数无效');await active.client.command(['set_property','pause',value]);}
    else if(action==='volume'){if(!finite(value,0,100))throw new Error('音量参数无效');await active.client.command(['set_property','volume',value]);active.client.snapshot.properties.volume=value;active.audioRevision++;}
    else if(action==='mute'){if(typeof value!=='boolean')throw new Error('静音参数无效');await active.client.command(['set_property','mute',value]);active.client.snapshot.properties.mute=value;active.audioRevision++;}
    else if(action==='speed'){if(![.5,.75,1,1.25,1.5,2].includes(value as number))throw new Error('倍速参数无效');await active.client.command(['set_property','speed',value]);active.client.snapshot.properties.speed=value;active.speedRevision++;}
    else if(action==='track'){
      const track=value as {kind?:string;id?:number|string};
      const tracks=active.client.snapshot.properties['track-list'];
      if(!track||!['audio','sub'].includes(track.kind||'')||(track.id!=='no'&&(!Array.isArray(tracks)||!tracks.some(t=>t.type===track.kind&&t.id===track.id))))throw new Error('音轨或字幕已变化');
      await active.client.command(['set_property',track.kind==='audio'?'aid':'sid',track.id]);
      let remembered=rememberedTrack(Array.isArray(tracks)?tracks:[],track.kind as 'audio'|'sub',track.id!);
      if(remembered===undefined&&track.kind==='sub'&&Array.isArray(tracks)){
        const selected=tracks.find((value:any)=>value.type==='sub'&&value.id===track.id);
        if(selected?.external){const item=await this.api(`/api/media/${active.mediaId}`);remembered=item.external_subtitles?.find((value:any)=>path.resolve(value.path).toLowerCase()===path.resolve(selected['external-filename']||'').toLowerCase())?.path;}
      }
      const memory=this.trackMemory.get(active);
      if(memory&&remembered!==undefined){Object.assign(memory.changes,{[track.kind==='audio'?'audio':'subtitle']:remembered});memory.revision++;}
    }else if(action==='subtitle-import'){
      if(active.subtitlePicking)throw new Error('请选择或取消当前字幕文件');
      active.subtitlePicking=true;
      try{
        const result=await dialog.showOpenDialog(this.embedded.has(active)?this.deps.main()!:active.overlay,{title:'加载外挂字幕',properties:['openFile'],filters:[{name:'字幕文件',extensions:['srt','ass','ssa','vtt']}]});
        if(result.canceled||!result.filePaths[0])return {cancelled:true};
        if(this.active!==active||active.closing||active.overlay.isDestroyed())throw new Error('原生播放会话已关闭');
        const selected=await realpath(result.filePaths[0]),info=await stat(selected);
        if(!path.isAbsolute(selected)||!['.srt','.ass','.ssa','.vtt'].includes(path.extname(selected).toLowerCase())||!info.isFile()||info.size>16*1024**2)throw new Error('请选择不超过 16 MB 的 SRT、ASS、SSA 或 VTT 字幕');
        await active.client.command(['sub-add',selected,'select']);
        const item=await this.api(`/api/media/${active.mediaId}`),known=item.external_subtitles?.find((value:any)=>path.resolve(value.path).toLowerCase()===selected.toLowerCase());
        const memory=this.trackMemory.get(active);
        if(known&&memory){memory.changes.subtitle=known.path;memory.revision++;return {ok:true};}
        return {ok:true,memory:'session'};
      }finally{active.subtitlePicking=false;}
    }else if(action==='subtitle-style'){
      const style=subtitleStyle(value);
      await Promise.all(subtitleOptions(style).map(([key,v])=>active.client.command(['set_property',key,v])));
      active.subtitleAppearance=style;active.styleRevision++;this.publish(active);
    }else if(action==='sub-delay'){if(!finite(value,-10,10))throw new Error('字幕延迟无效');await active.client.command(['set_property','sub-delay',value]);const memory=this.trackMemory.get(active);if(memory){memory.changes.delay=Number(value);memory.revision++;}}
    else if(action==='rotate'){if(![0,90,180,270].includes(value as number))throw new Error('旋转参数无效');await active.client.command(['set_property','video-rotate',value]);active.client.snapshot.properties['video-rotate']=value;}
    else if(action==='transform'){
      const transform=value as {zoom?:number;x?:number;y?:number};
      if(!transform||!finite(transform.zoom,0,3)||!finite(transform.x,-3,3)||!finite(transform.y,-3,3))throw new Error('画面缩放参数无效');
      await Promise.all([['video-zoom',transform.zoom],['video-pan-x',transform.x],['video-pan-y',transform.y]].map(([name,v])=>active.client.command(['set_property',name,v])));
    }else if(action==='screenshot'){
      if(active.screenshotBusy)throw new Error('截图正在保存，请稍后重试');
      const task=this.screenshot(active);this.captureTasks.set(active,task);
      void task.finally(()=>{if(this.captureTasks.get(active)===task)this.captureTasks.delete(active);}).catch(()=>{});return task;
    }
    else if(action==='navigate'){
      if(value!=='next'&&value!=='previous'&&value!=='queue'&&value!=='retry')throw new Error('队列操作无效');
      if(value==='retry'&&active.client.snapshot.phase!=='error')throw new Error('当前播放无需重试');
      if(value==='queue'){const main=this.deps.main();if(main&&!main.isDestroyed()){if(main.isMinimized())main.restore();main.show();main.focus();}}
      this.deps.main()?.webContents.send('avhub:native-event',{session:active.client.session,kind:value});
    }
    else if(action==='window'){
      if(this.embedded.has(active)){
        const main=this.deps.main()!;
        if(value==='minimize'||value==='close'||value==='maximize')this.deps.windowAction(value);
        else if(value==='fullscreen'){main.setFullScreen(!main.isFullScreen());}
        else if(value==='pin')this.deps.mode({alwaysOnTop:!main.isAlwaysOnTop()});
        else if(value==='pure'){active.pure=!this.deps.windowState().purePlayback;this.deps.mode({purePlayback:active.pure});this.fit(active);}
        else throw new Error('窗口操作无效');
        if(value!=='close')this.deps.mode({}); // publish the main-page layout state too
        if(value!=='close')await this.deps.settled();
        this.publish(active);return {ok:true};
      }
      active.geometryGuardUntil=Date.now()+300;
      if(value==='minimize')active.host.minimize();
      else if(value==='maximize'){
        if(active.pure){
          if(active.expanded){const restore=active.expanded;active.expanded=null;active.host.setContentBounds(restore);this.fit(active);}
          else{active.expanded=active.host.getContentBounds();this.fit(active);}
        }else active.host.isMaximized()?active.host.unmaximize():active.host.maximize();
      }
      else if(value==='fullscreen'){active.host.setFullScreen(!active.host.isFullScreen());}
      else if(value==='pin'){active.host.setAlwaysOnTop(!active.host.isAlwaysOnTop());active.overlay.setAlwaysOnTop(active.host.isAlwaysOnTop());}
      else if(value==='pure'){
        active.pure=!active.pure;active.host.setAlwaysOnTop(active.pure);active.overlay.setAlwaysOnTop(active.pure);
        if(active.pure){
          active.normalMaximized=active.host.isMaximized();if(active.normalMaximized)active.host.unmaximize();
          active.normal=active.host.getContentBounds();active.expanded=null;this.fit(active);
        }else{
          active.host.setAspectRatio(0);active.overlay.setAspectRatio(0);active.host.setMinimumSize(300,180);active.overlay.setMinimumSize(300,180);
          active.expanded=null;if(active.normal)active.host.setContentBounds(active.normal);if(active.normalMaximized)active.host.maximize();
        }
      }else throw new Error('窗口操作无效');this.publish(active);
    }else throw new Error('不支持的原生播放操作');
    return {ok:true};
  }
  private view(active:Active){const live=!active.host.isDestroyed(),mode=this.embedded.has(active)?this.deps.windowState():null;return {...active.client.snapshot,startupTimings:{...this.startupTimings.get(active)},revision:this.revisions.get(active)||0,embedded:Boolean(mode),mediaId:active.mediaId,title:active.title,saveError:active.saveError,subtitleAppearance:active.subtitleAppearance,pure:mode?.purePlayback??active.pure,pinned:mode?.alwaysOnTop??(live&&active.host.isAlwaysOnTop()),fullscreen:mode?.fullScreen??(live&&active.host.isFullScreen()),maximized:mode?.maximized??(live&&(active.host.isMaximized()||active.expanded!==null))};}
  private urgency=new WeakMap<Active,boolean>();
  private activityWrites=new WeakMap<Active,Promise<unknown>>();
  private activityWanted=new WeakMap<Active,{owner:string;media_id:number;present:boolean;playing:boolean;preparing:boolean}>();
  private revisions=new WeakMap<Active,number>();
  private mainPhases=new WeakMap<Active,string>();
  private pendingSaves=new WeakMap<Active,Promise<unknown>>();
  private captureTasks=new WeakMap<Active,Promise<unknown>>();
  private capturingFrames=new WeakSet<Active>();
  private activity(active:Active,present=true){
    const snapshot=active.client.snapshot;
    const preparing=snapshot.phase==='starting'||snapshot.pendingSeek!==null;
    const body={owner:active.owner,media_id:active.mediaId,present,playing:present&&(preparing||snapshot.properties.pause===false&&snapshot.properties['eof-reached']!==true),preparing:present&&preparing};
    this.activityWanted.set(active,body);
    const running=this.activityWrites.get(active);if(running)return running;
    const task:Promise<unknown>=Promise.resolve().then(async()=>{
      while(this.activityWanted.has(active)){
        const latest=this.activityWanted.get(active)!;this.activityWanted.delete(active);
        try{await this.api('/api/playback/activity','POST',latest);}
        catch(error){if(!this.activityWanted.has(active))throw error;}
      }
    }).finally(()=>{
      if(this.activityWrites.get(active)===task)this.activityWrites.delete(active);
      const remaining=this.activityWanted.get(active);if(remaining)return this.activity(active,remaining.present);
    });
    this.activityWrites.set(active,task);return task;
  }
  private publish(active:Active){
    this.revisions.set(active,(this.revisions.get(active)||0)+1);
    const urgent=active.client.snapshot.phase==='starting'||active.client.snapshot.pendingSeek!==null;
    if(!active.closing&&this.urgency.get(active)!==urgent){this.urgency.set(active,urgent);void this.activity(active).catch(()=>this.deps.log('native-priority-not-saved'));}
    // Many observed properties change for the same decoded frame. Publish the
    // latest snapshot at most 30 times/sec, never queue historical UI states.
    if(active.publishTimer||active.overlay.isDestroyed()||active.host.isDestroyed())return;
    active.publishTimer=setTimeout(()=>{
      active.publishTimer=undefined;if(active.overlay.isDestroyed()||active.host.isDestroyed())return;
      const state=this.view(active);active.overlay.webContents.send('avhub:native-state',state);
      // Main library needs failure/retry state, not a second 30 Hz stream of
      // track lists and clocks. Forward only phase/error transitions.
      const signature=JSON.stringify([state.phase,state.error,state.failureCode]);
      if(this.mainPhases.get(active)!==signature){
        this.mainPhases.set(active,signature);const main=this.deps.main();
        if(main&&!main.isDestroyed())main.webContents.send('avhub:native-state',{session:state.session,revision:state.revision,phase:state.phase,error:state.error,failureCode:state.failureCode,firstFrameMs:state.firstFrameMs,readyMs:state.readyMs});
      }
    },33);
  }
  private fit(active:Active){
    if(active.host.isDestroyed()||active.overlay.isDestroyed()||active.host.isFullScreen())return;
    const video=active.client.snapshot.properties['video-params'] as {dw?:number;dh?:number;rotate?:number}|undefined;
    if(!video?.dw||!video.dh)return;
    // video-params already includes the user's video-rotate override.
    const rotated=Number(video.rotate||0)%180!==0;
    const ratio=rotated?video.dh/video.dw:video.dw/video.dh;
    if(this.embedded.has(active)){if(this.deps.windowState().purePlayback)this.deps.mode({videoAspectRatio:ratio});return;}
    const outer=active.host.getBounds(),content=active.host.getContentBounds();
    const area=screen.getDisplayMatching(outer).workArea;
    const work={x:area.x+content.x-outer.x,y:area.y+content.y-outer.y,width:area.width-(outer.width-content.width),height:area.height-(outer.height-content.height)};
    const minimum=playbackMinimum(ratio,work);
    active.host.setMinimumSize(...minimum);active.overlay.setMinimumSize(...minimum);
    active.host.setAspectRatio(ratio);active.overlay.setAspectRatio(ratio);
    active.host.setContentBounds(fitPlaybackBounds(content,work,ratio,active.expanded!==null));
  }
  private async open(mediaId:number,start:number,viewport?:NativeViewport){
    if(this.opening)throw new Error('原生播放器正在启动');
    if(!this.status().available)throw new Error('尚未准备 MPV 运行库，请运行 scripts/prepare-mpv.ps1；现有播放器仍可使用');
    if(this.active===this.failedStartup&&this.active){try{await this.close(true);}catch(cleanup){throw startupFailure(this.failedStartupError??new Error('原生会话清理未完成'),cleanup);}}
    if(this.active)throw new Error('请先关闭当前原生播放窗口');
    this.opening=true;const owner=randomBytes(16).toString('hex');let active:Active|undefined;const ownedWindows:BaseWindow[]=[];
    const began=performance.now(),timings:Record<string,number>={};let checkpoint=began;
    const mark=(name:string)=>{const now=performance.now();timings[name]=now-checkpoint;checkpoint=now;};
    try{
      // These independent reads must not serialize source reservation, window
      // setup and playback. Failed acquisition is still tombstoned in catch;
      // no process is retained and no old source read lease is reused.
      const [source,prefs,memory]=await Promise.all([
        this.api(`/api/media/${mediaId}/native-read`,'POST',{owner}),
        this.api('/api/preferences'),
        this.api(`/api/media/${mediaId}/playback-state`) as Promise<MediaPlaybackState>,
      ]);
      mark('metadataMs');
      const work=screen.getDisplayMatching(this.deps.main()!.getBounds()).workArea;
      const width=Math.min(1100,work.width),height=Math.min(700,work.height);
      // Keep WS_THICKFRAME on the opaque host: Electron's Windows fallback for
      // thickFrame:false only changes bounds and isFullScreen() stays false.
      // Invisible native resize borders live OUTSIDE the video content area.
      // No WebContents / about:blank Chromium compositor over the native child.
      // A BrowserWindow here can obscure MPV's D3D11 HWND with its black surface.
      const host=new BaseWindow({parent:viewport?this.deps.main()!:undefined,icon:this.deps.icon(),x:Math.round(work.x+(work.width-width)/2),y:Math.round(work.y+(work.height-height)/2),width,height,minWidth:300,minHeight:180,show:false,frame:false,thickFrame:!viewport,backgroundColor:'#000000',title:'AVHub · 原生播放'});
      ownedWindows.push(host);
      const overlay=new BrowserWindow({parent:viewport?this.deps.main()!:host,...host.getContentBounds(),skipTaskbar:true,resizable:false,minimizable:false,maximizable:false,fullscreenable:false,hasShadow:false,minWidth:300,minHeight:180,frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',show:false,webPreferences:{preload:path.join(__dirname,'preload.js'),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
      ownedWindows.push(overlay);
      let syncing=false,overlayExpected=overlay.getBounds();
      const sync=(from:BaseWindow,to:BaseWindow)=>{if(viewport||syncing||from.isDestroyed()||to.isDestroyed())return;
        const source=from===host?from.getContentBounds():from.getBounds(),target=to.getBounds();
        if(source.x===target.x&&source.y===target.y&&source.width===target.width&&source.height===target.height)return;
        syncing=true;try{to.setBounds(source);if(to===overlay)overlayExpected=overlay.getBounds();}finally{syncing=false;}};
      let surfaceTimer:ReturnType<typeof setTimeout>|undefined;
      const refreshSurface=()=>{clearTimeout(surfaceTimer);surfaceTimer=setTimeout(()=>{if(active&&!active.closing)void this.raiseSurface(active).catch(()=>this.deps.log('native-surface-order-failed'));},80);};
      host.on('move',()=>sync(host,overlay));host.on('resize',()=>{sync(host,overlay);if(active)this.publish(active);refreshSurface();});
      host.on('closed',()=>clearTimeout(surfaceTimer));host.on('restore',refreshSurface);
      let embeddedTimer:ReturnType<typeof setTimeout>|undefined;
      const embeddedMain=viewport?this.deps.main():null;
      const followMain=()=>{
        if(!active||active.closing||!embeddedMain||embeddedMain.isDestroyed()||overlay.isDestroyed())return;
        const rect=this.embedded.get(active);if(!rect)return;
        const content=embeddedMain.getContentBounds();
        overlay.setBounds({x:Math.round(content.x+rect.x),y:Math.round(content.y+rect.y),width:Math.round(rect.width),height:Math.round(rect.height)});
        clearTimeout(embeddedTimer);embeddedTimer=setTimeout(()=>{if(active&&!active.closing)void this.embed(active).catch(()=>this.deps.log('native-overlay-follow-failed'));},40);
      };
      const hideEmbedded=()=>{if(!overlay.isDestroyed())overlay.hide();};
      const pinEmbedded=()=>{if(embeddedMain&&!embeddedMain.isDestroyed()&&!overlay.isDestroyed())overlay.setAlwaysOnTop(embeddedMain.isAlwaysOnTop());};
      const focusEmbedded=()=>{if(active&&!active.closing&&this.embedded.get(active)?.visible&&!overlay.isDestroyed()){overlay.showInactive();overlay.moveTop();}};
      embeddedMain?.on('move',followMain);embeddedMain?.on('resize',followMain);embeddedMain?.on('restore',followMain);embeddedMain?.on('minimize',hideEmbedded);
      embeddedMain?.on('always-on-top-changed',pinEmbedded);pinEmbedded();
      embeddedMain?.on('focus',focusEmbedded);
      // Native fullscreen/maximize belongs to the host. A delayed overlay
      // resize must never setBounds(host) and undo the OS window transition.
      const overlayGeometry=()=>{
        if(viewport)return;
        if(syncing||host.isDestroyed()||overlay.isDestroyed()||host.isFullScreen()||host.isMaximized()||active&&Date.now()<active.geometryGuardUntil)return;
        const bounds=overlay.getBounds();
        // Fractional DPI can make the two HWND rectangles differ by 1 DIP.
        // Compare against the measured overlay result, not the requested host
        // size. Otherwise delayed WM_SIZE events create a resize feedback loop.
        if(['x','y','width','height'].every(key=>Math.abs(bounds[key as keyof Electron.Rectangle]-overlayExpected[key as keyof Electron.Rectangle])<=2))return;
        const base=host.getContentBounds();syncing=true;
        try{host.setContentBounds({x:base.x+bounds.x-overlayExpected.x,y:base.y+bounds.y-overlayExpected.y,width:base.width,height:base.height});}
        finally{syncing=false;}
        sync(host,overlay);
      };
      overlay.on('move',overlayGeometry);
      host.on('minimize',()=>overlay.hide());host.on('restore',()=>{if(!active||active.closing||overlay.isDestroyed())return;sync(host,overlay);overlay.show();overlay.focus();this.publish(active);});
      const maximizeChanged=()=>{sync(host,overlay);if(active)this.publish(active);};
      host.on('maximize',maximizeChanged);host.on('unmaximize',maximizeChanged);
      const displayChanged=()=>{
        if(viewport){refreshSurface();return;}
        if(!active||active.closing||host.isDestroyed()||overlay.isDestroyed()||host.isMinimized())return;
        active.geometryGuardUntil=Date.now()+300;
        if(active.pure)this.fit(active);
        else if(!host.isFullScreen()&&!host.isMaximized()){
          const work=screen.getDisplayMatching(host.getBounds()).workArea,bounds=host.getBounds();
          const width=Math.min(bounds.width,work.width),height=Math.min(bounds.height,work.height);
          host.setBounds({width,height,x:Math.max(work.x,Math.min(bounds.x,work.x+work.width-width)),y:Math.max(work.y,Math.min(bounds.y,work.y+work.height-height))});
        }
        sync(host,overlay);this.publish(active);
      };
      screen.on('display-metrics-changed',displayChanged);screen.on('display-removed',displayChanged);
      host.on('enter-full-screen',()=>{sync(host,overlay);if(active)this.publish(active);});host.on('leave-full-screen',()=>{if(active?.pure)this.fit(active);sync(host,overlay);if(active)this.publish(active);});
      overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      overlay.webContents.on('will-navigate',event=>event.preventDefault());
      overlay.webContents.on('will-attach-webview',event=>event.preventDefault());
      overlay.on('app-command',(event,command)=>{
        if(command!=='browser-backward'&&command!=='browser-forward')return;
        event.preventDefault();overlay.webContents.send('avhub:mouse-seek',command==='browser-forward'?'forward':'back');
      });
      let ended=false;
      const client=new MpvClient(()=>{if(active){this.publish(active);if(active.pure&&client.snapshot.properties['video-params'])this.fitWhenChanged(active);
        if(client.snapshot.phase==='ready')ended=false;
        if(client.snapshot.phase==='ended'&&client.endReason==='natural'&&!ended){ended=true;this.deps.main()?.webContents.send('avhub:native-event',{session:client.session,kind:'ended'});}
      }},()=>{if(active)void this.close().catch(error=>this.deps.log(`native-close-failed ${error.message}`));});
      active={client,host,overlay,mediaId,title:String(source.title),owner,closing:false,saveError:'',heartbeat:setInterval(()=>{if(active)this.heartbeat(active);},3000),persist:Promise.resolve(),pure:false,normal:null,normalMaximized:false,expanded:null,screenshotBusy:false,audioRevision:0,speedRevision:0,savedAudio:0,savedSpeed:0,subtitleAppearance:defaultSubtitleAppearance,styleRevision:0,savedStyle:0,subtitlePicking:false,geometryGuardUntil:Date.now()+300,operations:new Set(),disposeWindows:()=>{clearTimeout(embeddedTimer);embeddedMain?.removeListener('move',followMain);embeddedMain?.removeListener('resize',followMain);embeddedMain?.removeListener('restore',followMain);embeddedMain?.removeListener('minimize',hideEmbedded);embeddedMain?.removeListener('always-on-top-changed',pinEmbedded);embeddedMain?.removeListener('focus',focusEmbedded);screen.removeListener('display-metrics-changed',displayChanged);screen.removeListener('display-removed',displayChanged);}};
      this.active=active;
      this.startupTimings.set(active,timings);mark('windowsMs');
      if(viewport)this.embedded.set(active,viewport);
      const intercept=(event:Electron.Event)=>{if(active&&!active.closing){event.preventDefault();void this.close().catch(error=>{active!.saveError=error.message;this.publish(active!);});}};
      host.on('close',intercept);overlay.on('close',intercept);
      const lostWindow=()=>{if(active&&!active.closing){this.deps.main()?.webContents.send('avhub:native-event',{session:client.session,kind:'error',detail:'原生播放窗口已意外关闭，请重新打开视频'});void this.close().catch(()=>this.deps.log('native-window-cleanup-failed'));}};
      host.on('closed',lostWindow);overlay.on('closed',lostWindow);
      overlay.webContents.on('render-process-gone',()=>{if(active)this.controlsUnavailable(active);});
      // The controls document and decoder initialize independently. Do not
      // serialize local renderer navigation in front of decoder startup.
      // Neither surface is shown until both branches are ready.
      const controlsBegan=performance.now();
      const controlsReady=overlay.loadURL(`${this.deps.origin()}/?nativePlayer=${client.session}`).then(()=>{timings.controlsMs=performance.now()-controlsBegan;if(active&&!overlay.isDestroyed())this.rendererPids.set(active,overlay.webContents.getOSProcessId());});
      void controlsReady.catch(()=>{});
      const handle=host.getNativeWindowHandle();
      const hwnd=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());
      const audio=prefs.values?.audio||{volume:1,muted:false};
      active.subtitleAppearance=subtitleStyle(prefs.values?.subtitleAppearance??defaultSubtitleAppearance);
      this.trackMemory.set(active,{state:memory,changes:{},revision:0,saved:0});
      const restoreMemory=async()=>{
      const tracks=await client.command(['get_property','track-list']) as any[];
      for(const [kind,choice] of [['audio',memory.audio],['sub',memory.subtitle]] as const){
        const id=nativeTrackChoice(tracks,kind,choice);
        if(id!==undefined)await client.command(['set_property',kind==='audio'?'aid':'sid',id]);
      }
      if(memory.subtitle&& !memory.subtitle.startsWith('embedded:')){
        const item=await this.api(`/api/media/${mediaId}`);
        if(item.external_subtitles?.some((s:any)=>s.path===memory.subtitle))await client.command(['sub-add',memory.subtitle,'select']);
      }
      await client.command(['set_property','sub-delay',memory.delay]);
      };
      const hasMemory=memory.audio!==null||memory.subtitle!==null||memory.delay!==0;
      const engineBegan=performance.now();
      const engineReady=client.start(this.deps.runtime(),String(source.path),hwnd,start,[`--volume=${Math.max(0,Math.min(100,Number(audio.volume)*100))}`,`--mute=${audio.muted===true?'yes':'no'}`,`--speed=${Number(prefs.values?.playbackSpeed)||1}`,'--sub-ass-override=no',...subtitleOptions(active.subtitleAppearance).map(([key,value])=>`--${key}=${value}`)],hasMemory?restoreMemory:undefined).then(()=>{timings.engineMs=performance.now()-engineBegan;});
      // Await both settlements before cleanup so a late startup branch cannot
      // touch a destroyed host or leave an unobserved rejection behind.
      const initialized=await Promise.allSettled([controlsReady,engineReady]);
      // Decoder exit can abort renderer navigation as a secondary failure.
      // Preserve the actual decoder error rather than reporting ERR_ABORTED.
      if(initialized[1].status==='rejected')throw initialized[1].reason;
      if(initialized[0].status==='rejected')throw initialized[0].reason;
      const ensureLive=()=>{
        if(this.active!==active||active.closing||host.isDestroyed()||overlay.isDestroyed()||['closed','error'].includes(client.snapshot.phase))throw new Error(client.snapshot.error||'原生播放启动已取消');
      };
      ensureLive();
      checkpoint=performance.now();
      if(!viewport){host.show();overlay.show();overlay.focus();}
      // Views still creates an Intermediate D3D child for an empty BaseWindow.
      // Put only our MPV child above that sibling, never above the controls
      // (a separate owned window), and do not change focus or rendering quality.
      await this.raiseSurface(active);
      mark('surfaceMs');
      if(viewport){
        await this.embed(active);
        // Reparent before showing so there is never a top-level player popup.
        // Inform Electron as well as Win32, so Chromium receives WasShown.
        if(viewport.visible&&viewport.clip.width>0&&viewport.clip.height>0){host.showInactive();overlay.showInactive();await this.embed(active);}
        this.publish(active);
      }
      ensureLive();mark('embeddingMs');timings.totalMs=performance.now()-began;
      this.deps.log('native-player-start engine=mpv source=original');
      return {session:client.session};
    }catch(error){
      if(active){
        this.failedStartup=active;
        this.failedStartupError=startupFailure(error);
        this.deps.log(`native-player-start-failed stage=${active.client.startupStage}`);
        try{await this.close(true);}catch(cleanup){this.deps.log(`native-player-start-cleanup-pending stage=${active.client.startupStage}`);throw startupFailure(error,cleanup);}
      }
      else {
        for(const window of ownedWindows.reverse())if(!window.isDestroyed())window.destroy();
        // Even a timed-out acquire may have committed. Cancellation is
        // idempotent and tombstoned by the backend before releasing readers.
        try{await this.api(`/api/native-read/${owner}`,'DELETE');}catch(cleanup){this.deps.log('native-player-start-cleanup-pending stage=acquire');throw startupFailure(error,cleanup);}
      }
      throw error;
    }finally{this.opening=false;}
  }
  private fitted=new WeakMap<Active,string>();
  private fitWhenChanged(active:Active){
    const video=active.client.snapshot.properties['video-params'] as {dw?:number;dh?:number;rotate?:number};
    const signature=JSON.stringify([video?.dw,video?.dh,video?.rotate]);
    if(this.fitted.get(active)!==signature){this.fitted.set(active,signature);this.fit(active);}
  }
  private save(active:Active,final=false){
    const pending=this.pendingSaves.get(active);if(!final&&pending)return pending;
    const task=active.persist.catch(()=>{}).then(async()=>{
      const props=active.client.playbackProperties??active.client.snapshot.properties,position=props['time-pos'];
      const writes:Promise<unknown>[]=[];
      const values:Record<string,unknown>={},audioRevision=active.audioRevision,speedRevision=active.speedRevision,styleRevision=active.styleRevision;
      const memory=this.trackMemory.get(active),memoryRevision=memory?.revision;
      if(memory&&!memory.invalidated&&memory.revision>memory.saved){const changes={...memory.changes};writes.push(this.api(`/api/media/${active.mediaId}/playback-state`,'PATCH',{source:memory.state.source,changes,updated_at:Date.now()}).then(()=>{memory.saved=memoryRevision!;}).catch(error=>{
        if(error instanceof Error&&'status' in error&&error.status===409){memory.invalidated=true;this.deps.log('Native playback memory retired: source identity changed or awaits review');return;}
        throw error;
      }));}
      if(audioRevision>active.savedAudio)values.audio={volume:Math.max(0,Math.min(1,Number(props.volume||0)/100)),muted:props.mute===true};
      if(speedRevision>active.savedSpeed)values.playbackSpeed=props.speed;
      if(styleRevision>active.savedStyle)values.subtitleAppearance=active.subtitleAppearance;
      if(Object.keys(values).length)writes.push(this.api('/api/preferences','PATCH',{values,updated_at:Date.now()}).then(()=>{active.savedAudio=audioRevision;active.savedSpeed=speedRevision;active.savedStyle=styleRevision;}));
      if(typeof position==='number'&&Number.isFinite(position))writes.push(this.api(`/api/media/${active.mediaId}/progress`,'PUT',{progress:position,watched:props['eof-reached']===true,updated_at:Date.now()}));
      if(!final)writes.push(this.activity(active));
      try{await Promise.all(writes);active.saveError='';}catch{active.saveError='播放进度或占用状态保存失败，请重试关闭';throw new Error(active.saveError);}finally{this.publish(active);}
    });active.persist=task;this.pendingSaves.set(active,task);
    void task.finally(()=>{if(this.pendingSaves.get(active)===task)this.pendingSaves.delete(active);}).catch(()=>{});return task;
  }
  private async screenshot(active:Active){
    if(active.screenshotBusy||active.closing)throw new Error('截图正在保存，请稍后重试');
    active.screenshotBusy=true;this.capturingFrames.add(active);
    try{
      await Promise.allSettled([...active.operations]);
      // Release the frame lock as soon as MPV writes the independent PNG;
      // keep the close/read reservation through the remaining publication.
      return await captureNativeFrame(this.deps,active,()=>this.capturingFrames.delete(active));
    }finally{
      this.capturingFrames.delete(active);
      active.screenshotBusy=false;
    }
  }
  private closing:Promise<void>|null=null;
  async shutdown(discard=false){
    this.shuttingDown=true;
    try{
      if(this.pendingOpen){await this.independent.cancelStartup();if(this.active)await this.active.client.stop();}
      await this.pendingOpen?.catch(()=>{});await this.independent.close(discard);await this.close(discard);
    }finally{this.shuttingDown=false;}
  }
  close(discard=false):Promise<void>{
    if(this.closing)return this.closing;
    const active=this.active;if(!active)return Promise.resolve();
    this.closing=(async()=>{
      active.closing=true;clearInterval(active.heartbeat);
      const capture=this.captureTasks.get(active);
      if(capture){
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{await Promise.race([capture.catch(()=>{}),new Promise<void>((_,reject)=>{timer=setTimeout(()=>reject(new Error('截图仍在保存，请稍后重试关闭')),5000);})]);}
        finally{clearTimeout(timer);}
      }
      // Finish already accepted preference commands before the final snapshot.
      // New commands are rejected once closing begins; transport ACKs are bounded.
      await Promise.allSettled([...active.operations]);
      await this.save(active,true).catch(error=>{if(!discard)throw error;});
      await active.client.stop(); // Never release the read fence before exit.
      // A readiness probe may still be in flight during startup cancellation.
      // Settle it before releasing its owner and recycling native HWNDs.
      await this.surfaceTasks.get(active)?.catch(()=>{});
      await this.activity(active,false);
      await this.api(`/api/native-read/${active.owner}`,'DELETE');
      clearTimeout(active.publishTimer);active.disposeWindows?.();
      await this.embeddingTasks.get(active)?.catch(()=>{});
      if(this.embedded.has(active)&&this.deps.main()&&!this.deps.main()!.isDestroyed()){
        if(this.deps.windowState().purePlayback)this.deps.mode({purePlayback:false,alwaysOnTop:false});
        if(this.deps.main()!.isFullScreen())this.deps.main()!.setFullScreen(false);
      }
      if(!active.overlay.isDestroyed())active.overlay.destroy();if(!active.host.isDestroyed())active.host.destroy();
      this.active=null;
      if(this.failedStartup===active){this.failedStartup=null;this.failedStartupError=null;}
      const main=this.deps.main();if(main&&!main.isDestroyed())main.webContents.send('avhub:native-closed',{session:active.client.session,mediaId:active.mediaId,ended:active.client.snapshot.properties['eof-reached']===true});
      this.deps.log('native-player-closed');
    })().finally(()=>{
      if(this.active===active){active.closing=false;clearInterval(active.heartbeat);active.heartbeat=setInterval(()=>this.heartbeat(active),3000);}
      this.closing=null;
    });return this.closing;
  }
}
