import { useCallback,useRef,useState } from 'react';
import { Icon } from './Icon';
import {observeThumbnail} from './thumbnailVisibility';

// An error belongs to this URL only. A regenerated/versioned cover automatically
// retries, while unchanged failed images never trigger request or FFmpeg loops.
export function MediaThumbnail({url,retryKey=0}:{url?:string|null;retryKey?:number}) {
  const [result,setResult]=useState<{url:string;status:'ready'|'failed';retryKey:number}|null>(null);
  // Admit once near the viewport; the bounded page releases images on unmount.
  // Releasing src on every scroll caused repeated requests and decode churn.
  const [requested,setRequested]=useState<string|null>(null),detach=useRef<(()=>void)|undefined>(undefined);
  const near=Boolean(url&&requested===url);
  const imageRef=useCallback((node:HTMLImageElement|null)=>{detach.current?.();detach.current=undefined;if(node)detach.current=observeThumbnail(node,value=>{if(value)setRequested(url??null);});},[url]);
  const status=url && result?.url===url && (result.status==='ready'||result.retryKey===retryKey)?result.status:url?'loading':'missing';
  return <>
    {(!near||status!=='ready') && <span className="cover-placeholder" role="img" aria-label={status==='failed'?'预览图加载失败':status==='loading'?'正在加载预览图':'暂无预览图'}
      title={status==='failed'||status==='missing'?'预览图不可用，可在编辑媒体信息中单独重试或更换封面':'正在加载预览图'}><Icon name="film" size={29}/></span>}
    {url && status!=='failed' && <img data-private-media ref={imageRef} className={`thumbnail${near&&status==='ready'?' thumbnail-ready':''}`} src={near?url:undefined} alt="" loading="lazy" decoding="async"
      onLoad={event=>setResult({url,retryKey,status:event.currentTarget.naturalWidth>0?'ready':'failed'})} onError={()=>setResult({url,retryKey,status:'failed'})}/>}
  </>;
}
