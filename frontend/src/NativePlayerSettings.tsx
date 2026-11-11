import {useEffect,useRef,useState} from 'react';
import {api,json,errorText} from './api';
import {preference,rememberSavedPreference} from './preferences';
import {Icon} from './Icon';
import {Button,StatusMessage} from './ui';

export function NativePlayerSettings({busy,changeBusy}:{busy:boolean;changeBusy:(value:boolean)=>void}){
  const [seekPolicy,setSeekPolicy]=useState(()=>preference('mpvSeekPolicy','exact'));
  const [renderRuntime,setRenderRuntime]=useState('');
  const [engine,setEngine]=useState(()=>preference('playerEngine','chromium'));
  // Preserve legacy MPV defaults; first-time opt-in recommends the native
  // independent window without migrating any existing saved choice.
  const [windowMode,setWindowMode]=useState(()=>preference('mpvWindowMode',preference<string>('playerEngine','chromium')==='mpv'?'embedded':'independent'));
  const [controllerEnabled,setControllerEnabled]=useState(()=>preference<boolean>('playbackControllerEnabled',false));
  const [sessionCoordinator,setSessionCoordinator]=useState(()=>preference<boolean>('playbackSessionCoordinatorEnabled',false));
  const [renderEnabled,setRenderEnabled]=useState(()=>preference<boolean>('nativeRenderEnabled',false)),[renderAvailable,setRenderAvailable]=useState(false);
  const [available,setAvailable]=useState<boolean|null>(null),[error,setError]=useState('');
  const [packaged,setPackaged]=useState<boolean|null>(null);
  const [checking,setChecking]=useState(true),[runtimeReason,setRuntimeReason]=useState('');
  const generation=useRef(0);
  async function detect(){
    const current=++generation.current;setChecking(true);
    try{
      if(!window.avhubDesktop?.nativePlayer)throw new Error('桌面原生播放接口未就绪');
      const value=await window.avhubDesktop.nativePlayer('status');if(current!==generation.current)return;
      setAvailable(value.available===true);setPackaged(typeof value.packaged==='boolean'?value.packaged:null);setRuntimeReason(typeof value.reason==='string'?value.reason:'');
      try{const render=await window.avhubDesktop.renderPlayer('status');if(current===generation.current){setRenderAvailable(render.available===true);setRenderRuntime(typeof render.runtime==='string'?render.runtime:'');}}catch{if(current===generation.current)setRenderAvailable(false);}
    }catch(e){if(current===generation.current){setAvailable(false);setRuntimeReason(errorText(e));}}
    finally{if(current===generation.current)setChecking(false);}
  }
  useEffect(()=>{void detect();return()=>{generation.current++;};},[]);
  async function change(value:string){
    changeBusy(true);setError('');
    try{
      const initializeMode=value==='mpv'&&preference('mpvWindowMode',null)===null;
      await api('/api/preferences',json('PATCH',{values:{playerEngine:value,...(initializeMode?{mpvWindowMode:windowMode}:{})}}));
      rememberSavedPreference('playerEngine',value);if(initializeMode)rememberSavedPreference('mpvWindowMode',windowMode);setEngine(value);
    }
    catch(e){setError(errorText(e));}finally{changeBusy(false);}
  }
  async function changeSeekPolicy(value:string){
    changeBusy(true);setError('');
    try{await api('/api/preferences',json('PATCH',{values:{mpvSeekPolicy:value}}));rememberSavedPreference('mpvSeekPolicy',value);setSeekPolicy(value);}
    catch(e){setError(errorText(e));}finally{changeBusy(false);}
  }
  async function changeWindow(value:string){
    changeBusy(true);setError('');
    try{await api('/api/preferences',json('PATCH',{values:{mpvWindowMode:value}}));rememberSavedPreference('mpvWindowMode',value);setWindowMode(value);}
    catch(e){setError(errorText(e));}finally{changeBusy(false);}
  }
  async function changeController(value:boolean){
    const previous=controllerEnabled;setControllerEnabled(value);changeBusy(true);setError('');
    try{await api('/api/preferences',json('PATCH',{values:{playbackControllerEnabled:value}}));rememberSavedPreference('playbackControllerEnabled',value);setControllerEnabled(value);}
    catch(e){setControllerEnabled(previous);setError(errorText(e));}finally{changeBusy(false);}
  }
  async function changeRender(value:boolean){changeBusy(true);setError('');try{await api('/api/preferences',json('PATCH',{values:{nativeRenderEnabled:value}}));rememberSavedPreference('nativeRenderEnabled',value);setRenderEnabled(value);}catch(e){setError(errorText(e));}finally{changeBusy(false);}}
  async function changeSessionCoordinator(value:boolean){changeBusy(true);setError('');try{await api('/api/preferences',json('PATCH',{values:{playbackSessionCoordinatorEnabled:value}}));rememberSavedPreference('playbackSessionCoordinatorEnabled',value);setSessionCoordinator(value);}catch(e){setError(errorText(e));}finally{changeBusy(false);}}
  return <section className="settings-section autoplay-settings" aria-label="播放引擎设置">
    <h3><Icon name="play"/>播放引擎</h3>
    <label className="autoplay-toggle"><input type="checkbox" checked={controllerEnabled} disabled={busy} onChange={e=>void changeController(e.target.checked)}/>统一播放控制（试验）</label>
    <small>默认关闭，仅影响后续打开的现有播放器；关闭可恢复旧控制路径，不更改默认引擎。</small>
    <label>默认播放引擎 <select aria-label="默认播放引擎" value={engine} disabled={busy||checking} onChange={e=>void change(e.target.value)}>
      <option value="chromium">现有播放器（默认）</option><option value="mpv" disabled={available!==true&&!renderAvailable}>MPV 原生播放器 · 试用</option>
    </select></label>
    {engine==='mpv'&&<><label>默认跳播模式<select aria-label="默认跳播模式" value={seekPolicy} disabled={busy} onChange={e=>void changeSeekPolicy(e.target.value)}><option value="exact">精确</option><option value="fast">快速（关键帧）</option><option value="smart">智能</option></select></label><small>对之后打开的视频生效。快速模式允许关键帧偏差，画质与原文件一致；播放页可临时切换。 快速模式在文件末段没有后续关键帧时会精确定位，避免停住。</small><small>智能模式先使用精确定位；播放中多次远跳较慢时尝试一次关键帧定位，再根据本次结果决定是否继续。暂停和短跳保持精确。</small></>}
    {engine==='mpv'&&<label className="autoplay-toggle"><input type="checkbox" checked={renderEnabled} disabled={busy||!renderAvailable&&!renderEnabled} onChange={e=>void changeRender(e.target.checked)}/>D3D11 原生嵌入（试验）</label>}
    {renderEnabled&&<small>通过共享纹理复用应用内控件，允许 SDR、HDR 和色彩标记不完整的视频尝试播放。默认关闭，由用户在设置中启用；实际解码或显示失败时可切回现有原画播放器。</small>}
    <label className="autoplay-toggle"><input type="checkbox" checked={sessionCoordinator} disabled={busy} onChange={e=>void changeSessionCoordinator(e.target.checked)}/>增强会话管理（试验）</label><small>默认关闭，对之后打开的现有播放器、MPV 独立窗口及 D3D11 内嵌播放生效，协调跳播、保存与退出；关闭后恢复原有流程，不更改默认引擎。</small>
    {engine==='mpv'&&!renderEnabled&&<label>MPV 播放窗口 <select aria-label="MPV 播放窗口" value={windowMode} disabled={busy} onChange={e=>void changeWindow(e.target.value)}>
      <option value="embedded">应用内嵌</option><option value="independent">独立窗口（推荐）</option>
    </select></label>}
    <small>MPV 直接解码原文件，不创建封装副本、不转码。窗口模式仅影响之后打开的视频，不在播放中自动切换。</small>
    {renderEnabled&&renderRuntime&&<small>内嵌运行库 · {renderRuntime}</small>}
    {!renderEnabled&&<small>{windowMode==='independent'?'推荐独立窗口：原生控制栏、置顶、截图与连播；避开 Electron 画面叠层，滚轮调节音量。快捷操作见“帮助”。':'应用内嵌：保留纯净播放与画面缩放；原生叠层及混合 DPI 的显示效果需本机确认，异常时可切回现有播放器。'}</small>}
    <small>{renderEnabled?'D3D11 使用原尺寸 RGBA16F，PQ / HLG 通过对应 HDR 色彩标记传递。':'MPV 直接尝试解码原文件。'}HDR、Dolby Vision / HDR10+ 和实体显示效果待验证，不因未验证阻止播放；最终显示由显卡、系统及屏幕能力决定，不自动授权有损转码。</small>
    <div className="native-runtime-status"><span role="status">{checking?'正在检测原生播放运行库…':renderEnabled?(renderAvailable?'D3D11 验收运行库已检测到':'D3D11 验收运行库不可用'):available?'MPV 运行库已验证':runtimeReason||'MPV 运行库不可用'}</span><Button icon="refresh" busy={checking} disabled={busy} onClick={()=>void detect()}>重新检测</Button></div>
    {available===false&&!renderEnabled&&<StatusMessage kind="info">{packaged===false?'开发环境可运行 npm run prepare:mpv，完成后点击重新检测。':'请使用包含完整 MPV 运行库的桌面包；现有播放器不受影响，无需运行开发脚本。'}</StatusMessage>}
    {renderEnabled&&!renderAvailable&&!checking&&<StatusMessage kind="info">未检测到 D3D11 验收运行库，请检查本次启动的验收配置，或切回现有原画播放器。</StatusMessage>}
    {!checking&&(renderEnabled?!renderAvailable:available===false)&&engine==='mpv'&&<button className="ui-button" disabled={busy} onClick={()=>void change('chromium')}>改用现有播放器</button>}
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
  </section>;
}
