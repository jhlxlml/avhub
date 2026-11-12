import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {readFile,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {selfBuiltRenderPin} from './selfBuiltRenderPin';
import {replayedRenderPin} from './replayedRenderPin';
import {mkvIndexRenderPin} from './mkvIndexRenderPin';
import {renderHostTermination} from './renderHostTermination';

export type RenderSourceContract={width:number;height:number;sourceWidth?:number;sourceHeight?:number;depth:number;primaries:string;transfer:string;matrix:string;range:string;hdr:boolean};
export type NativeRenderFrame={serial:number;epoch:number;seekId:number;positionSec:number;seekTiming?:{seekEventMs:number|null;restartMs:number|null;nativeFrameMs:number;nativeQueueMs?:number;exactFallback?:boolean;cacheWaitMs:number;corrections:number;correctionMs:number|null};handle:string;surfaceGeneration?:number;width:number;height:number;pixelFormat:'rgba'|'rgbaf16';outputTransfer?:'srgb'|'pq'|'hlg';waiting:true;error:string|null};
export type NativeRenderProperties=Record<string,unknown>;
export type NativeRenderSnapshot={loaded:boolean;error:string|null;properties:NativeRenderProperties;frame:NativeRenderFrame|{waiting:false;error:string|null};adapter:string|null};
type Runtime={host:string;dll:string;manifest:string;root:string;bundled?:boolean;selfBuiltCandidate?:boolean;replayedCandidate?:boolean};
type Pending={resolve:(value:any)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>};
const dllSha256='ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74';
const sourceNames=['electron/native/render/MpvCore.cs','electron/native/render/D3dSurface.cs','electron/native/render/RenderHost.cs','electron/native/render/DisplayProbe.cs'];
async function checkedFile(file:string){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>65536)throw new Error('原生渲染构建清单无效');return readFile(file);}
async function checkedHash(file:string){
 const before=await lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.size>1024**3)throw new Error('原生渲染运行库文件无效');
 const hash=createHash('sha256');for await(const bytes of createReadStream(file,{highWaterMark:1024**2}))hash.update(bytes);
 const after=await lstat(file);if(after.isSymbolicLink()||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw new Error('原生运行库在校验中发生变化');return hash.digest('hex');
}
function fileIdentities(value:unknown):value is {name:string;sha256:string}[]{
 return Array.isArray(value)&&value.every((file:unknown)=>{
  if(!file||typeof file!=='object')return false;
  return 'name'in file&&typeof file.name==='string'&&'sha256'in file&&typeof file.sha256==='string'&&/^[a-f0-9]{64}$/.test(file.sha256);
 });
}
/** Runtime consistency checks, not a signature or a redistribution approval. */
const verifyingRuntimes=new Map<string,ReturnType<typeof checkRenderRuntime>>();
export function verifyRenderRuntime(runtime:Runtime){
 const key=JSON.stringify([runtime.host,runtime.dll,runtime.manifest,runtime.root,runtime.bundled===true,runtime.selfBuiltCandidate===true,runtime.replayedCandidate===true]);
 const pending=verifyingRuntimes.get(key);if(pending)return pending;
 const task=checkRenderRuntime(runtime);verifyingRuntimes.set(key,task);
 // Coalesce only work still running. Never cache a successful verification;
 // the next open must perform all hashes again after this task settles.
 void task.finally(()=>{if(verifyingRuntimes.get(key)===task)verifyingRuntimes.delete(key);}).catch(()=>{});return task;
}
async function checkRenderRuntime(runtime:Runtime){
 if(process.platform!=='win32'||process.arch!=='x64')throw new Error('当前系统尚未验证原生嵌入播放');
 const parsed:unknown=JSON.parse((await checkedFile(runtime.manifest)).toString('utf8'));
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('原生渲染构建清单无效');
 const info=parsed as Record<string,unknown>;
 const candidatePin=runtime.replayedCandidate?(info.cohort===mkvIndexRenderPin.id?mkvIndexRenderPin:replayedRenderPin):selfBuiltRenderPin;
 if(runtime.replayedCandidate&&!runtime.selfBuiltCandidate)throw new Error('重建候选选择不一致');
 const expectedDll=runtime.selfBuiltCandidate?candidatePin.dllSha256:dllSha256;
 if(info.protocol!==1||info.platform!=='win32-x64'||info.dllSha256!==expectedDll||await checkedHash(runtime.host)!==info.hostSha256||await checkedHash(runtime.dll)!==expectedDll)throw new Error('原生嵌入运行库未通过完整性校验');
 const sources=info.sources;
 if(!fileIdentities(sources)||sources.length!==sourceNames.length)throw new Error('原生渲染构建信息不完整');
 const dependencies=info.dependencies??[];
 if(!fileIdentities(dependencies))throw new Error('原生依赖构建信息无效');
 if(runtime.selfBuiltCandidate){
  if(!runtime.bundled||info.cohort!==candidatePin.id||info.productionDistributionReady!==false||dependencies.length!==candidatePin.dependencies.length)throw new Error('自建原生候选清单不匹配');
  if(dependencies.some((file,i)=>file.name!==candidatePin.dependencies[i].name||file.sha256!==candidatePin.dependencies[i].sha256))throw new Error('自建原生依赖未通过完整性校验');
  // Keep every hash check, with at most four active file readers. Settle each
  // batch before propagating failure; no reader survives verification return.
  for(let offset=0;offset<dependencies.length;offset+=4){
   const checked=await Promise.allSettled(dependencies.slice(offset,offset+4).map(async file=>{
    if(await checkedHash(path.join(path.dirname(runtime.dll),file.name))!==file.sha256)throw new Error('自建原生依赖未通过完整性校验');
   }));
   const failed=checked.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  }
 }else if(runtime.bundled){
  const loader=dependencies.find(file=>file.name==='vulkan-1.dll');
  if(dependencies.length!==1||loader?.sha256!=='e1fcfc9489beefa6a6d9d11d6c7517f6a2b7f16e0d3fb8f4103bee0210f314a3'||await checkedHash(path.join(path.dirname(runtime.dll),'vulkan-1.dll'))!==loader.sha256)throw new Error('原生 Vulkan 运行库未通过完整性校验');
 }
 for(const [i,name] of sourceNames.entries())if(sources[i].name!==name||await checkedHash(path.join(runtime.root,name))!==sources[i].sha256)throw new Error('原生渲染源码已有变化，请重新编译宿主');
 return info;
}

