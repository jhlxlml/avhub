// Build-only notice collection from the modules actually represented in JS
// output chunks. Does not add runtime code or change video/player behavior.
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';import {createHash} from 'node:crypto';

export function frontendNotices(root){
 return {name:'avhub-frontend-notices',generateBundle(_options,bundle){
  const lock=JSON.parse(readFileSync(path.join(root,'package-lock.json'),'utf8')),packages=new Map();
  const base=root.replaceAll('\\','/')+'/';
  for(const chunk of Object.values(bundle).filter(item=>item.type==='chunk')){
   for(const original of chunk.moduleIds){
    const id=original.replaceAll('\\','/').replaceAll('\0','').split('?')[0];
    if(!id.startsWith(base)||!id.includes('/node_modules/'))continue;
    const at=id.lastIndexOf('/node_modules/')+14,parts=id.slice(at).split('/');
    const directory=id.slice(0,at)+parts.slice(0,parts[0].startsWith('@')?2:1).join('/');
    if(!packages.has(directory)){
     const pkg=JSON.parse(readFileSync(path.join(directory,'package.json'),'utf8')),key=path.relative(root,directory).replaceAll('\\','/');
     if(pkg.version!==lock.packages[key]?.version)throw new Error('Bundled dependency differs from package lock: '+key);
     packages.set(directory,{name:pkg.name,version:pkg.version,license:pkg.license??'See notice text',chunks:[],notices:[]});
    }
    const item=packages.get(directory);if(!item.chunks.includes(chunk.fileName))item.chunks.push(chunk.fileName);
   }
  }
  if(!packages.size)throw new Error('No frontend dependencies found in output; notice graph must be checked');
  for(const [directory,item] of packages){
   const notices=readdirSync(directory,{withFileTypes:true}).filter(file=>file.isFile()&&/^(license|copying|notice)(\.|-|$)/i.test(file.name));
   if(!notices.length)throw new Error('Missing bundled dependency license: '+item.name);
   for(const file of notices){
    const content=readFileSync(path.join(directory,file.name));if(!content.toString('utf8').trim())throw new Error('Empty dependency license: '+item.name);
    const fileName=`third-party/npm/${item.name}/${item.version}/${file.name}`;
    item.notices.push({path:fileName,sha256:createHash('sha256').update(content).digest('hex')});this.emitFile({type:'asset',fileName,source:content});
   }
  }
  this.emitFile({type:'asset',fileName:'third-party/frontend-notices.json',source:JSON.stringify({schema:1,scope:'NPM modules represented in actual JS output chunks; locally adapted UI notices remain separate; not full application license/source approval',packages:[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name))},null,2)+'\n'});
 }};
}
