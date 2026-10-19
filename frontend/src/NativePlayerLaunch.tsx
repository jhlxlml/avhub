import {useEffect,useRef,useState} from 'react';
import {api,duration,errorText,type Media,type MediaUpdate,type PlaylistSource,type QueuePage} from './api';
import {startingPoint,readResumeBehavior} from './resumeBehavior';
import {useAutoplay,changeAutoplay} from './autoplay';
import {PlaybackQueue} from './PlaybackQueue';
import {Button,StatusMessage} from './ui';
import {Icon} from './Icon';
import {initializePreferences,preference} from './preferences';
import {measureNativeViewport,useNativeViewport} from './nativeViewport';
import {useWindowMode} from './windowMode';
import {ThemeToggle} from './AppearanceControls';
import {MediaActions} from './MediaActions';
import {nativeErrorText} from './nativeError';
import {confirmInApp} from './AppConfirm';

export function NativePlayerLaunch({media,automatic=false,close,playNext,queue,changePlaylistPlayback,update,notify,fallback,registerNavigationGuard,favoriteBusy,changeFavorite}:{
  media:Media;automatic?:boolean;close:()=>void;playNext:(media:Media,automatic?:boolean)=>void;queue?:PlaylistSource;
  update:(value:MediaUpdate)=>void;notify:(message:string,ms?:number)=>void;fallback:()=>void;registerNavigationGuard:(guard:()=>Promise<boolean>)=>()=>void;
  changePlaylistPlayback:(change:Partial<Pick<PlaylistSource,'mode'|'autoNext'>>)=>void;
  favoriteBusy:boolean;changeFavorite:(media:Media)=>Promise<void>;
}){
  const viewport=useRef<HTMLDivElement>(null),windowMode=useWindowMode();
  const [attachedSession,setAttachedSession]=useState<string|null>(null);
  const [independent,setIndependent]=useState(()=>preference<string>('mpvWindowMode','embedded')==='independent');
  const [independentProgress,setIndependentProgress]=useState<{position:number;length:number;paused:boolean}|null>(null);
  const [independentStopped,setIndependentStopped]=useState(false),[saveError,setSaveError]=useState('');
  const [recovery,setRecovery]=useState<'save'|'cleanup'|null>(null),[recoveryBusy,setRecoveryBusy]=useState(false);
  const [nativeFailure,setNativeFailure]=useState(false),[retryBusy,setRetryBusy]=useState(false),retrying=useRef(false);
  const retryAttempt=useRef<{sequence:number;pending:number|null}>({sequence:0,pending:null});
  const stateRevision=useRef(-1);
  useNativeViewport(viewport,independent?null:attachedSession,error=>setError(errorText(error)));
  const decision=useRef(startingPoint(media,automatic,readResumeBehavior()));
  const [start,setStart]=useState<number|null>(decision.current.ask?null:decision.current.start);
  const [state,setState]=useState('正在准备原生播放…'),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const session=useRef<string|null>(null),opening=useRef<Promise<void>|null>(null),alive=useRef(true),navigation=useRef(false);
  const launching=useRef(false),earlyEvents=useRef<{closed:boolean;value:any}[]>([]);
  const receiveEvent=useRef<(event:any)=>Promise<void>>(async()=>{}),receiveClosed=useRef<(event:any)=>void>(()=>{});
  const autoplay=useAutoplay();
  const [siblings,setSiblings]=useState<QueuePage|null>(null),[queueBusy,setQueueBusy]=useState(false),[queueReveal,setQueueReveal]=useState(0);
  const options=useRef({queue,autoplay,playNext});options.current={queue,autoplay,playNext};
  async function stop(){await opening.current;if(session.current){const id=session.current;await window.avhubDesktop!.nativePlayer('close',id);session.current=null;}else await window.avhubDesktop!.nativePlayer('recover');}
  useEffect(()=>registerNavigationGuard(async()=>{if(retrying.current)return false;try{await stop();return true;}catch(e){setError(errorText(e));return false;}}),[registerNavigationGuard]);
  useEffect(()=>{
    alive.current=true;
    const desktop=window.avhubDesktop;if(!desktop)return;
    const closed=(value:any)=>{if(value.session===session.current){session.current=null;if(alive.current){setAttachedSession(null);setNativeFailure(false);setIndependentStopped(false);setRecovery(null);setSaveError('');setError('');setState('原生播放已关闭');void api<Media>(`/api/media/${media.id}`).then(update).catch(()=>{});}}};
    receiveClosed.current=closed;
    const stash=(closed:boolean,value:any)=>{earlyEvents.current.push({closed,value});if(earlyEvents.current.length>8)earlyEvents.current.shift();};
    const unsubscribe=desktop.onNativeClosed(value=>{if(launching.current&&!session.current)stash(true,value);else closed(value);});
    receiveEvent.current=async event=>{
      if(event.session!==session.current||navigation.current)return;
      if(event.kind==='error'){setError(event.detail||'原生窗口异常关闭，请重试或切回现有播放器');return;}
      if(event.kind==='retry'){await retryNative();return;}
      if(event.kind==='queue'){setQueueReveal(value=>value+1);return;}
      if(!['ended','previous','next'].includes(event.kind))return;
      const {queue:q,autoplay:global,playNext:next}=options.current;
      const enabled=q?q.autoNext??true:global.enabled,mode=q?q.mode??'sequential':global.mode;
      if(event.kind==='ended'&&!enabled)return;
      navigation.current=true;
      try{
        if(event.kind==='ended'&&mode==='repeat-one'){await desktop.nativePlayer('replay',session.current);return;}
        let target:Media|null=null;
        if(mode==='random'&&event.kind!=='previous'){
          target=(await api<{next:Media|null}>(`/api/media/${media.id}/random?scope=${global.scope}${q?`&playlist_id=${q.id}`:''}`)).next;
        }else{
          const page=await api<QueuePage>(q?`/api/playlists/${q.id}/queue?media_id=${media.id}&page_size=1`:`/api/media/${media.id}/siblings?scope=${global.scope}&page_size=1`);
          target=event.kind==='previous'?page.previous:page.next;
        }
        if(target){await stop();if(alive.current)next(target,event.kind==='ended');}
        else if(event.kind!=='ended')notify('没有其他可播放的视频',3000);
      }catch(e){if(alive.current)setError(errorText(e));}finally{navigation.current=false;}
    };
    const events=desktop.onNativeEvent(event=>{if(launching.current&&!session.current)stash(false,event);else void receiveEvent.current(event);});
    const states=desktop.onNativeState?.(value=>{
      if(!alive.current||value.session!==session.current||value.revision<=stateRevision.current)return;
      stateRevision.current=value.revision;
      setNativeFailure(value.phase==='error');
      if(value.phase==='error'){setError(value.error||'原生播放失败，请重试');setState('原生播放失败');}
      if(value.presentation!=='independent')return;
      setSaveError(typeof value.saveError==='string'?value.saveError:'');
      setIndependentStopped(value.stopped===true||value.phase==='closed');
      setRecovery(value.recovery==='save'||value.recovery==='cleanup'?value.recovery:null);
      if(value.stopped===true||value.phase==='closed')setState('原生播放窗口已关闭');
      const p=value.properties;
      if(typeof p?.['time-pos']==='number')setIndependentProgress({position:p['time-pos'],length:Number(p.duration)||0,paused:p.pause===true});
    });
    const quitting=(event:Event)=>{(event as CustomEvent<Promise<boolean>[]>).detail.push((async()=>{try{await opening.current;if(session.current)await desktop.nativePlayer('flush',session.current);return true;}catch{return false;}})());};
    window.addEventListener('avhub-before-quit',quitting);
    return()=>{alive.current=false;unsubscribe();events();states?.();window.removeEventListener('avhub-before-quit',quitting);void stop().catch(()=>{});};
  },[media.id]);
  useEffect(()=>{
    if(start===null)return;
    let cancelled=false;setError('');setSaveError('');setRecovery(null);setNativeFailure(false);setIndependentStopped(false);setState('正在准备原生播放…');setIndependentProgress(null);stateRevision.current=-1;
    opening.current=(async()=>{
      launching.current=true;earlyEvents.current=[];
      try{
        if(!window.avhubDesktop?.nativePlayer)throw new Error('桌面原生播放接口未就绪，请重启应用');
        if(!viewport.current)throw new Error('播放区域尚未就绪');
        const result=await window.avhubDesktop.nativePlayer('open',{mediaId:media.id,start,viewport:measureNativeViewport(viewport.current)});
        session.current=result.session;
        if(cancelled){await window.avhubDesktop.nativePlayer('close',result.session);session.current=null;}
        else if(alive.current){
          setIndependent(result.presentation==='independent');setState(result.presentation==='independent'?'MPV · 独立窗口播放原文件':'MPV · 原文件直接播放');setAttachedSession(result.session);launching.current=false;
          for(const event of earlyEvents.current.splice(0))if(event.value.session===result.session){if(event.closed)receiveClosed.current(event.value);else void receiveEvent.current(event.value);}
        }
      }catch(e){if(!cancelled&&alive.current){setError(nativeErrorText(e));setState('原生播放启动失败');}}
      finally{
        launching.current=false;earlyEvents.current=[];
        // Retrying includes attaching the replacement session, not just
        // scheduling setAttempt. Don't expose an active Back button in the
        // hand-off gap or let an older launch clear a newer retry's guard.
        if(retryAttempt.current.pending===attempt){retryAttempt.current.pending=null;retrying.current=false;if(!cancelled&&alive.current)setRetryBusy(false);}
      }
    })();
    return()=>{cancelled=true;};
  },[start,media.id,attempt]);
  async function back(useFallback=false){if(retrying.current)return;try{await stop();if(useFallback){await initializePreferences();update(await api<Media>(`/api/media/${media.id}`));fallback();}else close();}catch(e){setError(nativeErrorText(e));}}
  async function choose(target:Media){
    if(navigation.current)return;navigation.current=true;setQueueBusy(true);
    try{await stop();if(alive.current)options.current.playNext(target);}
    catch(e){if(alive.current)setError(errorText(e));}
    finally{navigation.current=false;if(alive.current)setQueueBusy(false);}
  }
  async function independentAction(action:string){
    try{if(session.current)await window.avhubDesktop!.nativePlayer(action,action==='screenshot'?{session:session.current}:session.current);}
    catch(e){setError(nativeErrorText(e));}
  }
  async function retryNative(){
    if(retrying.current||navigation.current)return;retrying.current=true;setRetryBusy(true);
    let scheduled=false;
    try{await stop();if(alive.current){const next=++retryAttempt.current.sequence;retryAttempt.current.pending=next;setAttachedSession(null);setAttempt(next);scheduled=true;}}
    catch(e){if(alive.current)setError(nativeErrorText(e));}
    finally{if(!scheduled){retryAttempt.current.pending=null;retrying.current=false;if(alive.current)setRetryBusy(false);}}
  }
  async function resolveRecovery(discard:boolean){
    if(recoveryBusy||!session.current)return;setRecoveryBusy(true);
    try{
      if(discard&&!await confirmInApp('放弃未保存的播放记录？','仅放弃本次尚未保存的进度或设置。','不会删除视频或清除已有记录。','放弃并关闭',true))return;
      await window.avhubDesktop!.nativePlayer(discard?'discard-close':'close',session.current);
    }catch(e){if(alive.current)setError(nativeErrorText(e));}
    finally{if(alive.current)setRecoveryBusy(false);}
  }
  return <div className={`player-shell native-embedded-page${windowMode.purePlayback?' is-pure-playback':''}${windowMode.fullScreen?' native-embedded-fullscreen':''}`}>
    <div className="player-top"><Button icon="arrowLeft" disabled={retryBusy} onClick={()=>void back()}>返回媒体库</Button><span>{media.title}</span><ThemeToggle/>
      <Button icon="favorite" disabled={favoriteBusy} aria-pressed={Boolean(media.favorite)} onClick={()=>void changeFavorite(media)}>{media.favorite?'已收藏':'收藏'}</Button>
      <MediaActions media={media} update={update} notify={notify}/></div>
    <div className={`video-wrap native-embedded-viewport${independent?' native-independent-card':''}`} ref={viewport} aria-label="MPV 原生播放区域">
      {independent&&attachedSession&&<section className="native-embedded-placeholder"><Icon name={independentStopped?'info':nativeFailure?'warning':'play'} size={36}/><h2>{independentStopped?'播放窗口已关闭':nativeFailure?'原生播放失败':'正在独立窗口播放'}</h2>
        {independentStopped?<><p>{recovery==='save'?'播放记录尚未保存，可重试或明确放弃本次未保存内容。':'正在确认退出并清理播放会话。'}</p>{recovery&&<div><Button icon="refresh" busy={recoveryBusy} onClick={()=>void resolveRecovery(false)}>{recovery==='save'?'重试保存并关闭':'重试清理'}</Button>{recovery==='save'&&<> <Button disabled={recoveryBusy} onClick={()=>void resolveRecovery(true)}>放弃未保存进度</Button></>}</div>}</>:nativeFailure?<p>查看下方原因后，可重试同一原文件；不会自动静音、转码或切换引擎。</p>:<><p>原文件原画播放 · 进度与连播由 AVHub 管理</p>{independentProgress&&<p>{independentProgress.paused?'已暂停':'播放中'} · {duration(independentProgress.position)} / {duration(independentProgress.length)}</p>}<p>空格暂停 · ← / → 跳转 · C 截图 · F 全屏</p><div><Button icon="play" onClick={()=>void independentAction('show')}>恢复播放窗口</Button> <Button icon="camera" onClick={()=>void independentAction('screenshot')}>保存截图</Button></div></>}
      </section>}
      {!attachedSession&&<section className="native-embedded-placeholder" aria-label="MPV 原生播放"><Icon name="play" size={36}/>
        {start===null?<><p>接着上次进度观看，还是从头开始？</p><Button onClick={()=>setStart(media.progress)}>继续观看</Button> <Button onClick={()=>setStart(0)}>从头播放</Button></>:<p role="status">{state}</p>}
        {error&&<StatusMessage kind="error">{error}</StatusMessage>}
        {start!==null&&!session.current&&(state==='原生播放已关闭'||error)&&<Button icon="refresh" busy={retryBusy} onClick={()=>void retryNative()}>重新播放</Button>}
      </section>}
    </div>
    <div className="native-embedded-caption"><span>{state}</span><div className="native-caption-actions">{attachedSession&&nativeFailure&&!independentStopped&&<Button icon="refresh" busy={retryBusy} onClick={()=>void retryNative()}>重试原生播放</Button>}<Button icon="play" disabled={retryBusy} onClick={()=>void back(true)}>切换现有播放器</Button></div></div>
    {attachedSession&&error&&<StatusMessage kind="error">{error}</StatusMessage>}
    {attachedSession&&saveError&&saveError!==error&&<StatusMessage kind="error">{saveError}</StatusMessage>}
    <PlaybackQueue media={media} queue={queue} busy={queueBusy} play={target=>void choose(target)} siblings={siblings} setSiblings={setSiblings} reveal={queueReveal}
    mode={queue?queue.mode??'sequential':autoplay.mode} setMode={mode=>queue?changePlaylistPlayback({mode}):changeAutoplay({mode})}
    autoNext={queue?queue.autoNext??true:autoplay.enabled} setAutoNext={autoNext=>queue?changePlaylistPlayback({autoNext}):changeAutoplay({enabled:autoNext})}
    scope={autoplay.scope} setScope={scope=>changeAutoplay({scope})}/></div>;
}
