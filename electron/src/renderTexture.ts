import {app,sharedTexture,ipcMain,type WebContents} from 'electron';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import type {NativeRenderFrame} from './renderHostClient';
import {resolveRenderRuntime} from './renderRuntimeLayout';
import {playbackClock} from './playbackClock';

function verifiedFfi(root:string){
 const layout=resolveRenderRuntime(root,app.isPackaged,process.resourcesPath),base=layout.ffiBase,manifest=JSON.parse(readFileSync(layout.ffiManifest,'utf8'));
 if(manifest.version!=='3.3.4'||manifest.platform!=='win32-x64'||process.platform!=='win32'||process.arch!=='x64')throw new Error('原生纹理桥接平台未验证');
 for(const item of manifest.files){const file=path.resolve(base,item.name);if(!file.startsWith(base+path.sep))throw new Error('无效桥接运行库');for(let p=file;p!==base;p=path.dirname(p))if(lstatSync(p).isSymbolicLink())throw new Error('桥接运行库不能重定向');const bytes=readFileSync(file);if(bytes.length!==item.size||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('桥接运行库完整性校验失败');}
 const ffi=require(path.join(base,'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'));if(ffi.version!==manifest.version)throw new Error('桥接版本不符');return ffi;
}
/** Main-process NT lease. Never send a handle or FFI object to the renderer. */
export class RenderTextureBridge {
 private clock:ReturnType<typeof playbackClock>;
 private api:any;private lease:{source:string;handle:bigint;buffer:Buffer}|null=null;private resources=new Set<Promise<void>>();private receipts=new Map<string,{resolve:(at:number)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;serial:number}>();private closed=false;
 readonly stats={imports:0,released:0,leases:0,closedLeases:0,gpuCompletions:0};
 private receive=(event:Electron.IpcMainEvent,value:any)=>{if(event.sender!==this.web||event.senderFrame!==this.web.mainFrame||!value||value.session!==this.session)return;const pending=this.receipts.get(value.token);if(!pending||pending.serial!==value.serial)return;clearTimeout(pending.timer);this.receipts.delete(value.token);if(value.ok===true){this.stats.gpuCompletions++;pending.resolve(performance.now());}else pending.reject(new Error('原生画面 GPU 提交失败'));};
 constructor(private web:WebContents,private pid:number,private session:string,root:string){
  const ffi=verifiedFfi(root),lib=ffi.load('kernel32.dll');this.api={self:lib.func('void * __stdcall GetCurrentProcess()'),open:lib.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),duplicate:lib.func('int __stdcall DuplicateHandle(void *source, void *handle, void *target, _Out_ void **copy, uint32_t access, int inherit, uint32_t flags)'),close:lib.func('int __stdcall CloseHandle(void *handle)')};ipcMain.on('avhub:render-frame-done',this.receive);
  const mm=ffi.load('winmm.dll');this.clock=playbackClock(mm.func('uint32_t __stdcall timeBeginPeriod(uint32_t)') as (period:number)=>number,mm.func('uint32_t __stdcall timeEndPeriod(uint32_t)') as (period:number)=>number);
 }
 setClockActive(playing:boolean){this.clock.setActive(playing&&!this.closed);}
 clockState(){return this.clock.snapshot();}
 private acquire(source:string,generation=0){
  if(this.closed||!/^\d{1,20}$/.test(source)||BigInt(source)<=0n||BigInt(source)>0x7fffffffffffffffn)throw new Error('无效原生共享纹理');
  const key=`${generation}:${source}`;
  if(this.lease){
   if(this.lease.source===key)return Buffer.from(this.lease.buffer);
   if(this.resources.size||this.receipts.size)throw new Error('旧共享表面的 GPU 读者尚未释放');
   if(!this.api.close(this.lease.handle))throw new Error('无法释放旧共享纹理句柄');this.lease=null;this.stats.closedLeases++;
  }
  const processHandle=this.api.open(0x40,0,this.pid);if(!processHandle)throw new Error('无法访问所属原生进程');const copy=[null];let failure:Error|undefined;
  try{if(!this.api.duplicate(processHandle,BigInt(source),this.api.self(),copy,0,0,2)||!copy[0])throw new Error('无法复制共享纹理句柄');}catch(e){failure=e as Error;}
  if(!this.api.close(processHandle))failure??=new Error('无法释放原生进程句柄');if(failure){if(copy[0])this.api.close(copy[0]);throw failure;}
  const handle=BigInt(copy[0]!),buffer=Buffer.alloc(8);buffer.writeBigUInt64LE(handle);this.lease={source:key,handle,buffer};this.stats.leases++;return Buffer.from(buffer);
 }
 async present(frame:NativeRenderFrame,surface:string){
  if(this.closed||this.web.isDestroyed()||frame.pixelFormat!=='rgbaf16'||frame.error)throw new Error('原生纹理不可呈现');
  const handle=this.acquire(frame.handle,frame.surfaceGeneration),token=randomBytes(16).toString('hex');let released!:()=>void;const resource=new Promise<void>(r=>released=r);this.resources.add(resource);
  let texture:ReturnType<typeof sharedTexture.importSharedTexture>;
  const transfer=frame.outputTransfer??'srgb',hdr=transfer==='pq'||transfer==='hlg';
  // Chromium's floating-point external-texture path does not reliably decode
  // PQ/HLG. Carry numeric RGB codes through a linear BT.709 carrier instead;
  // preload explicitly decodes the actual BT.2020 HDR payload. This carrier is
  // never presented directly, nor written back as source colour metadata.
  try{texture=sharedTexture.importSharedTexture({textureInfo:{pixelFormat:'rgbaf16',codedSize:{width:frame.width,height:frame.height},colorSpace:{primaries:'bt709',transfer:hdr?'linear':transfer,matrix:'rgb',range:'full'},handle:{ntHandle:handle},timestamp:Math.round(frame.positionSec*1e6)},allReferencesReleased:()=>{this.stats.released++;this.resources.delete(resource);released();}});this.stats.imports++;}
  catch(error){this.resources.delete(resource);released();throw error;}
  const receipt=new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>{this.receipts.delete(token);reject(new Error('未收到原生画面 GPU 完成确认'));},5000);this.receipts.set(token,{resolve,reject,timer,serial:frame.serial});});
  // Register a rejection observer before sending; late renderer failure must
  // never become an unhandled rejection while the transport is awaiting IPC.
  void receipt.catch(()=>{});
  try{await sharedTexture.sendSharedTexture({frame:this.web.mainFrame,importedSharedTexture:texture},{session:this.session,surface,serial:frame.serial,token,width:frame.width,height:frame.height,outputTransfer:transfer});}
  finally{texture.release();}
  // GPU completion does not guarantee that Chromium released every reader.
  // Bound this second wait too, without removing the still-live resource or
  // acknowledging the native surface when its release callback is missing.
  let releaseTimer:ReturnType<typeof setTimeout>|undefined;
  try{
   const [gpuAt]=await Promise.all([receipt,Promise.race([resource,new Promise<never>((_,reject)=>{releaseTimer=setTimeout(()=>reject(new Error('原生画面纹理引用释放超时')),5000);})])]);return {serial:frame.serial,positionSec:frame.positionSec,seekId:frame.seekId,gpuAt};
  }finally{clearTimeout(releaseTimer);}
 }
 async drain(){
  this.closed=true;this.clock.setActive(false);let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([Promise.all([...this.resources]),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('GPU 读者尚未释放，保留文件占用保护')),5000);})]);}finally{clearTimeout(timer);}
  if(this.lease){if(!this.api.close(this.lease.handle))throw new Error('无法释放共享纹理句柄');this.lease=null;this.stats.closedLeases++;}
  for(const p of this.receipts.values()){clearTimeout(p.timer);p.reject(new Error('原生画面已关闭'));}this.receipts.clear();ipcMain.removeListener('avhub:render-frame-done',this.receive);
 }
 invalidateReceiver(){this.closed=true;this.clock.setActive(false);for(const p of this.receipts.values()){clearTimeout(p.timer);p.reject(new Error('原生画面接收端已重建'));}this.receipts.clear();}
}
