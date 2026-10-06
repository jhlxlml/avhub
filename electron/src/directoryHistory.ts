import {lstat,readFile,realpath,stat,open,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export type DirectoryPurpose='media'|'screenshots';
const stateName='avhub-directory-choices.json';
type Choices=Partial<Record<DirectoryPurpose,string>>;
async function load(dataDirectory:string):Promise<Choices> {
  try {
    const file=path.join(dataDirectory,stateName),info=await lstat(file);
    if(!info.isFile()||info.isSymbolicLink()||info.size>16384)return {};
    const value=JSON.parse(await readFile(file,'utf8'));
    if(value?.version!==1||!value.folders||typeof value.folders!=='object')return {};
    const result:Choices={};
    for(const key of ['media','screenshots'] as const) {
      const candidate=value.folders[key];
      if(typeof candidate==='string'&&candidate.length<=4096&&!/[\x00-\x1f]/.test(candidate)&&path.isAbsolute(candidate))result[key]=candidate;
    }
    return result;
  }catch{return {};}
}
export async function previousDirectory(dataDirectory:string,purpose:DirectoryPurpose):Promise<string|undefined> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const lookup=(async()=>{
      const value=(await load(dataDirectory))[purpose];if(!value)return undefined;
      const canonical=await realpath(value);return (await stat(canonical)).isDirectory()?canonical:undefined;
    })();
    return await Promise.race([lookup,new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),1500);})]);
  }catch{return undefined;}finally{if(timer)clearTimeout(timer);}
}
export async function rememberDirectory(dataDirectory:string,purpose:DirectoryPurpose,selected:string):Promise<void> {
  let temporary:string|undefined;
  try {
    const directory=await realpath(dataDirectory),canonical=await realpath(selected);
    if(!(await stat(canonical)).isDirectory())return;
    const destination=path.join(directory,stateName);
    try {const info=await lstat(destination);if(!info.isFile()||info.isSymbolicLink())return;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return;}
    const choices=await load(directory);choices[purpose]=canonical;
    temporary=path.join(directory,`.directory-choice-${randomUUID()}.tmp`);
    const writer=await open(temporary,'wx',0o600);
    try {await writer.writeFile(JSON.stringify({version:1,folders:choices}));await writer.sync();}finally{await writer.close();}
    await rename(temporary,destination);temporary=undefined;
  }catch{/* Directory selection must still work when its optional history cannot be saved. */}
  finally{if(temporary)await unlink(temporary).catch(()=>{});}
}
