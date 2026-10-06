import {useEffect,useRef,useState} from 'react';
import {api,errorText} from './api';
import {Button,StatusMessage} from './ui';
import {requireDesktop} from './nativeDesktop';
type Result={status:'available'|'pending'|'current'|'ahead'|'unpublished';version?:string;tag?:string;published_at?:string;notes?:string};
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
  const messages={available:`发现新版本 ${result?.version}`,pending:`版本 ${result?.version} 尚未提供 Windows 便携包，暂无可下载更新`,current:'当前已是最新正式版',ahead:`当前版本高于已发布正式版 ${result?.version}，暂无更新`,unpublished:'暂无可获取的正式发布版本'};
  return <div className="manual-update-result" aria-live="polite">
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
    {result&&<><StatusMessage>{messages[result.status]}</StatusMessage>
      {result.status==='available'&&result.tag&&<>{result.published_at&&<small>发布时间：{result.published_at.slice(0,10)}</small>}
        <div className="app-tool-actions"><Button icon="external" onClick={()=>{setOpenError('');void (async()=>requireDesktop('openRelease').openRelease(result.tag!))().catch(e=>setOpenError(errorText(e)));}}>前往下载</Button></div>
        {result.notes&&<details><summary>更新说明</summary><p>{result.notes}</p></details>}</>}
    </>}
    {openError&&<StatusMessage kind="error">{openError}</StatusMessage>}
  </div>;
}
