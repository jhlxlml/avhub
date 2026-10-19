import {useEffect,useRef,useState} from 'react';
import {duration,errorText} from './api';
import {Icon,type IconName} from './Icon';
import {readMouseSeekSeconds,mouseSeekDeduper} from './mouseSeek';
import {initializePreferences} from './preferences';
import {playerShortcutTarget,playbackKeyIntent} from './playerShortcuts';
import './native-player.css';

type Track={id:number;type:'audio'|'sub'|'video';title?:string;lang?:string;codec?:string};
type State={session:string;title:string;phase:string;error?:string;saveError?:string;pure:boolean;pinned:boolean;fullscreen:boolean;maximized:boolean;firstFrameMs:number|null;readyMs?:number|null;lastSeekMs:number|null;lastSeekTotalMs?:number|null;sourceLoads?:number;bufferingEvents?:number;bufferingMs?:number;pendingSeek:number|null;restarts:number;seeks:number;subtitleAppearance?:{size:number;color:string;background:number};properties:Record<string,any>};
const empty:State={session:'',title:'AVHub · 原生播放',phase:'starting',pure:false,pinned:false,fullscreen:false,maximized:false,properties:{},firstFrameMs:null,lastSeekMs:null,pendingSeek:null,restarts:0,seeks:0};

