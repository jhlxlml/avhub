import {useEffect,useState} from 'react';
import {api,CLIENT_BUILD,errorText} from './api';
import {Button,Dialog,StatusMessage} from './ui';
import {Icon} from './Icon';
import './app-tools.css';
type AppInfo={version:string;build_id:string;api_protocol:number;data_directory:string;frozen:boolean};
const homepage='https://github.com/jhlxlml/avhub';
export function requestAbout(){window.dispatchEvent(new Event('avhub-open-about'));}
export function AppDataTools({busy,enabled}:{busy:boolean;enabled:boolean}) {
  const [info,setInfo]=useState<AppInfo|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[working,setWorking]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!enabled)return;const controller=new AbortController();setError('');
    void api<AppInfo>('/api/app-info',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setInfo(value);})
      .catch(e=>{if(!controller.signal.aborted)setError(errorText(e));});return()=>controller.abort();
  },[enabled,retry]);
  async function act(kind:'open'|'copy') {
    if(!info||busy||working)return;setWorking(true);setError('');setNotice('');
    try {
      if(kind==='copy')await navigator.clipboard.writeText(info.data_directory);
      else if(window.avhubDesktop)await window.avhubDesktop.appCommand('data-folder');
      else await api('/api/app-data/reveal',{method:'POST'});
      setNotice(kind==='copy'?'数据目录路径已复制':'已请求打开数据目录');
    }catch(e){setError(errorText(e));}finally{setWorking(false);}
  }
  return <section className="settings-section app-tools" aria-label="应用数据目录">
    <h3><Icon name="database"/>数据目录</h3>
    <p className="dialog-description">这里保存索引、封面、设置与观看记录，不是原视频目录。仅查看或打开，不切换、搬移数据。</p>
    <code className="app-directory-path" title={info?.data_directory}>{info?.data_directory||'正在读取实际目录…'}</code>
    <div className="app-tool-actions"><Button icon="folder" disabled={busy||working||!info} onClick={()=>void act('open')}>打开数据目录</Button><Button icon="copy" disabled={busy||working||!info} onClick={()=>void act('copy')}>复制目录路径</Button></div>
    <small>沿用当前启动器选择的位置；完整迁移前请先备份，并完全退出应用。此处不会改变媒体库位置。</small>
    {notice&&<StatusMessage>{notice}</StatusMessage>}{error&&<StatusMessage kind="error">{error}<Button icon="refresh" disabled={busy||working} onClick={()=>setRetry(n=>n+1)}>重试读取</Button></StatusMessage>}
  </section>;
}
export function AboutHost() {
  const [open,setOpen]=useState(false);
  useEffect(()=>{const show=()=>{if(!document.querySelector('.modal-backdrop'))setOpen(true);};window.addEventListener('avhub-open-about',show);return()=>window.removeEventListener('avhub-open-about',show);},[]);
  return open?<AboutDialog close={()=>setOpen(false)}/>:null;
}
function AboutDialog({close}:{close:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
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
  return <Dialog label="关于 AVHub" closeLabel="关闭关于" busy={busy} close={close} className="modal app-about">
    <h2 className="dialog-title"><Icon name="play" size={22}/>AVHub</h2><p className="dialog-description">本地离线视频库 · 原文件只读 · 原画优先</p>
    <dl className="app-about-info"><div><dt>应用版本</dt><dd>{CLIENT_BUILD.version}</dd></div><div><dt>构建标识</dt><dd><code>{CLIENT_BUILD.build_id}</code></dd></div><div><dt>接口协议</dt><dd>{CLIENT_BUILD.api_protocol}</dd></div></dl>
    <div className="app-tool-actions"><Button icon="copy" disabled={busy} onClick={()=>void act('version')}>复制版本信息</Button>
      {window.avhubDesktop?<Button icon="external" disabled={busy} onClick={()=>void act('open')}>打开项目主页</Button>:<a className="ui-button" href={homepage} target="_blank" rel="noopener noreferrer"><Icon name="external" size={16}/>打开项目主页</a>}
      <Button icon="copy" disabled={busy} onClick={()=>void act('address')}>复制项目地址</Button></div>
    <p className="app-project-address">{homepage}</p><small>日常扫描与播放不需要联网；项目主页仅在主动点击时打开。分享诊断信息前，请检查本地路径和视频标题。</small>
    {notice&&<StatusMessage>{notice}</StatusMessage>}{error&&<StatusMessage kind="error">{error}</StatusMessage>}
  </Dialog>;
}
