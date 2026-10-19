import {mkdir,mkdtemp,lstat,realpath,statfs,stat,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import type {MpvClient} from './mpvClient';
type Dependencies={data:()=>string;origin:()=>string;token:()=>string;log:(value:string)=>void};
/** Shared original-resolution PNG publication, independent of window layout. */
export async function captureNativeFrame(deps:Dependencies,active:{client:MpvClient;mediaId:number},frameSaved:()=>void=()=>{}){
  const started=performance.now(),snapshot=active.client.snapshot;let directory:string|undefined;
  try{
    if(!['ready','ended'].includes(snapshot.phase)||snapshot.pendingSeek!==null||snapshot.properties.seeking===true)throw new Error('画面尚未就绪或正在定位，请等待目标画面后截图');
    const parent=path.join(deps.data(),'native-captures');await mkdir(parent,{recursive:true});
    if((await lstat(parent)).isSymbolicLink()||await realpath(parent)!==path.join(await realpath(deps.data()),'native-captures'))throw new Error('原生截图暂存目录含外部链接，已停止写入');
    const params=snapshot.properties['video-params'] as {w?:number;h?:number}|undefined;
    if(!params?.w||!params.h||params.w*params.h>64*1024**2)throw new Error('画面尚未就绪或超过截图像素限制');
    const free=await statfs(parent);if(Number(free.bavail)*Number(free.bsize)<Math.max(256*1024**2,params.w*params.h*8))throw new Error('数据目录空间不足，未生成临时截图');
    directory=await mkdtemp(path.join(parent,'capture-'));const file=path.join(directory,'frame.png');
    const point=Number(await active.client.command(['get_property','time-pos'])),encodingStarted=performance.now();
    await active.client.command(['screenshot-to-file',file,'video'],30000);frameSaved();
    const encodingMs=performance.now()-encodingStarted,publishingStarted=performance.now();
    if((await stat(file)).size>128*1024**2)throw new Error('截图超过大小限制');
    const bytes=await readFile(file);
    const response=await fetch(`${deps.origin()}/api/media/${active.mediaId}/screenshot?time=${point}&capture_id=${randomBytes(16).toString('hex')}`,{method:'POST',headers:{'X-AVHub-Token':deps.token(),'Content-Type':'image/png'},body:bytes,signal:AbortSignal.timeout(30000)});
    const result=await response.json() as {detail?:string;filename?:string};if(!response.ok)throw new Error(result.detail||'截图保存失败');
    const timings={encodingMs,publishingMs:performance.now()-publishingStarted,totalMs:performance.now()-started};
    deps.log(`native-screenshot encoding_ms=${Math.round(timings.encodingMs)} publishing_ms=${Math.round(timings.publishingMs)} total_ms=${Math.round(timings.totalMs)} width=${params.w} height=${params.h}`);
    return {...result,timings};
  }finally{
    if(directory){const parent=path.join(await realpath(deps.data()),'native-captures');if(!(await lstat(directory)).isSymbolicLink()&&await realpath(directory)===path.join(parent,path.basename(directory)))await rm(directory,{recursive:true,force:true});else deps.log('native-screenshot-cleanup-refused ownership-changed');}
  }
}
