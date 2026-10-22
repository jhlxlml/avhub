import {api,SERVICE_MISMATCH} from './api';

export function transientRouteRead(error:unknown){
  const value=error as {message?:string;status?:number;retryableRead?:boolean}|null;
  return value?.message!==SERVICE_MISMATCH&&(value?.retryableRead===true||[502,503,504].includes(value?.status??0));
}
function wait(ms:number,signal:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return;}
    const cancel=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
    signal.addEventListener('abort',cancel,{once:true});
  });
}
// Route restoration only: no general request retry, playback POST, file action,
// preferences write or source reload. Explicitly bounded and abortable.
export async function readRoute<T>(url:string,signal:AbortSignal):Promise<T>{
  for(let attempt=0;;attempt++){
    signal.throwIfAborted();
    try{return await api<T>(url,{signal,timeoutMs:5000});}
    catch(error){
      if(signal.aborted||attempt>=2||!transientRouteRead(error))throw error;
      await wait(attempt===0?200:600,signal);
    }
  }
}
