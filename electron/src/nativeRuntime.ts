import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';

export type RuntimeStatus={available:boolean;runtimeState:'ready'|'missing'|'invalid'|'unsupported';reason:string;distributionReady:boolean};
const unavailable=(runtimeState:RuntimeStatus['runtimeState'],reason:string):RuntimeStatus=>({available:false,runtimeState,reason,distributionReady:false});
const canonical=(p:string)=>path.resolve(p).toLowerCase();
async function fingerprint(file:string,max:number){
 const info=await lstat(file,{bigint:true});
 if(!info.isFile()||info.isSymbolicLink()||info.size===0n||info.size>BigInt(max)||canonical(await realpath(file))!==canonical(file))throw new Error('invalid file');
 return [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
}
async function digest(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}

// Settings detection caches unchanged metadata. Launch owners pass force=true
// for a fresh full byte check; file timestamps alone cannot certify content.
export class NativeRuntime {
 private cached:{key:string;value:RuntimeStatus}|null=null;
 private pending=new Map<string,Promise<RuntimeStatus>>();
 constructor(private executable:()=>string,private manifest=path.join(__dirname,'../mpv-runtime.json'),private platform:string=process.platform){}
 async check(force=false):Promise<RuntimeStatus>{
  if(this.platform!=='win32')return unavailable('unsupported','MPV 原生播放目前仅支持 Windows');
  try{
   const exe=this.executable(),license=path.join(path.dirname(exe),'LICENSE.GPL');
   await fingerprint(this.manifest,1024*1024);
   const text=await readFile(this.manifest,'utf8'),manifest=JSON.parse(text);
   if(manifest.schema!==1||![manifest.exeSha256,manifest.licenseSha256].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))return unavailable('invalid','MPV 运行库校验清单无效');
   const dependencies:unknown=manifest.dependencies??[];
   if(!Array.isArray(dependencies)||!dependencies.every((file:unknown):file is {name:string;sha256:string;size:number}=>{
    if(!file||typeof file!=='object')return false;
    return 'name' in file&&typeof file.name==='string'&&/^[A-Za-z0-9_+.-]+\.dll$/.test(file.name)&&
     'sha256' in file&&typeof file.sha256==='string'&&/^[a-f0-9]{64}$/.test(file.sha256)&&
     'size' in file&&typeof file.size==='number'&&Number.isSafeInteger(file.size)&&file.size>0&&file.size<=512*1024*1024;
   })||new Set(dependencies.map(file=>file.name.toLowerCase())).size!==dependencies.length)return unavailable('invalid','MPV 依赖清单无效');
   const files=[{path:exe,max:512*1024*1024,sha256:manifest.exeSha256},{path:license,max:4*1024*1024,sha256:manifest.licenseSha256},
    ...dependencies.map(file=>({path:path.join(path.dirname(exe),file.name),max:file.size,sha256:file.sha256}))];
   const fingerprints=await Promise.all(files.map(file=>fingerprint(file.path,file.max)));
   const key=JSON.stringify([exe,text,...fingerprints]);
   if(!force&&this.cached?.key===key)return this.cached.value;
   const pending=this.pending.get(key);if(pending)return pending;
   if(this.pending.size)return unavailable('invalid','MPV 运行库在检测期间发生变化，请稍后重新检测');
   const task=(async()=>{
    const hashes=await Promise.all(files.map(file=>digest(file.path)));
    const after=await Promise.all(files.map(file=>fingerprint(file.path,file.max)));
    if(after.some((v,i)=>v!==fingerprints[i]))return unavailable('invalid','MPV 运行库在校验期间发生变化，请重新检测');
    if(hashes.some((hash,i)=>hash!==files[i].sha256)){
     const value=unavailable('invalid','MPV 运行库或许可文件校验失败，请重新准备完整运行库');this.cached={key,value};return value;
    }
    const value:RuntimeStatus={available:true,runtimeState:'ready',reason:'MPV 运行库完整性校验通过',distributionReady:manifest.distributionReady===true};
    this.cached={key,value};return value;
   })();this.pending.set(key,task);
   try{return await task;}finally{this.pending.delete(key);}
  }catch(error){return (error as NodeJS.ErrnoException).code==='ENOENT'?unavailable('missing','MPV 运行库或配套文件缺失'):unavailable('invalid','MPV 运行库无法验证，请重新准备完整运行库');}
 }
}
