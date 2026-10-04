import { useState } from 'react';
import { Icon } from './Icon';

// An error belongs to this URL only. A regenerated/versioned cover automatically
// retries, while unchanged failed images never trigger request or FFmpeg loops.
export function MediaThumbnail({url,retryKey=0}:{url?:string|null;retryKey?:number}) {
  const [result,setResult]=useState<{url:string;status:'ready'|'failed';retryKey:number}|null>(null);
  const status=url && result?.url===url && (result.status==='ready'||result.retryKey===retryKey)?result.status:url?'loading':'missing';
  return <>
    {status!=='ready' && <span className="cover-placeholder" role="img" aria-label={status==='failed'?'预览图加载失败':status==='loading'?'正在加载预览图':'暂无预览图'}
      title={status==='failed'||status==='missing'?'预览图不可用，可在编辑媒体信息中单独重试或更换封面':'正在加载预览图'}><Icon name="film" size={29}/></span>}
    {url && status!=='failed' && <img className={`thumbnail${status==='ready'?' thumbnail-ready':''}`} src={url} alt="" loading="lazy" decoding="async"
      onLoad={event=>setResult({url,retryKey,status:event.currentTarget.naturalWidth>0?'ready':'failed'})} onError={()=>setResult({url,retryKey,status:'failed'})}/>}
  </>;
}
