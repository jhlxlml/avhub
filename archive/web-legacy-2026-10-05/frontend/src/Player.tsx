import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type Hls from 'hls.js';
import { api, request as httpRequest, json, duration, errorText, isHtmlResponse, readJson, SERVICE_MISMATCH, type ExternalSubtitle, type Media, type MediaUpdate, type QueuePage, type PlaylistSource, type PlaybackColor } from './api';
import { MediaEditor } from './MediaEditor';
import { toWebVtt } from './subtitleTimeline';
import { MediaActions } from './MediaActions';
import { Icon } from './Icon';
import { ThemeToggle } from './AppearanceControls';
import { IconButton, Popover, StatusMessage } from './ui';
import { formatLabel, resolutionLabel } from './mediaLabels';
import { PlaybackQueue } from './PlaybackQueue';
import { changeAutoplay, useAutoplay } from './autoplay';
import { usePlaybackDiagnostics } from './usePlaybackDiagnostics';
import { usePlaybackFeedback } from './usePlaybackFeedback';
import { useSeekFrame } from './useSeekFrame';
import { usePreparationTrace, preparationLabels, type BackendPreparation } from './usePreparationTrace';
import { preference, savePreference, loadSubtitlePreference as fetchSubtitlePreference } from './preferences';
import { setWindowMode, useWindowMode } from './windowMode';
import { saveScreenshot,screenshotKey,screenshotShortcutLabel,revealScreenshot,trackScreenshot,type SavedScreenshot } from './screenshots';
import './screenshots.css';
import './playback.css';

type RemuxStats={processes:number;cache_hits:number;cache_misses:number;published:number;cancelled:number;batch_failures:number;workers:number};
type Session = { mode?: 'direct' | 'remux' | 'hls'; state: 'preparing' | 'ready' | 'failed'; token?: string; url?: string; offset: number; start?: number; complete?:boolean; delivery?:'indexed-ts'|'indexed-remux'; error?: string; reason?: string; color?:PlaybackColor; window_start?:number; window_end?:number; preparation?: BackendPreparation;remux_stats?:RemuxStats|null;prepared?:boolean };
type Quality = 'auto' | 'compat' | '1080p' | '720p' | '480p';
type Request = { start: number; force_transcode: boolean; prefer_original: boolean; skip_direct?: boolean; indexed_ts?:boolean; indexed_remux?:boolean; autoplay?: boolean; quality: Quality; audio_track_index?: number; key: number;allow_video_transcode?:boolean;allow_audio_transcode?:boolean;skip_prepared?:boolean };
type SubtitleSource = { id: string; name: string; extension: string; text: string; assConverted?: boolean };
type DragSession = { pointerId: number; startX: number; startY: number; panX: number; panY: number };
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
const PLAYBACK_SPEEDS = [.5, .75, 1, 1.25, 1.5, 2];
// Also serialize task creation across Player remounts (next video / playlist).
const playbackTasks = { creation: Promise.resolve(), retirement: Promise.resolve() };
let nextPlayerControlsHidden=false;
function loadPlaybackSpeed(): number {
  try {
    const speed = preference('playbackSpeed',1);
    if (PLAYBACK_SPEEDS.includes(speed)) return speed;
  } catch { /* Fall back to normal speed when browser storage is unavailable. */ }
  return 1;
}
type SubtitleAppearance = { size: number; color: string; background: number };
function loadAudioPreference() {
  try {
    const value = preference<{volume:number;muted:boolean}|null>('audio',null);
    if (value && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1 && typeof value.muted === 'boolean') return value as { volume: number; muted: boolean };
  } catch { /* Browser storage is optional. */ }
  return { volume: 1, muted: false };
}
const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearance = { size: 30, color: '#ffffff', background: .65 };
function loadSubtitleAppearance(): SubtitleAppearance {
  try {
    const value = preference<SubtitleAppearance|null>('subtitleAppearance',null);
    if (value && [22, 26, 30, 34, 38].includes(value.size) && ['#ffffff', '#ffe38a', '#9de7ff'].includes(value.color) && [0, .35, .65, .85].includes(value.background)) return value;
  } catch { /* Use readable defaults when browser storage is unavailable or malformed. */ }
  return DEFAULT_SUBTITLE_APPEARANCE;
}
type SubtitlePreference = { id: string; delay: number };


