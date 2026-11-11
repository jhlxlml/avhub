import {createHash} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile,readdir,unlink,statfs} from 'node:fs/promises';
import path from 'node:path';

/** Call only before opening or after retiring the native host: no active cache reader. */
export async function prepareNativeShaderCache(dataRoot:string,phase:'open'|'closed'='open'){
 const directory=path.join(dataRoot,'native-shaders-v1'),marker=path.join(directory,'.avhub-owner.json'),indexFile=path.join(directory,'.avhub-integrity.json');
 const owner='{"owner":"avhub-native-shaders","schema":1}\n';
 const root=await lstat(dataRoot);if(!root.isDirectory()||root.isSymbolicLink())return;
 const created=await mkdir(directory,{recursive:true});
 const folder=await lstat(directory);if(!folder.isDirectory()||folder.isSymbolicLink())return;
 if(created)await writeFile(marker,owner,{flag:'wx'});
 const markerInfo=await lstat(marker);if(!markerInfo.isFile()||markerInfo.isSymbolicLink()||markerInfo.size>128||await readFile(marker,'utf8')!==owner)return;
 const content=await readdir(directory,{withFileTypes:true}),index=content.find(entry=>entry.name==='.avhub-integrity.json');
 if(index){const info=await lstat(indexFile);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)return;}
 const entries=content.filter(entry=>!['.avhub-owner.json','.avhub-integrity.json'].includes(entry.name));
 // Unknown objects are never adopted, traversed or removed.
 if(entries.length>4096||entries.some(entry=>!entry.isFile()||!/^[a-f0-9]{64}$/i.test(entry.name)))return;
 const files=await Promise.all(entries.map(async entry=>({name:entry.name,info:await lstat(path.join(directory,entry.name))})));
 if(files.some(file=>!file.info.isFile()||file.info.isSymbolicLink()))return;
 let bytes=files.reduce((sum,file)=>sum+file.info.size,0),count=files.length;
 const trimming=bytes>64*1024**2||count>512,removed=new Set<string>();
 // Reclaim only marked, idle shader entries; leave headroom for the next source.
 for(const file of files.sort((a,b)=>a.info.mtimeMs-b.info.mtimeMs)){
  if(file.info.size<=4*1024**2&&(!trimming||bytes<=48*1024**2&&count<=384))continue;
  await unlink(path.join(directory,file.name));bytes-=file.info.size;count--;removed.add(file.name);
 }
 let expected:Record<string,string>={};
 if(phase==='open'&&index){
  let parsed:unknown;try{parsed=JSON.parse(await readFile(indexFile,'utf8'));}catch{parsed=null;}
  if(parsed&&typeof parsed==='object'&&'schema'in parsed&&parsed.schema===1&&'files'in parsed&&parsed.files&&typeof parsed.files==='object'&&!Array.isArray(parsed.files)){
   const entries=Object.entries(parsed.files);
   if(entries.length<=512&&entries.every(([name,value])=>/^[a-f0-9]{64}$/i.test(name)&&typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)))expected=Object.fromEntries(entries) as Record<string,string>;
  }
 }
 const remaining=files.filter(file=>!removed.has(file.name)),verified:Record<string,string>={};
 for(let offset=0;offset<remaining.length;offset+=4){
  const hashes=await Promise.all(remaining.slice(offset,offset+4).map(async file=>({name:file.name,sha256:createHash('sha256').update(await readFile(path.join(directory,file.name))).digest('hex')})));
  for(const file of hashes){
   if(phase==='closed'||expected[file.name]===file.sha256)verified[file.name]=file.sha256;
   else await unlink(path.join(directory,file.name));
  }
 }
 // The host is retired before sealing. A torn or missing index merely causes
 // recompilation next time, never acceptance of unrecorded binary programs.
 await writeFile(indexFile,JSON.stringify({schema:1,files:verified})+'\n');
 const disk=await statfs(directory);if(disk.bavail*disk.bsize<256*1024**2)return;
 return directory;
}
