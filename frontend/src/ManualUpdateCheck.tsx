import {useEffect,useRef,useState} from 'react';
import {api,errorText} from './api';
import {Button,StatusMessage} from './ui';
import {Icon} from './Icon';
import {requireDesktop} from './nativeDesktop';
type Result={status:'available'|'pending'|'current'|'ahead'|'unpublished';version?:string;tag?:string;published_at?:string;notes?:string;downloads?:{format:'folder'|'single';filename:string;bytes:number}[]};
export function useManualUpdateCheck() {
  const [checking,setChecking]=useState(false),[result,setResult]=useState<Result|null>(null),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function check() {
    if(request.current)return;
    const controller=new AbortController();request.current=controller;setChecking(true);setResult(null);setError('');
    try {const value=await api<Result>('/api/updates/check',{method:'POST',signal:controller.signal});if(!controller.signal.aborted)setResult(value);}
    catch(e){if(!controller.signal.aborted)setError(errorText(e));}
    finally {if(request.current===controller)request.current=null;if(!controller.signal.aborted)setChecking(false);}
  }
  return {checking,result,error,check};
}
export function UpdateResult({result,error}:{result:Result|null;error:string}) {
  const [openError,setOpenError]=useState('');
  useEffect(()=>setOpenError(''),[result,error]);
  function open(format?:'folder'|'single') {
    setOpenError('');void (async()=>requireDesktop('openRelease').openRelease(result!.tag!,format))().catch(e=>setOpenError(errorText(e)));
  }
  const messages={available:`发现新版本 ${result?.version}`,pending:`版本 ${result?.version} 尚未提供 Windows 便携包，暂无可下载更新`,current:'当前已是最新正式版',ahead:`当前版本高于已发布正式版 ${result?.version}，暂无更新`,unpublished:'暂无可获取的正式发布版本'};
  const descriptions={available:'更新已就绪，请在下方选择便携格式。升级前记得保留媒体库数据。',pending:'发布文件仍在准备中，请稍后手动检查。',current:'无需更新，可以继续安心使用。',ahead:'正在使用较新的构建，无需降级。',unpublished:'稍后可再次手动检查，不影响本地播放。'};
  const tone=error?'error':result?.status==='available'?'available':result?.status==='current'?'current':'neutral';
  return <div className="manual-update-result">
    {(error||result)&&<section className={`update-result-banner is-${tone}`} role={error?'alert':'status'} aria-label="更新检查结果">
      <span className="update-result-mark"><Icon name={error?'warning':tone==='available'?'download':tone==='current'?'check':'info'} size={24}/></span>
      <div className="update-result-copy"><small>检查更新结果</small><strong>{error?'检查更新未完成':messages[result!.status]}</strong>
        <p>{error||descriptions[result!.status]}</p></div>
    </section>}
    {result&&!error&&<>
      {(result.status==='available'||result.status==='current'&&Boolean(result.downloads?.length))&&result.tag&&<>{result.published_at&&<small>发布时间：{result.published_at.slice(0,10)}</small>}
        {Boolean(result.downloads?.length)&&<div className="release-downloads">{result.downloads!.map(item=><section key={item.format} className="release-download-card">
          <strong>{item.format==='folder'?'文件夹便携版 · ZIP':'单文件便携版 · EXE'}{item.format==='folder'&&<small>推荐日常使用</small>}</strong>
          <p>{item.format==='folder'?'完整解压后运行 AVHub.exe，启动无需重复解包。':'一个文件即可携带，启动时先解包。'}</p>
          <Button icon="external" onClick={()=>open(item.format)}>下载{item.format==='folder'?'文件夹版':'单文件版'} · {(item.bytes/1024**2).toFixed(1)} MB</Button>
        </section>)}</div>}
        <div className="app-tool-actions"><Button icon="external" onClick={()=>open()}>前往下载</Button></div>
        {Boolean(result.downloads?.length)&&<p className="release-upgrade-hint">升级前关闭应用，保留 AVHub-data 与 avhub-data-location.json。ZIP 需完整解压；请用 SHA256SUMS.txt 校验下载文件。</p>}
        {result.notes&&<details><summary>更新说明</summary><p>{result.notes}</p></details>}</>}
    </>}
    {openError&&<StatusMessage kind="error">{openError}</StatusMessage>}
  </div>;
}
