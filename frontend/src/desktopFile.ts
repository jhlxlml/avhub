import {requireDesktop} from './nativeDesktop';
export async function desktopFile(value:Parameters<NonNullable<NonNullable<Window['avhubDesktop']>['fileOperation']>>[0]){
  const desktop=requireDesktop('fileOperation');
  if(!desktop.fileOperation)throw new Error('请重启已更新的桌面组件');
  return desktop.fileOperation(value);
}

type PreviewInput=Omit<Parameters<typeof desktopFile>[0],'action'|'requestId'>&{action:'preview'|'preview-records'};
export async function desktopFilePreview(value:PreviewInput,signal:AbortSignal){
  signal.throwIfAborted();
  const requestId=crypto.randomUUID().replaceAll('-','');
  const cancel=()=>{void desktopFile({action:'cancel-preview',requestId}).catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    const result=await desktopFile({...value,requestId});
    if(signal.aborted){
      if(result.preview_token)void desktopFile({action:value.action==='preview'?'release-preview':'release-record-preview',previewToken:result.preview_token}).catch(()=>{});
      signal.throwIfAborted();
    }
    return result;
  }finally{signal.removeEventListener('abort',cancel);}
}