export function NativePlayerOverlay(){
  const [state,setState]=useState<State&{embedded?:boolean}>(empty),[notice,setNotice]=useState(''),[panel,setPanel]=useState(false);
  const draggingWindow=useRef(false);
  useEffect(()=>{document.documentElement.classList.toggle('native-embedded-overlay',Boolean(state.embedded));return()=>document.documentElement.classList.remove('native-embedded-overlay');},[state.embedded]);
  const [visible,setVisible]=useState(true),[cursor,setCursor]=useState(true),[dragPosition,setDragPosition]=useState<number|null>(null);
  const [captureBusy,setCaptureBusy]=useState(false),capturePending=useRef(false);
  const current=useRef(state),lastRevision=useRef(-1),hover=useRef(false),held=useRef(false),timer=useRef<number|undefined>(undefined),toast=useRef<number|undefined>(undefined);
  const transform=useRef({zoom:0,x:0,y:0}),drag=useRef<{x:number;y:number;panX:number;panY:number;moved:boolean}|null>(null);
  const transformTimer=useRef<number|undefined>(undefined),pendingTransform=useRef(false);
  const transformBusy=useRef(false),transformRevision=useRef(0),mounted=useRef(true);
  const panelOpen=useRef(false);panelOpen.current=panel;
  const pointerFocus=useRef(false);
  const pointerRange=useRef<Element|null>(null);
  const timelinePointer=useRef<number|null>(null);
  const timelineTarget=useRef<number|null>(null);
  const acceptMouseSeek=useRef(mouseSeekDeduper());
  current.current=state;
  const props=state.properties,position=state.pendingSeek??Number(props['time-pos']||0),length=Number(props.duration||0),paused=props.pause!==false;
  function message(value:string){setNotice(value);clearTimeout(toast.current);toast.current=window.setTimeout(()=>setNotice(''),4000);}
  async function command(action:string,value?:unknown){
    try{const result=await window.avhubDesktop!.nativePlayer(action,{session:current.current.session,value});if(result?.memory==='session')message('字幕已加载；媒体库以外的临时字幕仅用于本次播放，不会自动重新打开。');return result;}
    catch(e){message(errorText(e));}
  }
  async function close(){try{await window.avhubDesktop!.nativePlayer('close',current.current.session);}catch(e){message(errorText(e));}}
  async function copyDiagnostics(){try{const value=await window.avhubDesktop!.nativePlayer('diagnostics',{session:current.current.session});await navigator.clipboard.writeText(JSON.stringify(value,null,2));message('播放诊断已复制，不包含视频路径或标题。');}catch(error){message(`复制诊断失败：${errorText(error)}`);}}
  function schedule(){clearTimeout(timer.current);timer.current=window.setTimeout(()=>{if(!hover.current&&!held.current&&!panelOpen.current){setVisible(false);setCursor(false);}},400);}
  function move(event:React.MouseEvent){
    setCursor(true);if(hover.current||event.clientY<45||event.clientY>innerHeight-100)setVisible(true);
    else if(!held.current&&!panel)setVisible(false);
    schedule();
  }
  function showControls(){hover.current=true;setVisible(true);setCursor(true);clearTimeout(timer.current);}
  function leaveControls(){hover.current=false;if(!held.current&&!panel)setVisible(false);schedule();}
  function seek(point:number){void command('seek',Math.max(0,Math.min(Math.max(0,length-.01),point)));}
  function finishTimeline(event:React.PointerEvent<HTMLInputElement>,commit:boolean){
    if(timelinePointer.current!==event.pointerId)return;
    const target=timelineTarget.current??Number(event.currentTarget.value);
    timelinePointer.current=null;held.current=false;
    timelineTarget.current=null;
    if(commit)seek(target);
    setDragPosition(null);schedule();
  }
  // React onChange also receives the native change fired after pointerup. The
  // controlled value may already be the old playback clock by then. Only input
  // represents a new selection; pointerup commits its saved target exactly once.
  function seekBy(delta:number){void command('seek-relative',delta);}
  async function capture(){
    if(capturePending.current)return;
    capturePending.current=true;setCaptureBusy(true);message('正在保存原分辨率截图…');
    try{
      const result=await window.avhubDesktop!.nativePlayer('screenshot',{session:current.current.session});
      if(!result?.filename)throw new Error('截图未返回保存结果，请查看截图目录后再重试');
      message(`截图已保存：${result.filename}`);
    }catch(e){message(errorText(e));}
    finally{capturePending.current=false;if(mounted.current)setCaptureBusy(false);}
  }
  function sendTransform(){
    if(!mounted.current)return;
    pendingTransform.current=true;transformRevision.current++;
    if(transformBusy.current||transformTimer.current!==undefined)return;
    transformTimer.current=window.setTimeout(async()=>{
      transformTimer.current=undefined;transformBusy.current=true;const revision=transformRevision.current;
      await command('transform',{...transform.current});transformBusy.current=false;
      if(revision===transformRevision.current)pendingTransform.current=false;
      else sendTransform();
    },16);
  }
  function reset(){transform.current={zoom:0,x:0,y:0};sendTransform();}
  function displaySize(){
    const p=current.current.properties,v=p['video-params'];
    let ratio=v?.dw&&v?.dh?v.dw/v.dh:innerWidth/innerHeight;
    // MPV's effective video-params rotation includes video-rotate already.
    if(Number(v?.rotate||0)%180)ratio=1/ratio;
    const height=Math.min(innerHeight,innerWidth/ratio);return {width:height*ratio,height};
  }
  function boundTransform(zoom:number,x:number,y:number){
    if(zoom<=1e-8)return {zoom:0,x:0,y:0};
    const scale=2**zoom,{width,height}=displaySize();
    const limitX=Math.max(0,(width*scale-innerWidth)/(2*width*scale));
    const limitY=Math.max(0,(height*scale-innerHeight)/(2*height*scale));
    return {zoom,x:Math.max(-limitX,Math.min(limitX,x)),y:Math.max(-limitY,Math.min(limitY,y))};
  }
  function constrainTransform(){
    const previous=transform.current,next=boundTransform(previous.zoom,previous.x,previous.y);
    if(next.zoom!==previous.zoom||next.x!==previous.x||next.y!==previous.y){transform.current=next;sendTransform();}
  }
  useEffect(()=>{
    mounted.current=true;
    document.documentElement.classList.add('native-player-overlay');
    const desktop=window.avhubDesktop!;
    void initializePreferences().catch(()=>{});
    const expected=new URLSearchParams(location.search).get('nativePlayer');
    const update=(value:State&{revision?:number})=>{
      if(value.session!==expected)return;
      if(typeof value.revision==='number'){if(value.revision<=lastRevision.current)return;lastRevision.current=value.revision;}
      current.current=value;setState(value);if(!pendingTransform.current)transform.current={zoom:Number(value.properties['video-zoom']||0),x:Number(value.properties['video-pan-x']||0),y:Number(value.properties['video-pan-y']||0)};
    };
    const unsubscribe=desktop.onNativeState(update);
    const mouseSeek=desktop.onMouseSeek?.(direction=>{const delta=direction==='back'?-1:1;if(!panelOpen.current&&acceptMouseSeek.current('native',delta))seekBy(delta*readMouseSeekSeconds());});
    void desktop.nativePlayer('snapshot').then(update).catch(e=>message(errorText(e)));
    const keys=(event:KeyboardEvent)=>{
      if(event.code==='Tab'){pointerFocus.current=false;pointerRange.current=null;}
      if(event.isComposing||event.keyCode===229||event.defaultPrevented)return;
      if(panelOpen.current){if(event.code==='Escape'){event.preventDefault();event.stopPropagation();setPanel(false);}return;}
      if(!playerShortcutTarget(event,pointerRange.current,!pointerFocus.current))return;
      const s=current.current,p=s.properties;
      const intent=playbackKeyIntent(event);
      if(intent){
        event.preventDefault();event.stopPropagation();
        if(event.repeat&&['pause','screenshot','next','fullscreen','pure','rotate','pip'].includes(intent))return;
        if(intent==='pause')void command('pause',p.pause===false);
        else if(intent==='back5'||intent==='back10')seekBy(intent==='back10'?-10:-5);
        else if(intent==='forward5'||intent==='forward10')seekBy(intent==='forward10'?10:5);
        else if(intent==='volumeUp'||intent==='volumeDown'){void command('volume',Math.max(0,Math.min(100,Number(p.volume||0)+(intent==='volumeUp'?5:-5))));if(intent==='volumeUp')void command('mute',false);}
        else if(intent==='mute')void command('mute',!p.mute);
        else if(intent==='next')void command('navigate','next');
        else if(intent==='screenshot')void capture();
        else if(intent==='rotate')void command('rotate',(Number(p['video-rotate']||0)+90)%360);
        else if(intent==='fullscreen')void command('window','fullscreen');
        else if(intent==='pure')void command('window','pure');
        else if(intent==='pip')message('原生播放暂不支持画中画，可在媒体页切回现有播放器');
        else if(intent==='escape'){if(s.fullscreen)void command('window','fullscreen');else if(s.pure)void command('window','pure');else setPanel(false);}
      }
    };
    const shortcut=desktop.onNativeShortcut?.(value=>document.dispatchEvent(new KeyboardEvent('keydown',{...value,bubbles:true,cancelable:true})));
    const wheel=(event:WheelEvent)=>{
      // Settings own their scroll area. Preventing every wheel event made the
      // lower subtitle/diagnostic controls unreachable on short windows.
      if((event.target as HTMLElement).closest('.native-panel'))return;
      event.preventDefault();
      if((event.target as HTMLElement).closest('.native-controls,.native-top'))return;
      if(event.shiftKey){void command('volume',Math.max(0,Math.min(100,Number(current.current.properties.volume||0)+(event.deltaY<0?5:-5))));return;}
      const previous=2**transform.current.zoom,next=Math.max(1,Math.min(8,previous*(event.deltaY<0?1.1:1/1.1)));
      const {width,height}=displaySize();
      const dx=(event.clientX-innerWidth/2)/width,dy=(event.clientY-innerHeight/2)/height;
      transform.current=boundTransform(Math.log2(next),transform.current.x+dx*(1/next-1/previous),transform.current.y+dy*(1/next-1/previous));
      sendTransform();
    };
    document.addEventListener('keydown',keys,true);document.addEventListener('wheel',wheel,{passive:false});window.addEventListener('resize',constrainTransform);
    schedule();
    return()=>{mounted.current=false;unsubscribe();mouseSeek?.();shortcut?.();document.removeEventListener('keydown',keys,true);document.removeEventListener('wheel',wheel);window.removeEventListener('resize',constrainTransform);clearTimeout(timer.current);clearTimeout(toast.current);clearTimeout(transformTimer.current);document.documentElement.classList.remove('native-player-overlay');};
  },[]);
  useEffect(()=>{constrainTransform();},[state.pure,props['video-params']?.dw,props['video-params']?.dh,props['video-params']?.rotate]);
  useEffect(()=>{if(panel){setVisible(true);clearTimeout(timer.current);}else schedule();},[panel]);
  function button(icon:IconName,label:string,onClick:()=>void,active=false){return <button type="button" aria-label={label} title={label} aria-pressed={active||undefined} onClick={onClick}><Icon name={icon}/></button>;}
  const tracks=Array.isArray(props['track-list'])?props['track-list'] as Track[]:[];
  const appearance=state.subtitleAppearance??{size:30,color:'#ffffff',background:.65};
  return <div role="region" aria-label="原生视频播放器" className={`native-stage${visible||panel?' controls-visible':''}${cursor?'':' cursor-hidden'}`} onPointerDownCapture={event=>{pointerFocus.current=true;pointerRange.current=event.target instanceof HTMLInputElement&&event.target.type==='range'?event.target:null;}} onMouseMove={move} onMouseLeave={()=>{if(!held.current){hover.current=false;setVisible(false);setCursor(false);}}}
    onPointerDown={event=>{
      if(event.button!==0||event.target!==event.currentTarget)return;
      event.currentTarget.setPointerCapture(event.pointerId);held.current=true;
      drag.current={x:event.clientX,y:event.clientY,panX:transform.current.x,panY:transform.current.y,moved:false};
    }} onPointerMove={event=>{
      const value=drag.current;if(!value||transform.current.zoom<=0)return;
      if(Math.abs(event.clientX-value.x)+Math.abs(event.clientY-value.y)>3)value.moved=true;
      if(value.moved){const {width,height}=displaySize(),scale=2**transform.current.zoom;transform.current=boundTransform(transform.current.zoom,value.panX+(event.clientX-value.x)/(width*scale),value.panY+(event.clientY-value.y)/(height*scale));sendTransform();}
    }} onPointerUp={event=>{
      if(!drag.current)return;const moved=drag.current.moved;drag.current=null;held.current=false;
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
      if(!moved)void command('pause',!paused);schedule();
    }} onPointerCancel={()=>{drag.current=null;held.current=false;schedule();}}
    onAuxClick={event=>{if(event.button===3||event.button===4){event.preventDefault();const delta=event.button===3?-1:1;if(!panelOpen.current&&acceptMouseSeek.current('dom',delta))seekBy(delta*readMouseSeekSeconds());}}}
    onDoubleClick={event=>{if(event.target===event.currentTarget)void command('window','fullscreen');}}>
    {(!state.embedded||state.pure)&&<div className="native-top" onMouseEnter={showControls} onMouseLeave={leaveControls}
      onPointerDown={event=>{if(!state.embedded||event.button!==0||(event.target as HTMLElement).closest('button'))return;event.preventDefault();draggingWindow.current=true;event.currentTarget.setPointerCapture(event.pointerId);void command('window-drag',{phase:'start',x:event.screenX,y:event.screenY});}}
      onPointerMove={event=>{if(draggingWindow.current)void command('window-drag',{phase:'move',x:event.screenX,y:event.screenY});}}
      onPointerUp={event=>{if(!draggingWindow.current)return;draggingWindow.current=false;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);void command('window-drag',{phase:'end',x:event.screenX,y:event.screenY});}}
      onPointerCancel={event=>{draggingWindow.current=false;void command('window-drag',{phase:'end',x:event.screenX,y:event.screenY});}}>
      <span className="native-title"><Icon name="play" size={14}/>AVHub · {state.pure?'纯净播放':state.title}</span>
      <div>{button('pin',state.pinned?'取消置顶':'窗口置顶',()=>void command('window','pin'),state.pinned)}{button('minimize','最小化',()=>void command('window','minimize'))}{button(state.maximized?'windowRestore':'windowMaximize',state.maximized?'还原窗口':'最大化',()=>void command('window','maximize'))}{button('close',state.embedded?'关闭窗口':'关闭原生播放',()=>void (state.embedded?command('window','close'):close()))}</div>
    </div>}
    {(state.phase==='starting'||state.pendingSeek!==null||props['paused-for-cache']===true||props.seeking===true)&&<div className="native-status" role="status">{state.phase==='starting'?'正在准备原生播放…':props.seeking||state.pendingSeek!==null?'正在定位画面…':'正在等待视频数据…'}</div>}
    {(state.error||state.saveError||notice||captureBusy)&&<div className={`native-notice${state.phase==='error'?' has-retry':''}`} role={state.error||state.saveError?'alert':'status'} onMouseEnter={showControls} onMouseLeave={leaveControls}>
      <span>{state.error||state.saveError||notice||(captureBusy?'正在保存原分辨率截图…':'')}</span>{state.phase==='error'&&button('refresh','重试原生播放',()=>void command('navigate','retry'))}
    </div>}
    <div className="native-controls" onMouseEnter={showControls} onMouseLeave={leaveControls} onFocusCapture={()=>{if(!pointerFocus.current){held.current=true;setVisible(true);}}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){held.current=false;schedule();}}}>
      <div className="native-timeline"><time>{duration(dragPosition??position)}</time><input aria-label="播放进度" type="range" min="0" max={length||1} step="0.01" value={dragPosition??position} onChange={()=>{}} onInput={e=>{const target=Number(e.currentTarget.value);if(timelinePointer.current!==null){timelineTarget.current=target;setDragPosition(target);}else{setDragPosition(null);seek(target);}}} onPointerDown={event=>{if(event.button!==0||timelinePointer.current!==null)return;timelinePointer.current=event.pointerId;timelineTarget.current=Number(event.currentTarget.value);held.current=true;event.currentTarget.setPointerCapture(event.pointerId);}} onPointerUp={event=>finishTimeline(event,true)} onPointerCancel={event=>finishTimeline(event,false)} onLostPointerCapture={event=>finishTimeline(event,false)} onKeyUp={()=>setDragPosition(null)}/><time>{duration(length)}</time></div>
      <div className="native-buttons">
        {button(paused?'play':'pause',paused?'播放':'暂停',()=>void command('pause',!paused))}
        {button('back','后退 5 秒',()=>seekBy(-5))}{button('forward','前进 5 秒',()=>seekBy(5))}
        {button(props.mute?'muted':'volume',props.mute?'取消静音':'静音',()=>void command('mute',!props.mute))}
        <input className="native-volume" aria-label="音量" type="range" min="0" max="100" value={Number(props.volume||0)} onChange={e=>void command('volume',Number(e.target.value))}/>
        {button('rotate','旋转画面',()=>void command('rotate',(Number(props['video-rotate']||0)+90)%360))}{button('zoomReset','还原缩放',reset)}<button type="button" aria-label="截图（C）" title={captureBusy?'正在保存原分辨率截图…':'截图（C）'} disabled={captureBusy} aria-busy={captureBusy} onClick={()=>void capture()}><Icon name={captureBusy?'refresh':'camera'} className={captureBusy?'native-capture-spinner':''}/></button>
        <span className="native-spacer"/>
        {button('previous','上一视频',()=>void command('navigate','previous'))}{button('next','下一视频',()=>void command('navigate','next'))}
        {button('playlist','待播队列',()=>void command('navigate','queue'))}
        {button('settings','播放设置与信息',()=>setPanel(value=>!value),panel)}
        {button(state.pure?'exitPurePlayback':'purePlayback',state.pure?'退出纯净播放':'纯净播放',()=>void command('window','pure'),state.pure)}
        {button(state.fullscreen?'fullscreenExit':'fullscreen',state.fullscreen?'退出视频全屏':'视频全屏',()=>void command('window','fullscreen'))}
      </div>
    </div>
    {panel&&<aside className="native-panel" onMouseEnter={showControls} onMouseLeave={leaveControls}>
      <div className="native-panel-heading"><strong>原文件 · MPV 原生解码</strong>{button('close','关闭播放设置',()=>setPanel(false))}</div>
      <h3 className="native-panel-section"><Icon name="audio" size={14}/>播放与轨道</h3>
      <label>倍速<select aria-label="播放倍速" value={Number(props.speed||1)} onChange={e=>void command('speed',Number(e.target.value))}>{[.5,.75,1,1.25,1.5,2].map(value=><option key={value} value={value}>{value}×</option>)}</select></label>
      <label>音轨<select aria-label="音轨" value={props.aid??'no'} onChange={e=>void command('track',{kind:'audio',id:e.target.value==='no'?'no':Number(e.target.value)})}><option value="no">关闭音轨</option>{tracks.filter(t=>t.type==='audio').map(t=><option key={t.id} value={t.id}>{t.title||t.lang||`音轨 ${t.id}`} · {t.codec}</option>)}</select></label>
      <label>字幕<select aria-label="字幕" value={props.sid??'no'} onChange={e=>void command('track',{kind:'sub',id:e.target.value==='no'?'no':Number(e.target.value)})}><option value="no">关闭字幕</option>{tracks.filter(t=>t.type==='sub').map(t=><option key={t.id} value={t.id}>{t.title||t.lang||`字幕 ${t.id}`}</option>)}</select></label>
      <label>字幕延迟<input aria-label="字幕延迟" type="number" min="-10" max="10" step="0.1" value={Number(props['sub-delay']||0)} onChange={e=>void command('sub-delay',Number(e.target.value))}/></label>
      <h3 className="native-panel-section"><Icon name="subtitles" size={14}/>字幕外观</h3>
      <button className="native-subtitle-import" type="button" onClick={()=>void command('subtitle-import')}><Icon name="upload"/>加载外挂字幕</button>
      <label>字幕字号<select aria-label="字幕字号" value={appearance.size} onChange={e=>void command('subtitle-style',{...appearance,size:Number(e.target.value)})}>{[22,26,30,34,38].map(size=><option key={size} value={size}>{size}</option>)}</select></label>
      <label>字幕文字<select aria-label="字幕文字颜色" value={appearance.color} onChange={e=>void command('subtitle-style',{...appearance,color:e.target.value})}><option value="#ffffff">白色</option><option value="#ffe38a">暖黄</option><option value="#9de7ff">浅蓝</option></select></label>
      <label>字幕底色<select aria-label="字幕背景透明度" value={appearance.background} onChange={e=>void command('subtitle-style',{...appearance,background:Number(e.target.value)})}>{[0,.35,.65,.85].map(value=><option key={value} value={value}>{Math.round(value*100)}%</option>)}</select></label>
      <small>外观与现有播放器共用保存；MPV 字号按窗口高度缩放。ASS/SSA 保留原有排版，图像字幕不应用文字外观。</small>
      <h3 className="native-panel-section"><Icon name="quality" size={14}/>播放诊断</h3>
      <dl><dt>视频编码</dt><dd>{props['video-codec']||'待解码'}</dd><dt>解码分辨率</dt><dd>{props['video-params']?.w||'—'} × {props['video-params']?.h||'—'}</dd><dt>像素格式</dt><dd>{props['video-params']?.pixelformat||'—'}</dd><dt>硬件解码</dt><dd>{props['hwdec-current']||'软件解码'}</dd><dt>视频首帧信号</dt><dd>{state.firstFrameMs===null?'—':`${Math.round(state.firstFrameMs)} ms`}</dd><dt>音视频输出就绪</dt><dd>{state.readyMs==null?'—':`${Math.round(state.readyMs)} ms`}</dd><dt>最近目标定位</dt><dd>{state.lastSeekMs===null?'—':`${Math.round(state.lastSeekMs)} ms`}</dd><dt>显示丢帧</dt><dd>{props['frame-drop-count']??'—'}</dd><dt>解码丢帧</dt><dd>{props['decoder-frame-drop-count']??'—'}</dd></dl>
      <dl><dt>最近跳播总等待（含排队）</dt><dd>{state.lastSeekTotalMs==null?'—':`${Math.round(state.lastSeekTotalMs)} ms`}</dd><dt>源文件加载次数</dt><dd>{state.sourceLoads??'—'}</dd><dt>缓存等待事件</dt><dd>{state.bufferingEvents??'—'}</dd><dt>已结束缓存等待累计</dt><dd>{state.bufferingMs==null?'—':`${Math.round(state.bufferingMs)} ms`}</dd></dl>
      <small>不转码、不降低源视频分辨率。时间来自 MPV 播放事件，并非屏幕逐像素验收。HDR 原生输出暂未开放。</small>
      <small>音轨、已识别字幕与延迟按视频保存；源文件或轨道变化后重新选择。媒体库以外的临时字幕、关闭音轨仅作用于本次播放。</small>
      <button className="native-subtitle-import" onClick={()=>void copyDiagnostics()}><Icon name="copy"/>复制播放诊断</button>
    </aside>}
  </div>;
}