function decodeSubtitle(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

export function Player({ media, automatic=false, close, playNext, queue, update, favoriteBusy, changeFavorite, registerNavigationGuard, notify }: {
  media: Media; automatic?:boolean; close: () => void; playNext: (media: Media, automatic?:boolean) => void; update: (value: MediaUpdate) => void;
  queue?: PlaylistSource;
  favoriteBusy: boolean; changeFavorite: (media: Media) => Promise<void>;
  registerNavigationGuard:(guard:()=>Promise<boolean>)=>()=>void;
  notify:(message:string)=>void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const videoWrap = useRef<HTMLDivElement>(null);
  const wheelAction = useRef<(event:WheelEvent) => void>(() => {});
  useEffect(() => {
    const wrap = videoWrap.current;
    if (!wrap) return;
    const handleWheel = (event:WheelEvent) => {
      // React delegates wheel events passively; cancel scrolling here instead.
      event.preventDefault();
      wheelAction.current(event);
    };
    wrap.addEventListener('wheel', handleWheel, {passive:false});
    return () => wrap.removeEventListener('wheel', handleWheel);
  }, []);
  const [videoWrapSize, setVideoWrapSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [zoomPan, setZoomPan] = useState({ x: 0, y: 0 });
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);
  const dragSession = useRef<DragSession | null>(null);
  const suppressStageClick = useRef(false);
  const [request, setRequest] = useState<Request | null>(() =>
    !automatic && media.progress > 0 && !media.watched ? null : { start: !media.watched?media.progress:0, force_transcode: false, prefer_original: true, quality: 'auto', key: 0 });
  const [phase, setPhase] = useState<'choice' | 'preparing' | 'ready' | 'error' | 'ended'>(request ? 'preparing' : 'choice');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [closing, setClosing] = useState(false);
  const desktopQuitting = useRef(false);
  const [desktopClosing, setDesktopClosing] = useState(false);
  const [speed, setSpeed] = useState(loadPlaybackSpeed);
  const [rotation, setRotation] = useState(0);
  const [displaySize,setDisplaySize]=useState({width:0,height:0});
  const videoAspectRatio=displaySize.width && displaySize.height
    ? rotation%180?displaySize.height/displaySize.width:displaySize.width/displaySize.height : undefined;
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(() => loadAudioPreference().volume);
  const [muted, setMuted] = useState(() => loadAudioPreference().muted);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');
  const [savedScreenshot,setSavedScreenshot]=useState<SavedScreenshot|null>(null);
  const [captureId,setCaptureId]=useState('');
  const screenshotTask=useRef<Promise<boolean>|null>(null);
  useEffect(()=>{
    if(!savedScreenshot||screenshotError)return;
    const timer=window.setTimeout(()=>setSavedScreenshot(null),6000);
    return()=>window.clearTimeout(timer);
  },[savedScreenshot,screenshotError]);
  const [pipActive, setPipActive] = useState(false);
  const {purePlayback,busy:windowModeBusy}=useWindowMode();
  useEffect(()=>{
    const element=video.current;if(!element)return;
    const measure=()=>{if(element.videoWidth>0 && element.videoHeight>0)
      setDisplaySize(previous=>previous.width===element.videoWidth && previous.height===element.videoHeight
        ? previous:{width:element.videoWidth,height:element.videoHeight});};
    measure();element.addEventListener('loadedmetadata',measure);element.addEventListener('resize',measure);
    return()=>{element.removeEventListener('loadedmetadata',measure);element.removeEventListener('resize',measure);};
  },[]);
  useEffect(()=>{
    if(purePlayback && window.avhubDesktop && videoAspectRatio!==undefined)
      void setWindowMode({videoAspectRatio}).catch(e=>notify(`无法适配视频窗口：${errorText(e)}`));
  },[purePlayback,videoAspectRatio,notify]);
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(()=>!nextPlayerControlsHidden);
  const quietNext=useRef(false);
  useEffect(()=>{nextPlayerControlsHidden=false;},[]);
  const [seekHover, setSeekHover] = useState<{ time: number; x: number } | null>(null);
  const pointerFocusedRange=useRef<HTMLInputElement|null>(null);
  const [quality, setQuality] = useState<Quality>('auto');
  const [playbackMode, setPlaybackMode] = useState<'direct' | 'remux' | 'hls' | null>(null);
  const [playbackReason, setPlaybackReason] = useState('');
  const [indexedPlayback,setIndexedPlayback]=useState(false);
  const [indexedRemuxPlayback,setIndexedRemuxPlayback]=useState(false);
  const [playbackColor,setPlaybackColor]=useState<PlaybackColor|null>(null);
  const [remuxStats,setRemuxStats]=useState<RemuxStats|null>(null);
  const [preparedPlayback,setPreparedPlayback]=useState(false);
  const preparation = usePreparationTrace();
  const [audioTrack, setAudioTrack] = useState('');
  const [openSetting, setOpenSetting] = useState<'quality' | 'audio' | 'speed' | 'subtitles' | 'more' | null>(null);
  const [waitingForIndex,setWaitingForIndex]=useState(false);
  const feedback = usePlaybackFeedback(video,phase,request?.key??0,waitingForIndex);
  const [position, setDisplayedPosition] = useState(media.progress);
  const positionRef = useRef(position);
  const setPosition = useCallback((value:number) => {
    positionRef.current=value;setDisplayedPosition(value);
  },[]);
  const [seek, setSeek] = useState<number | null>(null);
  const [subtitleFiles, setSubtitleFiles] = useState<ExternalSubtitle[]>([]);
  const subtitleFileInput = useRef<HTMLInputElement>(null);
  const [uploadedSubtitle, setUploadedSubtitle] = useState<SubtitleSource | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState('');
  const [subtitleSource, setSubtitleSource] = useState<SubtitleSource | null>(null);
  const [subtitleUrl, setSubtitleUrl] = useState('');
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const metadataDirty = useRef(false);
  const metadataChanged = useCallback((dirty: boolean) => { metadataDirty.current = dirty; }, []);
  const canDiscardMetadata = () => !metadataDirty.current || window.confirm('媒体信息尚未保存，放弃更改并离开吗？');
  const [subtitleError, setSubtitleError] = useState('');
  const [subtitleLoading,setSubtitleLoading] = useState(false);
  const [subtitleAppearance, setSubtitleAppearance] = useState<SubtitleAppearance>(loadSubtitleAppearance);
  const [nextEpisode, setNextEpisode] = useState<Media | null>(null);
  const {mode:queueMode,enabled:autoNext,scope:queueScope}=useAutoplay();
  const autoplayPreferences = useRef({enabled:autoNext,mode:queueMode,scope:queueScope});
  autoplayPreferences.current={enabled:autoNext,mode:queueMode,scope:queueScope};
  function autoplayStillValid(intent:typeof autoplayPreferences.current) {
    const current=autoplayPreferences.current;
    return current.enabled && current.mode===intent.mode && current.scope===intent.scope;
  }
  const [nextCountdown, setNextCountdown] = useState(8);
  const [nextCancelled, setNextCancelled] = useState(false);
  const [nextStarting, setNextStarting] = useState(false);
  const [siblings, setSiblings] = useState<QueuePage | null>(null);
  const navigationSiblings = queue ? siblings : siblings?.requested_scope===queueScope && siblings.current_id===media.id ? siblings : null;
  const navigationBusy = useRef(false);
  const activePlayer = useRef(true);
  useEffect(() => { activePlayer.current = true; return () => { activePlayer.current = false; }; }, []);
  const [subtitlePreferenceReady, setSubtitlePreferenceReady] = useState(false);
  const subtitleRequest = useRef(0);
  const subtitleController = useRef<AbortController | null>(null);
  useEffect(()=>()=>{subtitleRequest.current++;subtitleController.current?.abort();},[]);
  const token = useRef<string | null>(null);
  const offset = useRef(0);
  const seekFrame=useSeekFrame(video,offset);
  const hls = useRef(false);
  const hlsInstance = useRef<Hls | null>(null);
  const hlsAvailableEnd = useRef(0);
  const hlsAvailableStart = useRef(0);
  const indexedTsPending = useRef(false);
  const seekRevision=useRef(0);
  const indexedTsFailed = useRef(false);
  const indexedRemuxFailed = useRef(false);
  const cacheRecoveries = useRef(0);
  const transcode = useRef(false);
  const originalFailed = useRef(false);
  const sourceChanging = useRef(request !== null);
  const queuedSeek = useRef<number | null>(null);
  const seekTimer = useRef<number | null>(null);
  const seekAutoplay = useRef(true);
  const restartSeek = useRef<(target: number) => void>(() => {});
  const diagnostics = usePlaybackDiagnostics(video, offset, request !== null);
  const played = useRef(false);
  useEffect(()=>{
    const element=video.current;if(!element)return;
    const owner=crypto.randomUUID().replaceAll('-','');
    const updateActivity=()=>{void api('/api/playback/activity',json('POST',{owner,playing:!element.paused&&!element.ended,media_id:media.id,present:true,prepared:preparedPlayback})).catch(()=>{});};
    for(const event of ['playing','pause','ended'])element.addEventListener(event,updateActivity);
    const timer=window.setInterval(updateActivity,8000);
    updateActivity();
    return()=>{
      clearInterval(timer);for(const event of ['playing','pause','ended'])element.removeEventListener(event,updateActivity);
      navigator.sendBeacon('/api/playback/activity',new Blob([JSON.stringify({owner,playing:false,media_id:media.id,present:false})],{type:'application/json'}));
    };
  },[media.id,preparedPlayback]);
  const ended = useRef(false);
  const stamp = useRef(0);
  const applied = useRef(0);

  useEffect(() => {
    const element = videoWrap.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const updateSize = () => setVideoWrapSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    updateSize();
    return () => observer.disconnect();
  }, []);
  const updateRef = useRef(update);
  const controlsTimer = useRef<number | null>(null);
  const controlsHovered = useRef(false);
  updateRef.current = update;

  const save = useCallback(async (keepalive = false) => {
    const v = video.current;
    // Opening a resume prompt or preparing a stream must never overwrite saved progress.
    if (!v || !Number.isFinite(v.currentTime) ||
        !played.current && (sourceChanging.current || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)) return;
    const total = media.duration || (Number.isFinite(v.duration) ? v.duration + offset.current : 0);
    const current = ended.current && total ? total : v.currentTime + offset.current;
    const updated_at = Math.max(Date.now(), stamp.current + 1);
    stamp.current = updated_at;
    const body = { progress: current, watched: ended.current || (total > 0 && current / total >= .92), updated_at };
    try {
      const result = await api<MediaUpdate>(`/api/media/${media.id}/progress`, { ...json('PUT', body), keepalive });
      if (updated_at >= applied.current) {
        applied.current = updated_at; updateRef.current(result);
        if(updated_at>=stamp.current)setSaveError('');
      }
    } catch (e) {
      if(updated_at>=stamp.current)setSaveError(`进度未保存：${errorText(e)}`);
      throw e;
    }
  }, [media.id, media.duration]);

  useEffect(()=>registerNavigationGuard(async()=>{
    if(navigationBusy.current)return false;
    if(!canDiscardMetadata())return false;
    navigationBusy.current=true;setClosing(true);video.current?.pause();
    try {await save();return true;}
    catch {return false;}
    finally {if(activePlayer.current){navigationBusy.current=false;setClosing(false);}}
  }),[save,registerNavigationGuard]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (!desktopQuitting.current && !video.current?.paused) void save().catch(() => {}); }, 8000);
    const leaving = () => {
      if (!desktopQuitting.current) void save(true).catch(() => {});
      if (token.current) navigator.sendBeacon(`/api/playback/${token.current}/stop`);
    };
    const hidden = () => { if (!desktopQuitting.current && document.visibilityState === 'hidden') void save(true).catch(() => {}); };
    const desktopQuit=(event:Event)=>{
      desktopQuitting.current = true; setDesktopClosing(true);
      video.current?.pause();
      if(metadataDirty.current) (event as CustomEvent<Promise<unknown>[]>).detail.push(Promise.resolve(false));
      (event as CustomEvent<Promise<unknown>[]>).detail.push(save().then(()=>true).catch(()=>false));
    };
    const cancelled = () => { desktopQuitting.current = false; setDesktopClosing(false); };
    window.addEventListener('pagehide', leaving);
    window.addEventListener('avhub-before-quit',desktopQuit);
    window.addEventListener('avhub-quit-cancelled',cancelled);
    document.addEventListener('visibilitychange', hidden);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', leaving); window.removeEventListener('avhub-before-quit',desktopQuit); window.removeEventListener('avhub-quit-cancelled',cancelled); document.removeEventListener('visibilitychange', hidden); };
  }, [save]);

  useEffect(() => {
    if (!request) return;
    const currentRequest=request;
    const requestedStart=request.start;
    let playbackStart=requestedStart;
    const v = video.current!;
    let disposed = false;
    let instance: Hls | null = null;
    let sessionToken: string | null = null;
    let heartbeat: number | undefined;
    let browserLoadTimer: number | undefined;
    const trace = preparation.begin();
    let fallbackStarted = false;
    let preparedAttached=false;
    let cacheRecoveryStarted = false;
    let heartbeatBusy = false;
    let heartbeatFailures = 0;
    const creationController = new AbortController();
    const stop = async () => {
      const value = sessionToken;
      sessionToken = null;
      if (token.current === value) token.current = null;
      if (value) await api(`/api/playback/${value}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    };
    const fail = (message: string) => {
      if (disposed || desktopQuitting.current) return;
      clearInterval(heartbeat);
      clearTimeout(browserLoadTimer);
      trace.finish(true);
      void save().catch(() => {});
      v.pause(); instance?.destroy(); void stop();
      hlsInstance.current = null;
      diagnostics.abortTiming();
      setError(message); setPhase('error');
      seekFrame.clear();
    };
    const fallback = () => {
      if (disposed || desktopQuitting.current || fallbackStarted) return;
      fallbackStarted = true;
      if(preparedAttached&&!request.skip_prepared) {
        const start=played.current?v.currentTime+offset.current:request.start;
        const autoplay=played.current?!v.paused:request.autoplay;
        void save().catch(()=>{});
        setRequest({...request,start,autoplay,skip_prepared:true,prefer_original:true,skip_direct:false,key:request.key+1});return;
      }
      if(hls.current&&!request.allow_video_transcode) {
        fail('原片及无损封装未能被当前浏览器正常解码；已停止，不会自动降低画质。可使用系统播放器，或主动确认有损兼容播放');return;
      }
      const start = played.current ? v.currentTime + offset.current : request.start;
      if (!hls.current) originalFailed.current = true;
      void save().catch(() => {});
      setRequest({ ...request, start, force_transcode: hls.current, prefer_original: false,
        skip_direct: true, key: request.key + 1 });
    };
    const recoverPendingIndex=()=>{
      if(disposed||desktopQuitting.current||indexedTsFailed.current)return;
      indexedTsFailed.current=true;
      cacheRecoveryStarted=true;
      setRequest({...currentRequest,indexed_ts:false,
        start:queuedSeek.current??v.currentTime+offset.current,
        autoplay:queuedSeek.current!==null?seekAutoplay.current:!v.paused,key:currentRequest.key+1});
    };
    const videoError = () => {
      if (!transcode.current) fallback();
      else fail('转码视频播放失败，请重试或检查文件');
    };
    const hasVideoFrameTrack = () => {
      if (v.readyState >= 2 && v.videoWidth && v.videoHeight) clearTimeout(browserLoadTimer);
      if (disposed || desktopQuitting.current || v.readyState < 2 || !media.width || !media.height || (v.videoWidth && v.videoHeight)) return;
      // Chromium can silently discard an unsupported video track (e.g. HEVC)
      // and play just its AAC audio. Neither MediaError nor play() rejects.
      // loadeddata, not loadedmetadata, distinguishes this from dimensions
      // still arriving. Do not report that audio-only source as a ready video.
      if (!transcode.current) fallback();
      else fail('未能解码视频画面，请重试或检查视频文件');
    };
    const loaded = () => {
      if (disposed) return;
      trace.finish();
      diagnostics.observeFrame();
      if (!hls.current) {
        if(Math.abs(v.currentTime-playbackStart)>.05)v.currentTime = playbackStart;
      }
      else {
        const point=Math.max(0,playbackStart-offset.current);
        if(point>v.currentTime+.05)v.currentTime=point;
        else if(request.autoplay===false&&v.buffered.length&&v.currentTime<v.buffered.start(0))v.currentTime=v.buffered.start(0)+.01;
      }
      sourceChanging.current = false;
      setPhase('ready');
      // If the browser blocks autoplay, its normal play button remains available.
      if (request.autoplay !== false && !desktopQuitting.current) void v.play().catch(e => {
        if (e instanceof DOMException && e.name === 'NotSupportedError') videoError();
        // NotAllowedError is normal autoplay policy, not codec failure.
      });
    };
    // Keep the bounded session while the player remains open. Seeking back
    // after the last frame must not fetch fragments from a deleted session.
    const finish = () => { if (!desktopQuitting.current) setPhase('ended'); };
    v.addEventListener('error', videoError);
    v.addEventListener('loadedmetadata', loaded);
    v.addEventListener('loadeddata', hasVideoFrameTrack);
    v.addEventListener('ended', finish);
    played.current = false; ended.current = false;
    hlsInstance.current = null;
    hlsAvailableEnd.current = 0;
    hlsAvailableStart.current = 0;
    indexedTsPending.current = false;
    seekRevision.current=0;
    setWaitingForIndex(false);
    diagnostics.sourceChanged();
    sourceChanging.current = true;
    setPhase('preparing'); setError(''); setPosition(request.start); setPlaybackMode(null); setPlaybackReason('');
    setPlaybackColor(null);
    setRemuxStats(null);
    setPreparedPlayback(false);
    setIndexedPlayback(false);
    setIndexedRemuxPlayback(false);

    async function start() {
      const previousCreation = playbackTasks.creation;
      let releaseCreation!: () => void;
      playbackTasks.creation = new Promise<void>(resolve => { releaseCreation = resolve; });
      try {
        // A late creation response still owns a token. Retire it before opening
        // the next task; aborting POST would lose that token and leak FFmpeg.
        await Promise.all([previousCreation, playbackTasks.retirement]);
        if (disposed) return;
        trace.advance('api');
        // Client-known ownership also retires a creation whose response timed
        // out. The backend rejects a late creation after this token is retired.
        sessionToken = crypto.randomUUID().replaceAll('-', '');
        // These containers can carry supported H.264 while the browser cannot
        // demux the original. Go straight to lossless delivery instead of
        // attaching a known unsupported file and waiting for MediaError.
        const containerType=({'.ts':'video/mp2t','.avi':'video/x-msvideo','.flv':'video/x-flv'} as Record<string,string>)[media.ext.toLowerCase()];
        const needsRemux=media.video_codec?.toLowerCase()==='h264'&&!!containerType&&!v.canPlayType(containerType);
        // Stream-copy seeks can discard video up to the next keyframe. Keep a
        // bounded decode lead-in (including common 10s GOPs), not a re-encode.
        let session = await api<Session>(`/api/media/${media.id}/playback`, { ...json('POST', { ...currentRequest,
          prefer_original:currentRequest.prefer_original&&!needsRemux,skip_direct:currentRequest.skip_direct||needsRemux,
          indexed_ts:currentRequest.indexed_ts??!indexedTsFailed.current,indexed_remux:currentRequest.indexed_remux??!indexedRemuxFailed.current,
          seek_preroll:10, client_token: sessionToken }), signal: creationController.signal });
        sessionToken = session.token || null;
        if (disposed) { await stop(); return; }
        trace.backend(session.preparation);
        playbackStart=session.start??requestedStart;
        trace.advance('stream');
        releaseCreation();
        token.current = sessionToken;
        setPlaybackMode(session.mode || 'direct');
        setIndexedPlayback(session.delivery==='indexed-ts');
        setIndexedRemuxPlayback(session.delivery==='indexed-remux');
        setPlaybackReason(session.reason || '');
        setPlaybackColor(session.color || null);
        setRemuxStats(session.remux_stats||null);
        setPreparedPlayback(Boolean(session.prepared));
        preparedAttached=Boolean(session.prepared);
        hls.current = session.mode === 'hls' || session.mode === 'remux';
        transcode.current = session.mode === 'hls';
        offset.current = session.offset;
        setSubtitleOffset(session.offset);
        const started = Date.now();
        while (sessionToken && (session.state==='preparing'||session.state==='ready'&&!session.complete&&hls.current&&
               session.window_end!==undefined&&session.window_end<playbackStart+.05)) {
          if (Date.now() - started > 95000) throw new Error('播放流准备超时，请重试');
          // Local lossless remuxes often publish their first segment in <200ms.
          // Poll briefly at startup, then back off for genuinely slow encoders.
          await new Promise(resolve => setTimeout(resolve, Date.now()-started<1000?60:200));
          if (disposed) return;
          session = await api<Session>(`/api/playback/${sessionToken}`, { signal: creationController.signal });
          if (disposed) return;
        }
        if (session.state === 'failed' && session.delivery==='indexed-ts') {
          indexedTsFailed.current=true;
          setRequest({...currentRequest,indexed_ts:false,key:currentRequest.key+1});
          return;
        }
        if(session.state==='failed'&&session.delivery==='indexed-remux') {
          indexedRemuxFailed.current=true;
          setRequest({...currentRequest,indexed_remux:false,key:currentRequest.key+1});return;
        }
        if (session.state === 'failed') throw new Error(session.error || '播放流生成失败');
        indexedTsPending.current=session.delivery==='indexed-ts'&&!session.complete;
        if (!session.url) throw new Error('未获取到可播放的视频');
        // A stale duration may place a near-end request past the actual tail.
        // A finished encoder cannot publish more data; seek its final frame.
        if(hls.current&&session.complete&&session.window_end!==undefined)
          playbackStart=Math.min(playbackStart,Math.max(session.offset,session.window_end-.1));
        trace.advance('attach');
        const watchBrowserLoad = () => {
          trace.advance('browser');
          // A valid playback API response does not imply the browser ever loads
          // metadata. Give a stalled file/MSE source an explicit, recoverable
          // error instead of an indefinite spinner; never lower quality here.
          browserLoadTimer = window.setTimeout(() => fail('浏览器载入视频超时，请重试；可展开播放信息查看耗时阶段'), 45000);
        };
        // Observe before attaching the new source: a paused stream may present
        // its only frame before loadedmetadata/loadeddata listeners run.
        diagnostics.observeFrame();
        if (hls.current) {
          const { default: HlsRuntime } = await import('hls.js');
          if (disposed) return;
          if (HlsRuntime.isSupported()) {
            instance = new HlsRuntime({ startPosition: Math.max(0,playbackStart-session.offset), autoStartLoad: true,
              backBufferLength: 30, maxBufferLength: 30, maxMaxBufferLength: 90,
              // Indexed TS is an offline EVENT timeline, not a broadcast whose
              // growing edge should move the user's playback position.
              liveSyncDuration: session.delivery==='indexed-ts'?Math.max(120,media.duration+120):120,
              xhrSetup:(xhr,url)=>{if(session.delivery==='indexed-remux') {
                if(xhr.readyState===0)xhr.open('GET',url,true);
                xhr.setRequestHeader('X-AVHub-Seek-Revision',String(seekRevision.current));
              }} });
            hlsInstance.current = instance;
            let playlistRefreshPending=false;
            instance.on(HlsRuntime.Events.LEVEL_LOADED, (_, data) => {
              if (disposed) return;
              playlistRefreshPending=false;
              const end = data.details.fragments.reduce((latest, fragment) =>
                Math.max(latest, fragment.start + fragment.duration), 0);
              hlsAvailableEnd.current = Math.max(hlsAvailableEnd.current, end);
              if (data.details.fragments.length) hlsAvailableStart.current = Math.max(hlsAvailableStart.current, data.details.fragments[0].start);
              if(session.delivery==='indexed-ts') {
                if(!data.details.live)indexedTsPending.current=false;
                // Resume as soon as the requested range is published; do not
                // wait for unrelated hours of the timeline to finish indexing.
                const target=queuedSeek.current;
                if(target!==null&&seekTimer.current===null&&target-offset.current<end) {
                  queuedSeek.current=null;
                  v.currentTime=target-offset.current;
                  setWaitingForIndex(false);
                  setPosition(target);
                  if(seekAutoplay.current)void v.play().catch(()=>{});
                }
              }
            });
            instance.on(HlsRuntime.Events.FRAG_BUFFERED, () => {
              // Paused MSE streams do not run gap recovery. Align the first
              // frame explicitly if audio/video timestamps begin just after zero.
              if (!disposed && request?.autoplay === false && !played.current && v.buffered.length && v.currentTime < v.buffered.start(0)) v.currentTime = v.buffered.start(0) + .01;
            });
            instance.on(HlsRuntime.Events.ERROR, (_, data) => {
              if(data.context?.type==='level')playlistRefreshPending=false;
              if (disposed || desktopQuitting.current || !request) return;
              if (cacheRecoveryStarted) return;
              if (data.response?.code === 410) {
                if (cacheRecoveries.current >= 1) { fail('播放分片持续不可用，请检查缓存目录后重试播放'); return; }
                cacheRecoveries.current++;
                cacheRecoveryStarted = true;
                const start = played.current ? v.currentTime + offset.current : request.start;
                // Eviction is not codec incompatibility. Reopen once at the
                // original time/quality/audio, retaining pause state. Never
                // promote a lossless remux to a lossy transcode for HTTP 410.
                setRequest({ ...request, start, prefer_original:false, skip_direct:true,
                  autoplay:sourceChanging.current ? request.autoplay !== false : !v.paused,
                  key: request.key + 1 });
                return;
              }
              if (!data.fatal) return;
              if (session.delivery==='indexed-ts' && !indexedTsFailed.current) {
                indexedTsFailed.current=true;
                setRequest({...request,start:played.current?v.currentTime+offset.current:request.start,
                  indexed_ts:false,autoplay:sourceChanging.current?request.autoplay!==false:!v.paused,key:request.key+1});
              }
              else if(session.delivery==='indexed-remux'&&!indexedRemuxFailed.current) {
                indexedRemuxFailed.current=true;
                setRequest({...request,start:played.current?v.currentTime+offset.current:request.start,
                  indexed_remux:false,autoplay:sourceChanging.current?request.autoplay!==false:!v.paused,key:request.key+1});
              }
              else if (!transcode.current) fallback();
              else fail('转码视频播放失败，请重试或检查文件');
            });
            watchBrowserLoad();
            instance.loadSource(session.url); instance.attachMedia(v);
            if(indexedTsPending.current) {
              const extendIndex=async()=>{
                try {
                  while(!disposed&&indexedTsPending.current&&sessionToken) {
                    await new Promise(resolve=>setTimeout(resolve,150));
                    if(disposed||!indexedTsPending.current||!sessionToken)return;
                    const state=await api<Session>(`/api/playback/${sessionToken}`,{signal:creationController.signal});
                    if(disposed)return;
                    if(state.state==='failed'){recoverPendingIndex();return;}
                    const level=instance?.loadLevelObj;
                    if(instance&&level&&hlsAvailableEnd.current>0&&!playlistRefreshPending&&
                        (state.complete||(state.window_end??0)>hlsAvailableEnd.current+.01)) {
                      // Refresh only the playlist through the public event API.
                      // startLoad() stops the fragment controller, cancelling
                      // in-flight bytes and resetting its next-load position.
                      playlistRefreshPending=true;
                      instance.trigger(HlsRuntime.Events.LEVEL_LOADING,{url:level.uri,level:instance.loadLevel,
                        levelInfo:level,pathwayId:level.attrs['PATHWAY-ID'],id:0,deliveryDirectives:null});
                    }
                  }
                }catch(e){if(!disposed)fail(errorText(e));}
              };
              void extendIndex();
            }
          } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
            watchBrowserLoad();
            v.src = session.url;
          } else throw new Error('当前浏览器不支持此播放方式，请使用 Edge 或 Chrome');
        } else {
          watchBrowserLoad();
          v.src = session.url;
        }
        heartbeat = window.setInterval(async () => {
          if (!sessionToken || disposed || heartbeatBusy || desktopQuitting.current) return;
          heartbeatBusy = true;
          try {
            const state = await api<Session>(`/api/playback/${sessionToken}?position=${Math.max(0, v.currentTime + offset.current)}`, { timeoutMs: 4000 });
            if (disposed) return;
            heartbeatFailures = 0;
            setRemuxStats(state.remux_stats||null);
            if (state.window_start !== undefined) hlsAvailableStart.current = Math.max(hlsAvailableStart.current, state.window_start - offset.current);
            if (state.state === 'failed') {
              if(indexedTsPending.current)recoverPendingIndex();
              else fail(state.error || '播放流生成失败');
            }
          } catch (e) { if (++heartbeatFailures >= 3) fail(errorText(e)); }
          finally { heartbeatBusy = false; }
        }, 5000);
      } catch (e) { fail(errorText(e)); }
      finally { releaseCreation(); }
    }
    void start();
    return () => {
      disposed = true;
      trace.discard();
      creationController.abort();
      clearInterval(heartbeat);
      clearTimeout(browserLoadTimer);
      v.removeEventListener('error', videoError); v.removeEventListener('loadedmetadata', loaded); v.removeEventListener('ended', finish);
      v.removeEventListener('loadeddata', hasVideoFrameTrack);
      played.current = false;
      diagnostics.cancelObservation();
      v.pause(); instance?.destroy(); v.removeAttribute('src'); v.load();
      if (hlsInstance.current === instance) hlsInstance.current = null;
      hlsAvailableEnd.current = 0;
      hlsAvailableStart.current = 0;
      indexedTsPending.current = false;
      playbackTasks.retirement = Promise.all([playbackTasks.retirement, stop()]).then(() => undefined);
    };
  }, [request, media.id, save]);

  useEffect(() => () => { if (seekTimer.current !== null) clearTimeout(seekTimer.current); }, []);

  useEffect(() => {
    const saved = loadAudioPreference();
    if (video.current) { video.current.volume = saved.volume; video.current.muted = saved.muted; }
  }, []);
  useEffect(() => {
    try { savePreference('audio', { volume, muted }); }
    catch { /* Keep playback working when persistence is disabled. */ }
  }, [volume, muted]);

  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed, phase]);
  useEffect(() => {
    try { savePreference('playbackSpeed',speed); }
    catch { /* Playback remains available if browser storage is disabled. */ }
  }, [speed]);
  useEffect(() => {
    let active = true;
    void Promise.all([api<Media>(`/api/media/${media.id}`),fetchSubtitlePreference<SubtitlePreference>(media.id)]).then(([detail,preference]) => {
      if (!active) return;
      const files = (detail.external_subtitles || []).filter(item => /\.(srt|vtt|ass|ssa)$/i.test(item.name));
      setSubtitleFiles(files);
      const validExternal = files.some(item => item.path === preference?.id);
      const validEmbedded = preference?.id.startsWith('embedded:') && media.subtitles.some(item => `embedded:${item.index}` === preference.id && TEXT_SUBTITLE_CODECS.has(item.codec.toLowerCase()));
      if (preference && (validExternal || validEmbedded)) {
        void selectSubtitle(preference.id, preference.delay, files);
      } else {
        setActiveSubtitle(''); setSubtitleSource(null); setSubtitleDelay(0);
        setSubtitlePreferenceReady(true);
      }
    }).catch(() => {
      if (active) { setSubtitleFiles([]); setSubtitleError('字幕设置暂时无法读取，请重新进入视频后重试；已保存的选择不会被清除'); }
    });
    return () => { active = false; };
  }, [media.id]);
  useEffect(() => {
    if (!subtitlePreferenceReady || activeSubtitle === 'uploaded') return;
    try { savePreference(`subtitle.${media.id}`, { id: activeSubtitle, delay: activeSubtitle ? subtitleDelay : 0 }); }
    catch { /* Subtitle playback is unaffected if local storage is disabled. */ }
  }, [activeSubtitle, media.id, subtitleDelay, subtitlePreferenceReady]);
  useEffect(() => {
    if (!subtitleSource) { setSubtitleUrl(''); return; }
    const url = URL.createObjectURL(new Blob([toWebVtt(subtitleSource.text, subtitleSource.extension, subtitleDelay, subtitleOffset)], { type: 'text/vtt;charset=utf-8' }));
    setSubtitleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [subtitleSource, subtitleDelay, subtitleOffset]);
  useEffect(() => {
    try { savePreference('subtitleAppearance',subtitleAppearance); }
    catch { /* Playback remains available if local storage is disabled. */ }
  }, [subtitleAppearance]);
  useEffect(() => {
    const current = video.current;
    if (!current) return;
    const entered = () => setPipActive(true);
    const left = () => setPipActive(false);
    current.addEventListener('enterpictureinpicture', entered);
    current.addEventListener('leavepictureinpicture', left);
    return () => {
      current.removeEventListener('enterpictureinpicture', entered);
      current.removeEventListener('leavepictureinpicture', left);
    };
  }, []);
  useEffect(()=>{
    document.documentElement.classList.toggle('controls-visible',controlsVisible);
    return()=>document.documentElement.classList.remove('controls-visible');
  },[controlsVisible]);
  useEffect(() => {
    const updateVideoFullscreen = () => setVideoFullscreen(document.fullscreenElement === videoWrap.current);
    document.addEventListener('fullscreenchange', updateVideoFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateVideoFullscreen);
  }, []);
  useEffect(() => {
    if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current);
    controlsTimer.current=null;
    // Playback events (including keyboard pause/resume and seek completion)
    // must not reveal controls. Only explicit interaction/menu focus does so.
    if(openSetting) {setControlsVisible(true);return;}
    if (controlsVisible) scheduleControlsHide(videoFullscreen || purePlayback ? 850 : 2600);
  }, [videoFullscreen, purePlayback, phase, isPlaying, openSetting,controlsVisible]);
  useEffect(() => {
    if(phase!=='ended')return;
    setNextEpisode(null);setNextCountdown(8);setNextCancelled(!autoNext);
    if(queueMode==='repeat-one'){setNextEpisode(media);return;}
    const controller=new AbortController();
    // Resolve at the actual end, not from a stale page of a searched queue.
    const url=queueMode==='random'?`/api/media/${media.id}/random?scope=${queueScope}${queue?`&playlist_id=${queue.id}`:''}`:
      queue?`/api/playlists/${queue.id}/queue?media_id=${media.id}&page_size=1`:`/api/media/${media.id}/next?scope=${queueScope}`;
    void api<{next:Media|null}>(url,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setNextEpisode(result.next);})
      .catch(e=>{if(!controller.signal.aborted)notify(`无法准备下一条：${errorText(e)}`);});
    return ()=>controller.abort();
  },[phase,media.id,queue?.id,queueScope,queueMode,autoNext]);
  useEffect(() => {
    if (desktopClosing || !autoNext || phase !== 'ended' || !nextEpisode || nextCancelled || nextStarting || nextCountdown <= 0) return;
    const timer = window.setTimeout(() => setNextCountdown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [desktopClosing, autoNext, phase, nextEpisode, nextCancelled, nextStarting, nextCountdown]);
  useEffect(() => {
    if (!desktopClosing && autoNext && phase === 'ended' && nextEpisode && nextCountdown === 0 && !nextCancelled && !nextStarting) {
      // One attempt per countdown. A failed progress save must leave the player
      // in place for an explicit retry, not create an automatic retry loop.
      setNextCancelled(true);void startNextEpisode(true);
    }
  }, [desktopClosing, autoNext, phase, nextEpisode, nextCountdown, nextCancelled,nextStarting]);
  useEffect(() => () => { if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current); }, []);

  async function back() {
    if (desktopQuitting.current || navigationBusy.current) return;
    if (!canDiscardMetadata()) return;
    navigationBusy.current = true;
    setClosing(true); video.current?.pause();
    try { await save(); if (activePlayer.current) close(); }
    catch { navigationBusy.current = false; setClosing(false); }
  }
  async function switchMedia(next: Media, automatic=false) {
    if (desktopQuitting.current || next.id === media.id || next.missing || navigationBusy.current) return;
    if (!canDiscardMetadata()) return;
    navigationBusy.current = true;
    const intent=autoplayPreferences.current;
    setNextStarting(true);
    video.current?.pause();
    try {
      await save();
      if(automatic && !autoplayStillValid(intent)){navigationBusy.current=false;setNextStarting(false);return;}
      if (activePlayer.current) playFollowing(next,automatic);
    }
    catch { navigationBusy.current = false; setNextStarting(false); }
  }
  function playFollowing(next:Media, automatic=false) {
    if (desktopQuitting.current) { navigationBusy.current = false; setNextStarting(false); return; }
    nextPlayerControlsHidden=quietNext.current;
    quietNext.current=false;
    playNext(next,automatic);
  }
  async function startNextEpisode(automatic=false) {
    if (desktopQuitting.current) return;
    if(nextEpisode?.id===media.id){
      if(navigationBusy.current)return;
      navigationBusy.current=true;setNextStarting(true);
      const intent=autoplayPreferences.current;
      try {
        await save();
        if(activePlayer.current && !desktopQuitting.current && (!automatic || autoplayStillValid(intent))){setNextCancelled(true);startAt(0);}
      }catch { /* Save error remains visible; wait for an explicit retry. */ }
      finally {navigationBusy.current=false;if(activePlayer.current)setNextStarting(false);}
    }
    else if (nextEpisode) await switchMedia(nextEpisode,automatic);
  }
  async function nextInMode() {
    if (desktopQuitting.current) return;
    if(queueMode!=='random'){if(navigationSiblings?.next)await switchMedia(navigationSiblings.next);return;}
    if(navigationBusy.current)return;
    if(!canDiscardMetadata())return;
    navigationBusy.current=true;setNextStarting(true);video.current?.pause();
    try {
      await save();
      const result=await api<{next:Media|null}>(`/api/media/${media.id}/random?scope=${queueScope}${queue?`&playlist_id=${queue.id}`:''}`);
      if(activePlayer.current){if(result.next)playFollowing(result.next);else notify('没有其他可播放的视频');}
    } catch(e){if(activePlayer.current)notify(`切换失败：${errorText(e)}`);}
    finally{if(activePlayer.current){navigationBusy.current=false;setNextStarting(false);}}
  }
  function startAt(start: number, force = transcode.current, selectedQuality = quality,
                   selectedAudio: number | null | undefined = audioTrack ? Number(audioTrack) : undefined,
                   preferOriginal = !force && selectedQuality === 'auto' && selectedAudio == null,
                   autoplay = true, resetAudioPermission = false) {
    if (desktopQuitting.current) return;
    if (seekTimer.current !== null) clearTimeout(seekTimer.current);
    seekTimer.current = null; queuedSeek.current = null;
    cacheRecoveries.current = 0;
    sourceChanging.current = true;
    void save().catch(() => {});
    if (phase === 'choice' || phase === 'ended' || phase === 'error') diagnostics.beginStartup();
    setRequest(previous => ({ start, force_transcode: force, prefer_original: preferOriginal && !originalFailed.current,
      skip_direct: originalFailed.current, quality: selectedQuality, audio_track_index: selectedAudio ?? undefined,
      autoplay,allow_video_transcode:selectedQuality!=='auto',allow_audio_transcode:selectedQuality!=='auto'||(!resetAudioPermission&&request?.allow_audio_transcode===true),
      key: (previous?.key || 0) + 1 }));
  }
  restartSeek.current = target => startAt(target, transcode.current, quality,
    audioTrack ? Number(audioTrack) : undefined, !transcode.current && quality === 'auto' && !audioTrack, seekAutoplay.current);
  function seekTo(target: number) {
    setSeek(null);
    const v = video.current!;
    if (!Number.isFinite(target)) return;
    target = Math.max(0, Math.min(Math.max(0, media.duration - .1), target));
    if (phase === 'ended') {
      ended.current = false;
      setNextCancelled(true);
      setPhase('ready');
    }
    if(!sourceChanging.current&&Math.abs(v.currentTime+offset.current-target)<.05) {
      if(seekTimer.current!==null)clearTimeout(seekTimer.current);
      seekTimer.current=null;queuedSeek.current=null;
      setWaitingForIndex(false);
      seekFrame.clear();setPosition(target);return;
    }
    seekFrame.begin(target);
    if(indexedRemuxPlayback&&token.current) {
      const revision=++seekRevision.current;
      // A user seek supersedes speculative work, not every sequential HTTP
      // fragment. The matching header also protects against out-of-order hints.
      void api(`/api/playback/${token.current}/seek`,json('POST',{position:target,revision})).catch(()=>{});
    }
    const relative = target - offset.current;
    if(indexedTsPending.current&&!sourceChanging.current&&hlsInstance.current&&relative>hlsAvailableEnd.current-.05) {
      if(queuedSeek.current===null)seekAutoplay.current=!v.paused;
      queuedSeek.current=target;
      setWaitingForIndex(true);
      diagnostics.beginSeek(target,'segments');
      v.pause();setPosition(target);
      return;
    }
    if (!sourceChanging.current && !hls.current) {
      if (Math.abs(v.currentTime + offset.current - target) < .05) return;
      diagnostics.beginSeek(target, 'original');
      v.currentTime = target; setPosition(target); return;
    }
    const resumePending=indexedTsPending.current&&queuedSeek.current!==null&&seekAutoplay.current;
    // Browser seekable ranges may lag behind an updated event playlist.
    // If FFmpeg has already published this point, let hls.js fetch
    // its segment instead of tearing down and restarting the local FFmpeg session.
    if (!sourceChanging.current && hlsInstance.current && relative >= hlsAvailableStart.current && relative <= hlsAvailableEnd.current - .05) {
      if (seekTimer.current !== null) clearTimeout(seekTimer.current);
      seekTimer.current = null; queuedSeek.current = null;
      setWaitingForIndex(false);
      diagnostics.beginSeek(target, 'segments');
      v.currentTime = relative;
      if(resumePending)void v.play().catch(()=>{});
      setPosition(target);
      return;
    }
    for (let i = 0; i < v.seekable.length; i++) {
      if (!sourceChanging.current && relative >= hlsAvailableStart.current && relative >= v.seekable.start(i) && relative <= v.seekable.end(i)) {
        if (seekTimer.current !== null) clearTimeout(seekTimer.current);
        seekTimer.current = null; queuedSeek.current = null;
        diagnostics.beginSeek(target, 'segments');
        v.currentTime = relative; setPosition(target); return;
      }
    }
    diagnostics.beginSeek(target, 'restart');
    if (queuedSeek.current === null && !sourceChanging.current) seekAutoplay.current = !v.paused;
    queuedSeek.current = target;
    setPosition(target);
    if (seekTimer.current !== null) clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => { restartSeek.current(queuedSeek.current!); }, 120);
  }
  function skip(seconds: number) {
    const current = video.current?.currentTime;
    const target = (queuedSeek.current ?? (sourceChanging.current ? positionRef.current : Number.isFinite(current) ? (current || 0) + offset.current : positionRef.current)) + seconds;
    seekTo(Math.max(0, Math.min(media.duration || Number.MAX_SAFE_INTEGER, target)));
  }
  function changeQuality(value: Quality) {
    if(value!=='auto'&&!window.confirm('这是有损兼容播放，不是原画：会重新编码视频，HDR/高位深可能变为 SDR/8-bit，低分辨率选项还会缩小画面。仅在你明确接受时使用。继续吗？')) {setOpenSetting(null);return;}
    if(value==='auto'){originalFailed.current=false;indexedTsFailed.current=false;indexedRemuxFailed.current=false;}
    setQuality(value);
    setOpenSetting(null);
    startAt(positionRef.current, value !== 'auto', value, audioTrack ? Number(audioTrack) : undefined,
      value === 'auto' && !audioTrack, !(video.current?.paused ?? true),value==='auto');
  }
  function allowAudioCompatibility() {
    if(!window.confirm('仅将不兼容的音轨转换为 AAC（音频有损），视频仍保持原编码、分辨率和色彩。继续吗？'))return;
    setQuality('auto');setRequest(previous=>({...(previous||{quality:'auto' as const,key:0}),start:positionRef.current,
      force_transcode:false,prefer_original:false,skip_direct:true,allow_video_transcode:false,allow_audio_transcode:true,key:(previous?.key||0)+1}));
  }
  function changeAudio(value: string) {
    setAudioTrack(value);
    setOpenSetting(null);
    startAt(positionRef.current, quality !== 'auto' || transcode.current, quality,
      value ? Number(value) : null, quality === 'auto' && !transcode.current && !value, !(video.current?.paused ?? true));
  }
  function takeScreenshot() {
    const current = video.current;
    if (!current || phase!=='ready' || sourceChanging.current || current.readyState < 2 || !current.videoWidth || !current.videoHeight || screenshotTask.current || desktopQuitting.current) return;
    const point=Math.max(0,current.currentTime+offset.current);
    const identity=crypto.randomUUID().replaceAll('-','');
    setScreenshotBusy(true);setScreenshotError('');setSavedScreenshot(null);setCaptureId('');
    const task=Promise.resolve().then(async()=>{try {
      const canvas = document.createElement('canvas');
      canvas.width = current.videoWidth; canvas.height = current.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前环境无法生成截图');
      // Capture the decoded frame, not the CSS zoom/rotation or player controls.
      context.drawImage(current, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('截图生成失败')), 'image/png'));
      if(activePlayer.current)setCaptureId(identity);
      const saved=await saveScreenshot(media.id,point,blob,identity);
      if(activePlayer.current)setSavedScreenshot(saved);
      return true;
    } catch (error) {if(activePlayer.current)setScreenshotError(errorText(error));return false;}
    finally {if(activePlayer.current)setScreenshotBusy(false);screenshotTask.current=null;}});
    screenshotTask.current=task;trackScreenshot(task);
  }
  async function togglePictureInPicture() {
    const current = video.current;
    if (!current || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await current.requestPictureInPicture();
    } catch { /* Browser may reject PiP while another system surface is active. */ }
  }
  function togglePlayback() {
    if (desktopQuitting.current) return;
    const current = video.current;
    if (!current || phase !== 'ready') return;
    if(indexedTsPending.current&&queuedSeek.current!==null) {
      seekAutoplay.current=!seekAutoplay.current;
      setIsPlaying(seekAutoplay.current);
      return;
    }
    if (current.paused) void current.play().catch(()=>{}); else current.pause();
  }
  function scheduleControlsHide(delay:number) {
    if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current);
    controlsTimer.current=null;
    // Pausing freezes the picture, not the UI idle timer. Hover and open
    // menus retain controls in either playback state.
    if (controlsHovered.current || phase !== 'ready' || openSetting) return;
    controlsTimer.current=window.setTimeout(()=>{
      controlsTimer.current=null;
      // Pointer entry may have cancelled a timer already queued by the host.
      if(!controlsHovered.current)setControlsVisible(false);
    },delay);
  }
  function revealControls() {
    quietNext.current=false;
    if(!controlsVisible && video.current && queuedSeek.current===null)setPosition(video.current.currentTime+offset.current);
    setControlsVisible(true);
    scheduleControlsHide(videoFullscreen || purePlayback ? 850 : 2600);
  }
  function hideControlsSoon() {
    controlsHovered.current=false;
    scheduleControlsHide(videoFullscreen || purePlayback ? 150 : 500);
  }
  function changeVolumeByWheel(event: WheelEvent) {
    if (!event.deltaY) return;
    const current = video.current;
    if (!current) return;
    current.volume = Math.max(0, Math.min(1, current.volume + (event.deltaY < 0 ? .05 : -.05)));
    if (current.volume > 0) current.muted = false;
  }
  function zoomAtPointer(event: WheelEvent) {
    if (!videoWrap.current || !event.deltaY) return;
    const bounds = videoWrap.current.getBoundingClientRect();
    const x = event.clientX - bounds.left - videoWrap.current.clientLeft;
    const y = event.clientY - bounds.top - videoWrap.current.clientTop;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? videoWrap.current.clientHeight : 1);
    const next = Math.max(1, Math.min(5, zoom * Math.exp(-delta * .002)));
    if (next <= 1.001) {
      setZoom(1);
      setZoomPan({ x: 0, y: 0 });
      return;
    }
    const sourceX = (x - zoomPan.x) / zoom;
    const sourceY = (y - zoomPan.y) / zoom;
    const width = videoWrap.current.clientWidth;
    const height = videoWrap.current.clientHeight;
    setZoomPan({
      x: Math.max(width * (1 - next), Math.min(0, x - sourceX * next)),
      y: Math.max(height * (1 - next), Math.min(0, y - sourceY * next)),
    });
    setZoom(next);
  }
  wheelAction.current = event => {
    const panel = (event.target as Element).closest<HTMLElement>('.setting-popover');
    if (panel) {
      // Scroll long settings inside the player, never chain into the page.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? panel.clientHeight : 1;
      panel.scrollTop += event.deltaY * unit;
      return;
    }
    if (phase !== 'ready') return;
    if (event.shiftKey) changeVolumeByWheel(event);
    else zoomAtPointer(event);
  };
  function resetZoom() { setZoom(1); setZoomPan({ x: 0, y: 0 }); }
  function beginVideoDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (zoom <= 1 || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    suppressStageClick.current = false;
    dragSession.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: zoomPan.x, panY: zoomPan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDraggingVideo(true);
  }
  function moveVideoDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragSession.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) suppressStageClick.current = true;
    const width = videoWrap.current?.clientWidth || 0;
    const height = videoWrap.current?.clientHeight || 0;
    setZoomPan({
      x: Math.max(width * (1 - zoom), Math.min(0, drag.panX + dx)),
      y: Math.max(height * (1 - zoom), Math.min(0, drag.panY + dy)),
    });
  }
  function endVideoDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragSession.current || dragSession.current.pointerId !== event.pointerId) return;
    dragSession.current = null;
    setIsDraggingVideo(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function updateSeekHover(event: React.MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setSeekHover({ time: ratio * (media.duration || 0), x: ratio * 100 });
  }
  async function selectSubtitle(id: string, restoreDelay = 0, availableFiles = subtitleFiles) {
    const currentRequest=++subtitleRequest.current;
    subtitleController.current?.abort();
    const controller=new AbortController(); subtitleController.current=controller;
    setSubtitleError(''); setSubtitleLoading(false);
    if (!id) { setActiveSubtitle(''); setSubtitleSource(null); setSubtitleDelay(0); setSubtitlePreferenceReady(true); return; }
    if (id === 'uploaded' && uploadedSubtitle) {
      setSubtitleDelay(0); setActiveSubtitle(id); setSubtitleSource(uploadedSubtitle); setSubtitlePreferenceReady(true); return;
    }
    if (id.startsWith('embedded:')) {
      const index = Number(id.slice('embedded:'.length));
      const track = media.subtitles.find(item => item.index === index);
      if (!track || !TEXT_SUBTITLE_CODECS.has(track.codec.toLowerCase())) {
        setSubtitleError('该内嵌字幕是图像字幕，暂不支持转换'); return;
      }
      setSubtitleLoading(true);
      try {
        const text = await httpRequest(`/media/${media.id}/subtitle/embedded?index=${encodeURIComponent(index)}`,{signal:controller.signal, timeoutMs:35000}, async response => {
        if (!response.ok) {
          let data: { detail?: string } | null = null;
          try { data = await readJson<{ detail?: string }>(response); } catch { /* Use the subtitle-specific fallback below. */ }
          throw new Error(typeof data?.detail === 'string' ? data.detail : isHtmlResponse(response) ? SERVICE_MISMATCH : `读取内嵌字幕失败（${response.status}）`);
        }
        if (isHtmlResponse(response)) throw new Error(SERVICE_MISMATCH);
        return decodeSubtitle(await response.arrayBuffer());
        });
        const trackName = [track.title, track.language, track.codec].filter(Boolean).join(' · ');
        const source: SubtitleSource = { id, name: `内嵌字幕 · ${trackName || `轨道 ${index + 1}`}`, extension: '.vtt', text };
        if(currentRequest!==subtitleRequest.current || !activePlayer.current) return;
        setSubtitleDelay(restoreDelay); setActiveSubtitle(id); setSubtitleSource(source);
        setSubtitlePreferenceReady(true);
      } catch (e) { if(currentRequest===subtitleRequest.current && activePlayer.current) setSubtitleError(errorText(e)); }
      finally {if(currentRequest===subtitleRequest.current && activePlayer.current)setSubtitleLoading(false);}
      return;
    }
    const file = availableFiles.find(item => item.path === id);
    if (!file) return;
    setSubtitleLoading(true);
    try {
      const query = new URLSearchParams({ path: file.path });
      const text = await httpRequest(`/media/${media.id}/subtitle?${query}`,{signal:controller.signal, timeoutMs:35000}, async response => {
      if (isHtmlResponse(response)) throw new Error(SERVICE_MISMATCH);
      if (!response.ok) throw new Error(response.status === 404 ? '字幕文件已不存在，请刷新媒体库后重试' : `读取字幕失败（${response.status}）`);
      return decodeSubtitle(await response.arrayBuffer());
      });
      const assConverted=/\.(ass|ssa)$/i.test(file.name);
      const source: SubtitleSource = { id, name: file.name, extension: assConverted?'.vtt':file.name.slice(file.name.lastIndexOf('.')), assConverted, text };
      if(currentRequest!==subtitleRequest.current || !activePlayer.current) return;
      setSubtitleDelay(restoreDelay); setActiveSubtitle(id); setSubtitleSource(source);
      setSubtitlePreferenceReady(true);
    } catch (e) { if(currentRequest===subtitleRequest.current && activePlayer.current) setSubtitleError(errorText(e)); }
    finally {if(currentRequest===subtitleRequest.current && activePlayer.current)setSubtitleLoading(false);}
  }
  async function importSubtitle(file?: File) {
    if (!file) return;
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.srt', '.vtt','.ass','.ssa'].includes(extension)) { setSubtitleError('当前支持 SRT、VTT、ASS 和 SSA 字幕'); return; }
    if(file.size>4*1024*1024) {setSubtitleError('字幕文件不能超过 4 MB');return;}
    const currentRequest=++subtitleRequest.current;
    subtitleController.current?.abort();
    const controller=new AbortController();subtitleController.current=controller;
    setSubtitleLoading(true);setSubtitleError('');
    try {
      let text=decodeSubtitle(await file.arrayBuffer());
      if(currentRequest!==subtitleRequest.current || !activePlayer.current) return;
      const assConverted=['.ass','.ssa'].includes(extension);
      if(assConverted) {
        text = await httpRequest('/api/subtitles/convert-ass',{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:text,signal:controller.signal}, async response => {
        if(isHtmlResponse(response)) throw new Error(SERVICE_MISMATCH);
        if(!response.ok) { const value=await readJson<{detail?:string}>(response);throw new Error(value.detail||'字幕转换失败'); }
        return decodeSubtitle(await response.arrayBuffer());
        });
      }
      if(currentRequest!==subtitleRequest.current || !activePlayer.current) return;
      const source = { id: 'uploaded', name: file.name, extension:assConverted?'.vtt':extension, text, assConverted };
      setUploadedSubtitle(source); setSubtitleDelay(0); setActiveSubtitle(source.id); setSubtitleSource(source); setSubtitleError('');
    } catch (e) { if(currentRequest===subtitleRequest.current && activePlayer.current) setSubtitleError(`无法读取字幕：${errorText(e)}`); }
    finally {if(currentRequest===subtitleRequest.current && activePlayer.current)setSubtitleLoading(false);}
  }
  function adjustSubtitleDelay(delta: number) {
    setSubtitleDelay(current => Math.max(-10, Math.min(10, Math.round((current + delta) * 10) / 10)));
  }
  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      const target = event.target;
      // Mouse focus on a player slider must not disable playback shortcuts.
      // Preserve native slider navigation for explicit keyboard/Tab focus.
      if(event.code==='Tab')pointerFocusedRange.current=null;
      const playerRange=target instanceof HTMLInputElement&&target.type==='range'&&!!target.closest('.player-controls');
      const rangePlaybackKey=playerRange&&(['Space','KeyK','KeyJ','KeyL','KeyR','KeyM','KeyF','KeyW','KeyC','KeyP','KeyN'].includes(event.code)||
        pointerFocusedRange.current===target&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code));
      if (desktopQuitting.current) return;
      if(event.defaultPrevented || event.isComposing || event.keyCode===229 || document.querySelector('[role="dialog"]')) return;
      if(openSetting) return;
      // Keep menu/dialog Escape handling first. Explicitly exit our video
      // fullscreen rather than depending on the host's native Escape handling.
      // Return immediately so this key cannot also leave pure playback.
      if(event.code==='Escape' && document.fullscreenElement===videoWrap.current &&
          !(target instanceof HTMLElement && target.closest('[role="menu"]'))) {
        event.preventDefault();void document.exitFullscreen().catch(()=>{});return;
      }
      if(event.code==='Escape' && purePlayback && !document.fullscreenElement && !openSetting &&
          !(target instanceof HTMLElement && target.closest('[role="menu"]'))) {
        event.preventDefault();void togglePurePlayback();return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || target instanceof HTMLElement &&
          (target.isContentEditable || target.closest('[role="menu"], .setting-popover') || ['INPUT','SELECT','TEXTAREA'].includes(target.tagName) && !rangePlaybackKey || target.getAttribute('type') === 'range' && !rangePlaybackKey || target.tagName === 'SUMMARY' && event.code === 'Space')) return;
      const v = video.current;
      if (!v) return;
      if (event.code === 'KeyR' && phase === 'ready') {
        event.preventDefault(); rotateVideo();
      } else if ((event.code === 'Space' || event.code === 'KeyK') && phase === 'ready') {
        event.preventDefault();
        // A mouse-clicked control keeps focus. Space belongs to playback here,
        // not to that button's default keyup click (mute/rotate/capture/etc.).
        // Prevent the default even for held keys, but toggle only once.
        if(event.repeat)return;
        togglePlayback();
      } else if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight' || event.code === 'KeyJ' || event.code === 'KeyL') && (phase === 'ready' || phase === 'preparing')) {
        event.preventDefault();
        const current = queuedSeek.current ?? (sourceChanging.current ? positionRef.current : Number.isFinite(v.currentTime) ? v.currentTime + offset.current : 0);
        const limit = media.duration || Number.MAX_SAFE_INTEGER;
        const delta = event.code === 'KeyJ' ? -10 : event.code === 'KeyL' ? 10 : event.code === 'ArrowRight' ? 5 : -5;
        seekTo(Math.max(0, Math.min(limit, current + delta)));
      } else if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        v.volume = Math.max(0, Math.min(1, v.volume + (event.code === 'ArrowUp' ? .05 : -.05)));
        if (event.code === 'ArrowUp') v.muted = false;
      } else if (event.code === 'KeyM') {
        event.preventDefault(); v.muted = !v.muted;
      } else if (event.code === 'KeyF' && phase === 'ready') {
        event.preventDefault(); toggleFullscreen();
      } else if(event.code==='KeyW' && phase==='ready') {
        event.preventDefault();void togglePurePlayback();
      } else if(screenshotKey(event) && phase==='ready') {
        event.preventDefault();if(!event.repeat)takeScreenshot();
      } else if(event.code==='KeyP' && phase==='ready') {
        event.preventDefault();void togglePictureInPicture();
      } else if(event.code==='KeyN' && phase==='ready') {
        event.preventDefault();quietNext.current=!controlsVisible;void nextInMode();
      }
    }
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [phase, media.duration,queueMode,siblings?.next?.id,screenshotBusy,pipActive,purePlayback,windowModeBusy,openSetting,controlsVisible]);
  function toggleFullscreen() {
    if (document.fullscreenElement === videoWrap.current) void document.exitFullscreen().catch(() => {});
    else void videoWrap.current?.requestFullscreen().catch(() => {});
  }
  function rotateVideo() { setRotation(value => (value + 90) % 360); }
  async function togglePurePlayback() {
    if(windowModeBusy)return;
    try {
      if(document.fullscreenElement)await document.exitFullscreen();
      await setWindowMode({purePlayback:!purePlayback,...(!purePlayback && videoAspectRatio!==undefined?{videoAspectRatio}:{})});
    } catch(e) {notify(`无法切换纯净播放：${errorText(e)}`);}
  }
  const playbackModeLabel = indexedPlayback ? 'TS 索引直读' : indexedRemuxPlayback ? '索引按需封装' : playbackMode === 'direct' ? preparedPlayback?'无损优化副本直放':'原文件直放' : playbackMode === 'remux' ? '视频无损重封装' : playbackMode === 'hls' ? '有损兼容转码（已确认）' : '正在尝试原片';
  const elapsedLabel = (milliseconds: number) => milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(2)} 秒`;
  const seekRouteLabel = diagnostics.lastSeek ? { original: '原片按需读取', segments: '已有分段复用', restart: '重新准备播放流' }[diagnostics.lastSeek.route] : '';
  const sourceColor=playbackColor?.source || media.video_color || {};
  const sourceColorLabel=[sourceColor.hdr || (sourceColor.transfer && sourceColor.transfer!=='unknown'?'SDR':'未标定'),sourceColor.bit_depth?`${sourceColor.bit_depth}-bit`:'',sourceColor.primaries,sourceColor.pix_fmt].filter(Boolean).join(' · ');
  const compactControls = videoWrapSize.width > 0 && videoWrapSize.width < 1080;
  const narrowControls = videoWrapSize.width > 0 && videoWrapSize.width < 760;
  const tinyControls = videoWrapSize.width > 0 && videoWrapSize.width < 500;
  useEffect(() => { if (!compactControls && openSetting === 'more') setOpenSetting(null); }, [compactControls, openSetting]);
  const pictureActions = <>
          <button aria-label={`旋转视频，当前 ${rotation} 度`} title={`旋转 90° (R) · 当前 ${rotation}°`}
            disabled={phase !== 'ready'} onClick={rotateVideo}><Icon name="rotate" size={19} /></button>
          {(!compactControls || zoom === 1) && <button aria-label="还原画面缩放" title={`还原缩放${zoom > 1 ? `（${Math.round(zoom * 100)}%）` : ''}`} disabled={phase !== 'ready' || zoom === 1}
            onClick={resetZoom}><Icon name="zoomReset" size={19} /></button>}
          <button aria-label="保存视频截图" title={`一键保存 PNG（${screenshotShortcutLabel()}，不含字幕与控件）`} disabled={phase !== 'ready' || screenshotBusy} onClick={takeScreenshot}><Icon name={screenshotBusy?'refresh':'camera'} className={screenshotBusy?'is-spinning':undefined} size={19} /></button>
  </>;
  const navigationActions = <>
            {purePlayback && <button aria-label="返回媒体库" title="保存进度并返回媒体库" disabled={closing || nextStarting} onClick={()=>void back()}><Icon name="arrowLeft" size={19}/></button>}
            <button aria-label="播放上一条" title={queue ? '播放列表上一条' : navigationSiblings?.scope==='series'?'同剧集上一集':'同目录上一条'} disabled={nextStarting || closing || phase !== 'ready' || !navigationSiblings?.previous}
              onClick={() => { if (navigationSiblings?.previous) void switchMedia(navigationSiblings.previous); }}><Icon name="previous" size={19} /></button>
            <button aria-label="播放下一条" title={queueMode==='random'?'随机下一条 (N)':queue ? '播放列表下一条 (N)' : navigationSiblings?.scope==='series'?'同剧集下一集 (N)':'同目录下一条 (N)'} disabled={nextStarting || closing || phase !== 'ready' || (queueMode==='random'?(navigationSiblings?.playable_count??navigationSiblings?.total??0)<2:!navigationSiblings?.next)}
              onClick={() => void nextInMode()}><Icon name="next" size={19} /></button>
  </>;
  const subtitlePanel = (
      <section className="subtitle-tools" aria-label="字幕设置">
        <div className="subtitle-heading"><h3><Icon name="subtitles" size={16}/>字幕</h3><span>{activeSubtitle ? subtitleSource?.name : '关闭'}</span>{openSetting === 'subtitles' && <IconButton icon="close" label="关闭字幕设置" className="popover-close" onClick={() => setOpenSetting(null)}/>}</div>
        <div className="subtitle-actions">
          <label className="subtitle-select-label">字幕轨道<select aria-label="字幕轨道" value={activeSubtitle} onChange={e => void selectSubtitle(e.target.value)}>
            <option value="">关闭字幕</option>
            {media.subtitles.map(track => {
              const id = `embedded:${track.index}`;
              const textTrack = TEXT_SUBTITLE_CODECS.has(track.codec.toLowerCase());
              const label = [track.title, track.language, track.codec].filter(Boolean).join(' · ') || `轨道 ${track.index + 1}`;
              return <option key={id} value={id} disabled={!textTrack}>内嵌 · {label}{textTrack ? '' : '（图像字幕暂不支持）'}</option>;
            })}
            {subtitleFiles.map(file => <option key={file.path} value={file.path}>{file.name}</option>)}
            {uploadedSubtitle && <option value="uploaded">本地文件：{uploadedSubtitle.name}</option>}
          </select></label>
          <button type="button" className="upload subtitle-upload ui-button" onClick={() => subtitleFileInput.current?.click()}><Icon name="upload" size={15}/>加载字幕</button><input ref={subtitleFileInput} style={{display:'none'}} type="file" accept=".vtt,.srt,.ass,.ssa" aria-label="加载外挂字幕" onChange={e => {
            void importSubtitle(e.currentTarget.files?.[0]); e.currentTarget.value = '';
          }} />
          <div className="subtitle-delay" aria-label="字幕延迟调整">
            <span>延迟</span><button aria-label="字幕延迟减少 0.1 秒" disabled={!activeSubtitle || subtitleDelay <= -10} onClick={() => adjustSubtitleDelay(-.1)}>−</button>
            <output aria-label="当前字幕延迟">{subtitleDelay > 0 ? '+' : ''}{subtitleDelay.toFixed(1)} 秒</output>
            <button aria-label="字幕延迟增加 0.1 秒" disabled={!activeSubtitle || subtitleDelay >= 10} onClick={() => adjustSubtitleDelay(.1)}>+</button>
            <button className="subtitle-reset" aria-label="重置字幕延迟" disabled={!activeSubtitle || subtitleDelay === 0} onClick={() => setSubtitleDelay(0)}>重置</button>
          </div>
          <div className="subtitle-appearance" aria-label="字幕外观">
            <label>字号<select aria-label="字幕字号" value={subtitleAppearance.size} onChange={event => setSubtitleAppearance(value => ({ ...value, size: Number(event.target.value) }))}>
              {[22, 26, 30, 34, 38].map(size => <option key={size} value={size}>{size}px</option>)}
            </select></label>
            <label>文字<select aria-label="字幕文字颜色" value={subtitleAppearance.color} onChange={event => setSubtitleAppearance(value => ({ ...value, color: event.target.value }))}>
              <option value="#ffffff">白色</option><option value="#ffe38a">暖黄</option><option value="#9de7ff">浅蓝</option>
            </select></label>
            <label className="subtitle-background">底色<input aria-label="字幕背景透明度" type="range" min="0" max="3" step="1" value={[0, .35, .65, .85].indexOf(subtitleAppearance.background)} onChange={event => setSubtitleAppearance(value => ({ ...value, background: [0, .35, .65, .85][Number(event.target.value)] }))} /></label>
          </div>
        </div>
        {subtitleError && <StatusMessage className="subtitle-error" kind="error">{subtitleError}</StatusMessage>}
        {subtitleLoading && <StatusMessage kind="loading">正在准备字幕… <button onClick={()=>void selectSubtitle('')}>取消字幕加载</button></StatusMessage>}
        {subtitleSource?.assConverted && <small className="subtitle-hint">ASS/SSA 已转为文本字幕；高级定位、字体、动画和卡拉 OK 特效不保留，不会转码视频。</small>}
        {subtitleFiles.length === 0 && !uploadedSubtitle && media.subtitles.length === 0 && <small className="subtitle-hint">可选择同目录的 SRT/VTT/ASS/SSA 字幕，或加载本地字幕；支持 UTF-8 与常见简体中文编码。</small>}
      </section>
  );
  return <div className={`player-shell${purePlayback?' is-pure-playback':''}`}>
    <div className="player-top"><button className="ui-button" onClick={() => void back()} disabled={closing || nextStarting}><Icon name="arrowLeft"/>{closing ? '正在保存…' : nextStarting ? '正在切换…' : '返回媒体库'}</button>
      <span>{media.title}</span>
      <ThemeToggle/>
      <button className="ui-button favorite-action" onClick={() => void changeFavorite(media)} disabled={favoriteBusy} aria-pressed={Boolean(media.favorite)}
        aria-label={favoriteBusy ? '正在保存收藏' : media.favorite ? '★ 已收藏' : '☆ 收藏'}>
        <Icon name="favorite" size={17} filled={Boolean(media.favorite)}/>{favoriteBusy ? '正在保存…' : media.favorite ? '已收藏' : '收藏'}</button>
      <MediaActions media={media} update={update} notify={notify} pauseForPreparation={()=>video.current?.pause()} playPrepared={()=>{
        originalFailed.current=false;setQuality('auto');startAt(positionRef.current,false,'auto',audioTrack?Number(audioTrack):undefined,!audioTrack,true);
      }}/></div>
    {saveError && <div className="notice" role="alert">{saveError} <button onClick={() => void save().catch(() => {})}>重试保存</button><button onClick={close}>直接返回</button></div>}
    <div className={`video-wrap${controlsVisible ? '' : ' controls-hidden'}`} ref={videoWrap}
      style={{ '--player-height': `${videoWrapSize.height}px` } as CSSProperties}
      onMouseMove={revealControls} onMouseLeave={hideControlsSoon}
      onPointerDownCapture={event=>{revealControls();const target=event.target;pointerFocusedRange.current=target instanceof HTMLInputElement&&target.type==='range'?target:null;}}
      onFocusCapture={event=>{if((event.target as HTMLElement).matches(':focus-visible'))revealControls();}}
      onClick={event => { if (suppressStageClick.current) { suppressStageClick.current = false; event.preventDefault(); return; } const target = event.target as HTMLElement; if (target === video.current || target === videoWrap.current || target.closest('.video-canvas')) togglePlayback(); }}
      onDoubleClick={event => { if (suppressStageClick.current) { suppressStageClick.current = false; event.preventDefault(); return; } const target = event.target as HTMLElement; if ((target === video.current || target === videoWrap.current || target.closest('.video-canvas')) && phase === 'ready') toggleFullscreen(); }}>
      <div className={`video-canvas${zoom > 1 ? ' is-zoomed' : ''}${isDraggingVideo ? ' is-dragging' : ''}`}
        onPointerDown={beginVideoDrag} onPointerMove={moveVideoDrag} onPointerUp={endVideoDrag} onPointerCancel={endVideoDrag}
        style={{ transform: `translate(${zoomPan.x}px, ${zoomPan.y}px) scale(${zoom})` }}>
      <video ref={video} className={rotation % 180 ? 'video-rotated-quarter' : undefined}
        style={{ transform: `translate(-50%, -50%) rotate(${rotation}deg)`, ...(rotation % 180 && videoWrapSize.width && videoWrapSize.height ? {
          width: `${videoWrapSize.height}px`, height: `${videoWrapSize.width}px`, maxWidth: 'none', maxHeight: 'none',
        } : {}) }} playsInline preload="auto"
        onPlaying={() => { played.current = true; ended.current = false; setIsPlaying(true); }}
        onLoadedData={() => { if (request?.autoplay === false && !sourceChanging.current) { played.current = true; setPosition(video.current!.currentTime + offset.current); void save().catch(() => {}); } }}
        onVolumeChange={() => { if (video.current) { setVolume(video.current.volume); setMuted(video.current.muted); } }}
        onTimeUpdate={() => { if (played.current && queuedSeek.current === null && video.current) {
          positionRef.current=video.current.currentTime+offset.current;
          if(controlsVisible)setDisplayedPosition(positionRef.current);
        } }}
        onPause={() => { if(video.current&&queuedSeek.current===null)setPosition(video.current.currentTime+offset.current);setIsPlaying(indexedTsPending.current&&queuedSeek.current!==null?seekAutoplay.current:false); if (!desktopQuitting.current) void save().catch(() => {}); }}
        onSeeked={() => { if (!desktopQuitting.current) void save().catch(() => {}); }}
        onEnded={() => { ended.current = true; void save().catch(() => {}); }}>
        {subtitleUrl && <track key={subtitleUrl} kind="subtitles" src={subtitleUrl} default />}
      </video>
      <canvas ref={seekFrame.canvas} className="seek-frame" hidden aria-hidden="true"
        style={{transform:`translate(-50%, -50%) rotate(${rotation}deg)`,...(rotation%180&&videoWrapSize.width&&videoWrapSize.height?{
          width:`${videoWrapSize.height}px`,height:`${videoWrapSize.width}px`,maxWidth:'none',maxHeight:'none',
        }:{})}} />
      <style>{`.video-wrap video::cue { font-size: ${subtitleAppearance.size}px; color: ${subtitleAppearance.color}; background-color: rgba(0,0,0,${subtitleAppearance.background}); text-shadow: 0 1px 3px #000, 1px 0 3px #000, -1px 0 3px #000; }`}</style>
      </div>
      {phase === 'choice' && <div className="resume"><b>继续上次观看？</b><span>上次看到 {duration(media.progress)}</span>
        <button onClick={() => startAt(media.progress, false, 'auto', undefined, true)}>继续播放</button><button className="ghost" onClick={() => startAt(0, false, 'auto', undefined, true)}>从头开始</button></div>}
      {feedback.preparing && <div className="resume" role="status"><b>正在准备播放…</b><span>{quality==='auto'?'原片直放或无损封装，不自动降低画质':'正在按已确认的有损兼容模式准备'}</span></div>}
      {feedback.buffering && <div className="buffering" role="status"><i />正在缓冲…</div>}
      {phase === 'error' && <div className="resume" role="alert"><b>暂时无法播放</b><span>{error}</span><button onClick={() => startAt(positionRef.current)}>重试播放</button>
        <button className="ghost" onClick={()=>changeQuality('compat')}>兼容播放（有损，需确认）</button>
        {media.video_codec==='h264'&&<button className="ghost" onClick={allowAudioCompatibility}>仅兼容音轨（视频原画）</button>}</div>}
      {phase === 'ended' && <div className="resume"><b>{nextEpisode ? (queue || media.kind!=='episode' ? '本条播放结束' : '本集播放结束') : '播放结束'}</b>
        {nextEpisode && <><span>{nextEpisode.id===media.id?'单条循环：':queueMode==='random'?'随机下一条：':queue ? '播放列表下一条：' : queueScope==='series'&&media.kind==='episode'?'下一集：':'下一条：'}{nextEpisode.title}{nextEpisode.season ? ` · 第 ${nextEpisode.season} 季` : ''}{nextEpisode.episode ? ` 第 ${nextEpisode.episode} 集` : ''}</span>
          <span>{nextStarting ? '正在切换…' : !autoNext?'自动连播已关闭':nextCancelled ? '自动连播已取消' : `${nextCountdown} 秒后自动播放`}</span>
          <button disabled={nextStarting} onClick={() => void startNextEpisode()}>{nextEpisode.id===media.id?'立即重新播放':!queue && queueMode==='sequential' && queueScope==='series' && media.kind==='episode'?'立即播放下一集':'立即播放下一条'}</button>
          {!nextCancelled && <button className="ghost" disabled={nextStarting} onClick={() => setNextCancelled(true)}>取消自动播放</button>}
        </>}
        <button className="ghost" onClick={() => startAt(0)}>重新播放</button><button className="ghost" onClick={() => void back()}>返回媒体库</button></div>}
      {(screenshotBusy||savedScreenshot||screenshotError)&&<div className={`screenshot-toast${screenshotError?' is-error':''}`} role={screenshotError?'alert':'status'} aria-label="截图反馈">
        <Icon name={screenshotError?'warning':screenshotBusy?'camera':'check'} size={18}/><div>
          <strong>{screenshotError|| (screenshotBusy?'正在保存截图…':`截图已保存 · ${savedScreenshot!.width} × ${savedScreenshot!.height}`)}</strong>
          {savedScreenshot&&<small title={savedScreenshot.path}>{savedScreenshot.filename}</small>}
          <div className="screenshot-toast-actions">
            {savedScreenshot&&<button onClick={()=>void (window.avhubDesktop?revealScreenshot(savedScreenshot.id):navigator.clipboard.writeText(savedScreenshot.directory)).catch(error=>setScreenshotError(errorText(error)))}>{window.avhubDesktop?'在文件夹中显示':'复制保存目录'}</button>}
            {screenshotError&&captureId&&!savedScreenshot&&<button onClick={()=>void api<SavedScreenshot>(`/api/screenshots/${captureId}`).then(saved=>{setScreenshotError('');setSavedScreenshot(saved);}).catch(error=>setScreenshotError(errorText(error)))}>检查保存结果</button>}
          </div></div>
        {!screenshotBusy&&<button aria-label="关闭截图提示" onClick={()=>{setScreenshotError('');setSavedScreenshot(null);}}><Icon name="close" size={15}/></button>}
      </div>}
      <div className={`timeline player-controls${narrowControls ? ' is-narrow' : ''}`} aria-label="播放控制"
        onPointerEnter={event=>{if(event.pointerType==='mouse'){controlsHovered.current=true;revealControls();}}}
        onPointerLeave={event=>{if(event.pointerType==='mouse'){controlsHovered.current=false;revealControls();}}}>
        <div className="player-progress-row">
          <span>{duration(seek ?? position)}</span>
          <div className="seek-control" style={{'--seek-progress': `${Math.min(100,Math.max(0,(seek ?? position)/Math.max(.1,media.duration-.1)*100))}%`} as CSSProperties} onMouseMove={updateSeekHover} onMouseLeave={() => setSeekHover(null)}>
            {seekHover && <span className="seek-preview" style={{ left: `${seekHover.x}%` }}>{duration(seekHover.time)}</span>}
            <input aria-label="视频完整进度" type="range" min={0} max={Math.max(0, media.duration - .1)} step={.1} value={seek ?? position}
              disabled={phase !== 'ready' && phase !== 'preparing'} onChange={e => setSeek(Number(e.target.value))}
              onPointerUp={e => seekTo(Number(e.currentTarget.value))} onKeyUp={e => {
                // A pointer-focused arrow was handled on keydown as a playback
                // seek. Do not commit the controlled slider again on keyup.
                if(pointerFocusedRange.current===e.currentTarget&&['ArrowLeft','ArrowRight'].includes(e.key))return;
                if (['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(e.key)) seekTo(Number(e.currentTarget.value));
              }} />
          </div>
          <span>{duration(media.duration)}</span>
        </div>
        <div className="player-control-row">
          <div className="player-main-controls">
          <button className="play-toggle" aria-label={isPlaying ? '暂停' : '播放'} title={isPlaying ? '暂停 (K)' : '播放 (K)'} disabled={phase !== 'ready'} onClick={togglePlayback}><Icon name={isPlaying ? 'pause' : 'play'} size={20} /></button>
          <button aria-label="快退 10 秒" title="后退 10 秒 (J)" disabled={phase !== 'ready' && phase !== 'preparing'} onClick={() => skip(-10)}><Icon name="back" size={20} /></button>
          <button aria-label="快进 10 秒" title="前进 10 秒 (L)" disabled={phase !== 'ready' && phase !== 'preparing'} onClick={() => skip(10)}><Icon name="forward" size={20} /></button>
          <button aria-label={muted ? '取消静音' : '静音'} disabled={phase !== 'ready'} onClick={() => { if (video.current) video.current.muted = !video.current.muted; }}>
            <Icon name={muted || volume === 0 ? 'muted' : 'volume'} size={20} />
          </button>
          <input className="volume-slider" aria-label="音量" type="range" min={0} max={1} step={.05} value={muted ? 0 : volume}
            disabled={phase !== 'ready'} onChange={e => { if (video.current) { video.current.volume = Number(e.target.value); video.current.muted = false; } }} />
          {!compactControls && pictureActions}
          {compactControls && zoom > 1 && <button aria-label="还原画面缩放" title="还原缩放" disabled={phase !== 'ready'} onClick={resetZoom}><Icon name="zoomReset" size={19}/></button>}
          </div>
          <div className="player-settings">
            <div className="player-setting">
              <button aria-label="画质" title={quality === 'auto' ? `播放：原片优先 · ${playbackModeLabel}` : `画质：${quality}`} aria-expanded={openSetting === 'quality'} onClick={() => setOpenSetting(openSetting === 'quality' ? null : 'quality')}>
                <Icon name="quality" size={19} /><small>{quality === 'auto'
                  ? playbackMode === 'direct' ? '原画' : playbackMode === 'remux' ? '封装' : playbackMode === 'hls' ? '转码' : '优先'
                  : quality}</small>
              </button>
              {openSetting === 'quality' && <Popover label="画质设置" close={() => setOpenSetting(null)}><label>画质<select aria-label="画质" value={quality} disabled={phase !== 'ready'} onChange={e => changeQuality(e.target.value as Quality)}>
                <option value="auto">原画（不自动转码）</option><option value="compat">兼容原分辨率（有损）</option><option value="1080p">1080p（有损）</option><option value="720p">720p（有损）</option><option value="480p">480p（有损）</option>
              </select></label></Popover>}
            </div>
            {media.audio_tracks.length > 1 && <div className="player-setting">
              <button aria-label="音轨" title="音轨" aria-expanded={openSetting === 'audio'} onClick={() => setOpenSetting(openSetting === 'audio' ? null : 'audio')}><Icon name="audio" size={19} /><small>音轨</small></button>
              {openSetting === 'audio' && <Popover label="音轨设置" close={() => setOpenSetting(null)}><label>音轨<select aria-label="音轨" value={audioTrack} disabled={phase !== 'ready'} onChange={e => changeAudio(e.target.value)}>
                <option value="">默认音轨</option>{media.audio_tracks.map((track, index) => <option key={`${track.index}-${index}`} value={track.index}>
                  {[track.title, track.language, track.codec].filter(Boolean).join(' · ') || `音轨 ${index + 1}`}</option>)}
              </select></label></Popover>}
            </div>}
            <div className="player-setting">
              <button aria-label="倍速" title={`倍速：${speed}×`} aria-expanded={openSetting === 'speed'} onClick={() => setOpenSetting(openSetting === 'speed' ? null : 'speed')}>
                <Icon name="speed" size={19} /><small>{speed}×</small>
              </button>
              {openSetting === 'speed' && <Popover label="倍速设置" close={() => setOpenSetting(null)}><label>倍速<select aria-label="倍速" value={speed} onChange={e => { setSpeed(Number(e.target.value)); setOpenSetting(null); }}>
                {[.5,.75,1,1.25,1.5,2].map(x => <option key={x} value={x}>{x}×</option>)}
              </select></label></Popover>}
            </div>
            <div className="player-setting">
              <button aria-label="字幕" title="字幕与外观" aria-expanded={openSetting === 'subtitles'} aria-pressed={Boolean(activeSubtitle)} onClick={() => setOpenSetting(openSetting === 'subtitles' ? null : 'subtitles')}><Icon name="subtitles" size={19}/><small>{activeSubtitle ? '已开启' : '字幕'}</small></button>
              {openSetting === 'subtitles' && <Popover label="字幕设置弹层" className="subtitle-popover" close={() => setOpenSetting(null)}>
                {subtitlePanel}
              </Popover>}
            </div>
            {compactControls && <div className="player-setting">
              <button aria-label="更多播放工具" title="更多播放工具" aria-expanded={openSetting === 'more'} onClick={() => setOpenSetting(openSetting === 'more' ? null : 'more')}><Icon name="more" size={19}/><small>更多</small></button>
              {openSetting === 'more' && <Popover label="更多播放工具" className="player-tools-popover" close={() => setOpenSetting(null)}>{pictureActions}{tinyControls && navigationActions}</Popover>}
            </div>}
          </div>
          <div className="player-end-actions">
            {!tinyControls && navigationActions}
            <button aria-label={purePlayback?'退出纯净播放':'纯净播放'} title={purePlayback?'退出纯净播放 (W / Esc)':window.avhubDesktop?'纯净播放：窗口适配视频比例 (W)':'纯净播放：视频铺满当前页面 (W)'} aria-pressed={purePlayback}
              disabled={windowModeBusy || !purePlayback && phase!=='ready'} onClick={()=>void togglePurePlayback()}><Icon name={purePlayback?'exitPurePlayback':'purePlayback'} size={20}/></button>
            <button aria-label={pipActive ? '退出画中画' : '画中画'} disabled={phase !== 'ready' || !document.pictureInPictureEnabled}
              title={pipActive ? '退出画中画' : '画中画'} onClick={() => void togglePictureInPicture()}><Icon name={pipActive ? 'exitPip' : 'pip'} size={19} /></button>
            <button aria-label={videoFullscreen?'退出视频全屏':'全屏'} title={videoFullscreen?'退出视频全屏 (F / Esc)':'视频全屏 (F)'} aria-pressed={videoFullscreen} disabled={phase !== 'ready'} onClick={toggleFullscreen}><Icon name={videoFullscreen?'fullscreenExit':'fullscreen'} size={20} /></button>
          </div>
        </div>
      </div>
    </div>
    <PlaybackQueue media={media} queue={queue} busy={nextStarting || closing || phase === 'preparing'}
      siblings={siblings} setSiblings={setSiblings} play={item => void switchMedia(item)} mode={queueMode} setMode={mode=>changeAutoplay({mode})} autoNext={autoNext} setAutoNext={enabled=>changeAutoplay({enabled})} scope={queueScope} setScope={scope=>changeAutoplay({scope})}/>
    <aside className="player-info"><h2>{media.title}</h2><p>{formatLabel(media.ext)} · {duration(media.duration)} · {resolutionLabel(media.width, media.height)}</p>
      <details className="shortcut-help"><summary><Icon name="info" size={16}/>快捷键帮助</summary><p>空格 / K：播放暂停 · J / L：±10 秒 · ← / →：±5 秒 · ↑ / ↓：音量 · M：静音 · F：视频全屏 · W：纯净播放 · Esc：退出纯净播放（视频全屏时先退出全屏） · P：画中画 · {screenshotShortcutLabel()}：截图 · N：下一条 · R：旋转 · 滚轮：按指针缩放（Shift+滚轮调音量）</p><small>输入文字或选择菜单时不触发播放快捷键；桌面端纯净播放时，顶部区域可拖动窗口，窗口置顶可独立开关。</small></details>
      <details className="playback-diagnostics">
        <summary><Icon name="quality" size={16}/>播放信息 · {phase === 'choice' ? '待播放' : playbackModeLabel}</summary>
        <p>{playbackReason || '优先交由浏览器解码原文件，不兼容时仅尝试无损封装；有损兼容播放必须主动确认。'}</p>
        <dl>
          <div><dt>源视频编码</dt><dd>{media.video_codec || '未知'}</dd></div>
          <div><dt>源视频色彩</dt><dd><output aria-label="源视频色彩">{sourceColorLabel}</output></dd></div>
          <div><dt>播放色彩策略</dt><dd><output aria-label="播放色彩策略">{playbackColor?.label||'待播放'}</output></dd></div>
          <div><dt>实际解码分辨率</dt><dd><output aria-label="实际解码分辨率">{diagnostics.decodedSize.width ? `${diagnostics.decodedSize.width}×${diagnostics.decodedSize.height}` : '等待画面'}</output></dd></div>
          {indexedRemuxPlayback&&remuxStats&&<div><dt>分片供给</dt><dd><output aria-label="分片供给统计">封装 {remuxStats.processes} 次 · 命中缓存 {remuxStats.cache_hits} 次 · 已供给 {remuxStats.published} 片{remuxStats.batch_failures?' · 已回退单片模式':''}</output></dd></div>}
          <div><dt>起播到首帧</dt><dd><output aria-label="起播耗时">{diagnostics.firstFrameMs !== null ? elapsedLabel(diagnostics.firstFrameMs) : phase === 'choice' ? '待播放' : phase === 'error' ? '播放失败' : '等待画面'}</output></dd></div>
          <div><dt>播放准备</dt><dd><output aria-label="播放准备阶段">{preparation.trace.current ? preparationLabels[preparation.trace.current] : preparation.trace.totalMs !== undefined ? `${preparation.trace.failed ? '未完成' : '已完成'} · ${elapsedLabel(preparation.trace.totalMs)}` : '待播放'}</output></dd></div>
          {Object.entries(preparation.trace.stages).map(([stage, ms]) => <div key={stage}><dt>{preparationLabels[stage as keyof typeof preparationLabels]}</dt><dd><output aria-label={`${preparationLabels[stage as keyof typeof preparationLabels]}耗时`}>{elapsedLabel(ms)}</output></dd></div>)}
          {preparation.trace.backend?.total_ms !== undefined && <div><dt>服务内部处理</dt><dd><output aria-label="服务内部处理耗时">{elapsedLabel(preparation.trace.backend.total_ms)}{preparation.trace.backend.color_probe_ms !== undefined && `（色彩补测 ${elapsedLabel(preparation.trace.backend.color_probe_ms)}）`}</output></dd></div>}
          <div><dt>最近跳播到画面</dt><dd><output aria-label="跳播耗时" data-target={diagnostics.lastSeek?.target}>{diagnostics.lastSeek ? `${seekRouteLabel} · ${diagnostics.lastSeek.elapsedMs === null ? '等待画面' : elapsedLabel(diagnostics.lastSeek.elapsedMs)}` : '尚未跳播'}</output></dd></div>
        </dl>
        {playbackColor?.warning && <p className="color-warning">{playbackColor.warning}</p>}
        <small>耗时包含本机处理、读取与解码；分辨率不代表转码无损。</small>
      </details>
      {openSetting !== 'subtitles' && subtitlePanel}
      <details className="track-information"><summary><Icon name="audio" size={16}/>音轨与字幕信息</summary>
        <h3>音轨信息</h3><p>{media.audio_tracks.map(x => [x.language, x.codec].filter(Boolean).join(' · ')).join(' / ') || '默认音轨'}</p>
        <h3>内嵌字幕信息</h3><p>{media.subtitles.map(x => [x.language, x.codec].filter(Boolean).join(' · ') + (TEXT_SUBTITLE_CODECS.has(x.codec.toLowerCase()) ? '' : '（图像字幕暂不支持）')).join(' / ') || '无'}</p>
      </details>
      <MediaEditor media={media} update={update} onDirtyChange={metadataChanged} />
    </aside>
  </div>;
}