/** Trusted-main-only typed pipe. No shell, URLs, renderer paths, or libmpv API
 * pointers cross public IPC. A failed command pipe retires the entire host. */
export class RenderHostClient extends EventEmitter {
 // Prefer real ready hints; old hosts retain the polling fallback until one
 // is actually observed. Explicit 0 restores the legacy path for diagnosis.
 private readonly frameNotifications=process.env.AVHUB_RENDER_FRAME_NOTIFICATIONS!=='0';private lastReadySerial=0;private readyNotifications=0;
 get frameNotificationsActive(){return this.frameNotifications&&this.lastReadySerial>0;}
 frameNotificationStats(){return {requested:this.frameNotifications,received:this.readyNotifications,lastSerial:this.lastReadySerial};}
 private child:ChildProcessWithoutNullStreams|null=null;private pending=new Map<number,Pending>();private sequence=0;private bytes=Buffer.alloc(0);
 private failure:Error|null=null;private stopping:Promise<void>|null=null;private opening:Promise<void>|null=null;private retired=false;private exited:Promise<void>=Promise.resolve();private exitCode:number|null|undefined;
 private stderrBytes=0;private stderrTail='';private spawnError:string|null=null;
 readonly startupTimings:{verificationMs:number|null;hostOpenMs:number|null;native:Record<string,number>|null}={verificationMs:null,hostOpenMs:null,native:null};
 get pid(){return this.child?.pid??0;}get alive(){return Boolean(this.child)&&this.exitCode===undefined;}
 constructor(private runtime:Runtime,private readers:{drain:()=>Promise<void>},private timeoutMs?:number){super();}
 open(source:{path:string;contract?:RenderSourceContract;startSec:number;autoplay:boolean;windowHandle?:string;shaderCache?:string}):Promise<void>{
  if(this.child||this.opening||this.retired)return Promise.reject(new Error('原生宿主不能重复打开'));
  const task=this.start(source);this.opening=task;void task.finally(()=>{if(this.opening===task)this.opening=null;}).catch(()=>{});return task;
 }
 private async start(source:{path:string;contract?:RenderSourceContract;startSec:number;autoplay:boolean;windowHandle?:string;shaderCache?:string}){
  const verificationStarted=performance.now();await verifyRenderRuntime(this.runtime);this.startupTimings.verificationMs=performance.now()-verificationStarted;if(this.retired)throw new DOMException('原生打开已取消','AbortError');
  const c=source.contract;if(!path.isAbsolute(source.path)||!Number.isFinite(source.startSec)||source.startSec<0||source.startSec>Number.MAX_VALUE||typeof source.autoplay!=='boolean')throw new Error('无效原生源');
  const hostStarted=performance.now();
  const child=spawn(this.runtime.host,[this.runtime.dll],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});this.child=child;
  this.exited=new Promise(resolve=>{
   child.once('error',(error:NodeJS.ErrnoException)=>{this.spawnError=error.code??'UNKNOWN';this.fail(new Error('原生渲染宿主未能启动'));if(!child.pid){this.exitCode=null;resolve();}});
   child.once('exit',(code)=>{this.exitCode=code;this.fail(new Error('原生渲染宿主已退出'));resolve();});
  });
  child.once('close',(code,signal)=>this.emit('diagnostic',renderHostTermination(code,signal,this.stderrTail,this.stderrBytes,this.spawnError)));
  child.stdout.on('data',(chunk:Buffer)=>this.accept(chunk));child.stdout.on('error',()=>this.fail(new Error('原生状态管道异常')));
  child.stdin.on('error',()=>this.fail(new Error('原生控制管道异常')));child.stderr.on('data',(chunk:Buffer)=>{this.stderrBytes+=chunk.length;this.stderrTail=(this.stderrTail+chunk.toString('utf8')).slice(-4096);if(this.stderrBytes>64*1024)this.fail(new Error('原生宿主错误输出超过限制'));});child.stderr.on('error',()=>{});
  const response:unknown=await this.send('open',{path:source.path,...c,startSec:source.startSec,autoplay:source.autoplay,windowHandle:source.windowHandle??'0',...(this.frameNotifications?{frameNotifications:true}:{}),...(source.shaderCache?{shaderCache:source.shaderCache}:{})});this.startupTimings.hostOpenMs=performance.now()-hostStarted;
  if(response&&typeof response==='object'&&'startupMs'in response){
   const timings=response.startupMs;
   if(!timings||typeof timings!=='object'||Array.isArray(timings))throw new Error('原生启动计时无效');
   const entries=Object.entries(timings);
   if(entries.length>12||entries.some(([key,value])=>!['dllHashMs','loadLibraryMs','apiOptionsMs','initializeMs','observeMs','coreMs','rendererReadyMs','deviceReadyMs','renderContextMs','loadCommandMs'].includes(key)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>90000))throw new Error('原生启动计时无效');
   this.startupTimings.native=Object.fromEntries(entries) as Record<string,number>;
  }
 }
 private accept(chunk:Buffer){
  if(this.failure)return;
  if(this.bytes.length+chunk.length>512*1024){this.fail(new Error('原生状态响应超过限制'));return;}
  this.bytes=Buffer.concat([this.bytes,chunk]);let at:number;
  while((at=this.bytes.indexOf(10))>=0){const line=this.bytes.subarray(0,at);this.bytes=this.bytes.subarray(at+1);try{
   if(line.length>262144)throw new Error();const response=JSON.parse(line.toString('utf8'));
   if(response?.event!==undefined){
    if(!this.frameNotifications||response.event!=='frame-ready'||Object.keys(response).length!==2||!Number.isSafeInteger(response.serial)||response.serial<1)throw new Error();
    if(!this.retired&&response.serial>this.lastReadySerial){this.lastReadySerial=response.serial;this.readyNotifications++;this.emit('frame-ready',response.serial);}continue;
   }
   if(!Number.isSafeInteger(response.id))throw new Error();const pending=this.pending.get(response.id);if(!pending)continue;
   this.pending.delete(response.id);clearTimeout(pending.timer);response.error?pending.reject(new Error(String(response.error).slice(0,200))):pending.resolve(response.result);
  }catch{this.fail(new Error('原生状态协议无效'));return;}}
 }
 private fail(error:Error){if(this.failure)return;this.failure=error;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.bytes=Buffer.alloc(0);if(!this.stopping)this.emit('failure',error);if(this.alive)this.child!.kill();}
 private send(action:string,extra:Record<string,unknown>={}):Promise<any>{
  if(this.failure||!this.child||!this.alive)return Promise.reject(this.failure??new Error('原生宿主不可用'));
  if(this.pending.size>=32)return Promise.reject(new Error('原生请求队列已满'));
  const id=++this.sequence;const payload=JSON.stringify({...extra,id,action})+'\n';if(Buffer.byteLength(payload)>16384)return Promise.reject(new Error('原生控制请求超过限制'));
  const timeout=this.timeoutMs??(['open','screenshot'].includes(action)?30000:10000);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(new Error('原生控制超时：'+action)),timeout);this.pending.set(id,{resolve,reject,timer});this.child!.stdin.write(payload,error=>{if(error)this.fail(new Error('原生控制写入失败'));});});
 }
 snapshot():Promise<NativeRenderSnapshot>{return this.send('snapshot');}
 frame():Promise<NativeRenderSnapshot['frame']>{return this.send('frame');}
 display():Promise<any>{return this.send('display');}
 // Trusted main-process diagnostics only; never exposed as arbitrary IPC.
 resources():Promise<any>{return this.send('resources');}
 acknowledge(serial:number){if(!Number.isSafeInteger(serial)||serial<1)return Promise.reject(new Error('无效纹理代次'));return this.send('ack',{value:serial});}
 control(action:'play'|'pause'|'seek'|'cancel-seek'|'volume'|'mute'|'rate'|'track'|'subtitle-delay',value?:unknown){if(this.retired)return Promise.reject(new Error('原生宿主正在关闭'));return this.send(action,{value});}
 // These accept trusted main-process resolutions only, never renderer paths.
 addAuthorizedSubtitle(file:string){if(this.retired)return Promise.reject(new Error('原生宿主正在关闭'));return this.send('subtitle-add',{value:file});}
 captureOwnedPng(file:string){if(this.retired)return Promise.reject(new Error('原生宿主正在关闭'));return this.send('screenshot',{value:file});}
 setSubtitleStyle(value:{size:number;color:string;background:number}){if(this.retired)return Promise.reject(new Error('原生宿主正在关闭'));return this.send('subtitle-style',{value});}
 close(){
  if(this.stopping)return this.stopping;this.retired=true;
  const task=(async()=>{await this.opening?.catch(()=>{});if(this.alive&&!this.failure)await this.send('quiesce');await this.readers.drain();if(this.alive&&!this.failure){const frame=await this.frame();if(frame.waiting)await this.acknowledge(frame.serial);await this.send('quit');}if(this.alive){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([this.exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{this.fail(new Error('原生宿主退出超时'));reject(new Error('原生宿主仍在退出，保留文件占用保护'));},5000);})]);}finally{clearTimeout(timer);}}await this.exited;})();
  this.stopping=task;void task.catch(()=>{if(this.stopping===task)this.stopping=null;});return task;
 }
}
