import {useEffect,useState} from 'react';
import {api,CLIENT_BUILD,errorText} from './api';
import {Button,Dialog,StatusMessage} from './ui';
import {Icon} from './Icon';
import {useManualUpdateCheck,UpdateResult} from './ManualUpdateCheck';
import {requireDesktop} from './nativeDesktop';
import './app-tools.css';
type AppInfo={version:string;build_id:string;api_protocol:number;data_directory:string;frozen:boolean};
const homepage='https://github.com/jhlxlml/avhub';
export function requestAbout(){window.dispatchEvent(new Event('avhub-open-about'));}
export function AppDataTools({busy,enabled}:{busy:boolean;enabled:boolean}) {
  const [info,setInfo]=useState<AppInfo|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[working,setWorking]=useState(false),[retry,setRetry]=useState(0);
  const [location,setLocation]=useState<{current:string;default:string;next:string;locked:boolean}|null>(null);
  useEffect(()=>{
    const quitting=(event:Event)=>{if(working)(event as CustomEvent<Promise<unknown>[]>).detail.push(Promise.resolve(false));};
    window.addEventListener('avhub-before-quit',quitting);return()=>window.removeEventListener('avhub-before-quit',quitting);
  },[working]);
  useEffect(()=>{
    if(!enabled||!window.avhubDesktop?.dataLocation)return;
    let active=true;void window.avhubDesktop.dataLocation('get').then(value=>{if(active&&'current' in value)setLocation(value);}).catch(e=>{if(active)setError(errorText(e));});
    return()=>{active=false;};
  },[enabled,retry]);
  async function chooseLocation(action:'choose') {
    if(busy||working||!window.avhubDesktop?.dataLocation)return;
    setWorking(true);setError('');setNotice('');
    try {const value=await window.avhubDesktop.dataLocation(action);if('current' in value){setLocation(value);setNotice('已保存；正常退出并重新打开后迁移生效，旧目录保留。');}}
    catch(e){setError(errorText(e));}finally{setWorking(false);}
  }
  useEffect(()=>{
    if(!enabled)return;const controller=new AbortController();setError('');
    void api<AppInfo>('/api/app-info',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setInfo(value);})
      .catch(e=>{if(!controller.signal.aborted)setError(errorText(e));});return()=>controller.abort();
  },[enabled,retry]);
  async function act(kind:'open'|'copy') {
    if(!info||busy||working)return;setWorking(true);setError('');setNotice('');
    try {
      if(kind==='copy')await navigator.clipboard.writeText(info.data_directory);
      else await requireDesktop('appCommand').appCommand('data-folder');
      setNotice(kind==='copy'?'数据目录路径已复制':'已请求打开数据目录');
    }catch(e){setError(errorText(e));}finally{setWorking(false);}
  }
  return <section className="settings-section app-tools" aria-label="应用数据目录">
    <h3><Icon name="database"/>数据目录</h3>
    <p className="dialog-description">这里保存索引、封面、设置与观看记录，不是原视频目录。默认保存在应用旁的 AVHub-data，可选择自定义空目录。</p>
    <code className="app-directory-path" title={info?.data_directory}>{info?.data_directory||'正在读取实际目录…'}</code>
    <div className="app-tool-actions"><Button icon="folder" disabled={busy||working||!info} onClick={()=>void act('open')}>打开数据目录</Button><Button icon="copy" disabled={busy||working||!info} onClick={()=>void act('copy')}>复制目录路径</Button></div>
    {location&&<><div className="app-tool-actions"><Button icon="reveal" disabled={busy||working||location.locked} onClick={()=>void chooseLocation('choose')}>自定义数据目录</Button></div>
      <small>默认位置：{location.default}</small>
      {location.next!==location.current&&<div className="data-location-pending"><small>下次启动迁移至</small><code>{location.next}</code></div>}
      {location.locked&&<small>当前由 AVHUB_DATA_DIR 环境变量指定；移除后可在这里更改目录。</small>}</>}
    <small>更换后下次启动复制媒体库与封面，旧目录保留；原视频、截图和播放缓存不搬动。请选择空目录，并建议先做完整备份。AVHUB_DATA_DIR 环境变量仍具有最高优先级。</small>
    {notice&&<StatusMessage>{notice}</StatusMessage>}{error&&<StatusMessage kind="error">{error}<Button icon="refresh" disabled={busy||working} onClick={()=>setRetry(n=>n+1)}>重试读取</Button></StatusMessage>}
  </section>;
}
export function AboutHost() {
  const [open,setOpen]=useState(false);
  useEffect(()=>{const show=()=>{if(!document.querySelector('.modal-backdrop'))setOpen(true);};window.addEventListener('avhub-open-about',show);return()=>window.removeEventListener('avhub-open-about',show);},[]);
  return open?<AboutDialog close={()=>setOpen(false)}/>:null;
}
function AboutDialog({close}:{close:()=>void}) {
  const [busy,setBusy]=useState(false);
  return <Dialog label="关于 AVHub" closeLabel="关闭关于" busy={busy} close={close} className="modal app-about"><AboutPanel changeBusy={setBusy}/></Dialog>;
}
export function AboutPanel({changeBusy}:{changeBusy?:(busy:boolean)=>void}) {
  const update=useManualUpdateCheck();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{changeBusy?.(busy);return()=>changeBusy?.(false);},[busy,changeBusy]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3000);return()=>window.clearTimeout(timer);},[notice]);
  const identity=`AVHub ${CLIENT_BUILD.version} · 构建 ${CLIENT_BUILD.build_id} · API ${CLIENT_BUILD.api_protocol}`;
  async function act(kind:'version'|'address'|'open') {
    if(busy)return;setBusy(true);setError('');setNotice('');
    try {
      if(kind!=='open'){await navigator.clipboard.writeText(kind==='version'?identity:homepage);setNotice(kind==='version'?'版本信息已复制':'项目地址已复制');}
      else {
        if(!window.avhubDesktop?.appCommand)throw new Error('请重新编译并启动 Electron 桌面组件');
        await window.avhubDesktop.appCommand('project-page');
      }
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  return <section className="app-about-content" aria-label="关于 AVHub">
    <h3 className="app-about-brand"><span className="app-about-mark"><Icon name="play" size={22}/></span><span>AVHub<small>本地离线视频库</small></span></h3>
    <p className="app-about-intro">把分散在不同文件夹的视频整理到一处，轻松浏览、搜索和观看。支持电影与剧集归类、收藏、播放列表，以及自动记住观看进度。</p>
    <div className="app-about-principles"><span><Icon name="shield" size={15}/>默认只读 · 授权整理</span><span><Icon name="quality" size={15}/>原画优先</span><span><Icon name="database" size={15}/>数据保存在本地</span></div>
    <dl className="app-about-info"><div><dt>应用版本</dt><dd className="app-version-check"><span>{CLIENT_BUILD.version}</span><Button icon="refresh" busy={update.checking} onClick={()=>void update.check()}>{update.checking?'检查中…':'检查更新'}</Button></dd></div></dl>
    <UpdateResult result={update.result} error={update.error}/>
    <dl className="app-about-info app-build-info"><div><dt>构建标识</dt><dd><code>{CLIENT_BUILD.build_id}</code></dd></div><div><dt>接口协议</dt><dd>{CLIENT_BUILD.api_protocol}</dd></div></dl>
    <div className="app-tool-actions"><Button icon="copy" disabled={busy} onClick={()=>void act('version')}>复制版本信息</Button>
      <Button icon="external" disabled={busy} onClick={()=>void act('open')}>打开项目主页</Button>
      <Button icon="copy" disabled={busy} onClick={()=>void act('address')}>复制项目地址</Button></div>
    <p className="app-project-address">{homepage}</p><small>日常扫描与播放不需要联网；仅点击“检查更新”时访问 GitHub，不自动检查、下载或安装。分享诊断信息前，请检查本地路径和视频标题。</small>
    {notice&&<StatusMessage>{notice}</StatusMessage>}{error&&<StatusMessage kind="error">{error}</StatusMessage>}
  </section>;
}
