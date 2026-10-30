// Offline verification only. Never downloads, packages, publishes or rewrites a
// sign-off. Release readiness is deliberately separate from decoder unit tests.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync,openSync,readSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {validateMpvManifest,distributionProblems} from './mpv-readiness-policy.mjs';
const root=path.resolve(import.meta.dirname,'..');
function digest(file){
 const descriptor=openSync(file,'r'),hash=createHash('sha256'),chunk=Buffer.allocUnsafe(1024*1024);
 try{let count;while((count=readSync(descriptor,chunk,0,chunk.length,null))>0)hash.update(chunk.subarray(0,count));return hash.digest('hex');}finally{closeSync(descriptor);}
}
const manifest=JSON.parse(readFileSync(path.join(root,'electron/mpv-runtime.json'),'utf8'));
validateMpvManifest(manifest);
const manifestOnly=process.argv.includes('--manifest-only'),release=process.argv.includes('--release');
if(release&&manifestOnly)throw new Error('Release verification cannot skip runtime files');
if(!process.argv.includes('--manifest-only')){
  for(const [file,key] of [['mpv.exe','exeSha256'],['LICENSE.GPL','licenseSha256']])assert.equal(digest(path.join(root,'bin/mpv',file)),manifest[key],`${file} checksum mismatch`);
}
let evidence;try{evidence=JSON.parse(readFileSync(path.join(root,'electron/mpv-distribution.json'),'utf8'));}catch{}
const problems=distributionProblems(manifest,evidence,(file,role)=>{
 if(path.isAbsolute(file.path)||file.path.includes('\\')||file.path.split('/').some(p=>!p||p==='.'||p==='..'))return false;
 const target=path.resolve(root,file.path),relative=path.relative(root,target),info=lstatSync(target);
 if(relative.startsWith('..')||path.isAbsolute(relative)||!info.isFile()||info.isSymbolicLink()||realpathSync(target).toLowerCase()!==target.toLowerCase())return false;
 if(digest(target)!==file.sha256)return false;
 if(role.endsWith('Acceptance')){
  if(info.size>4*1024*1024)return false;
  const report=JSON.parse(readFileSync(target,'utf8'));
  return report.completed===true&&report.cleanExit===true&&report.sourceUnchanged===true&&report.runtime?.exeSha256===manifest.exeSha256&&report.runtime?.licenseSha256===manifest.licenseSha256;
 }
 return true;
});
console.log(JSON.stringify({status:manifest.status,runtimeVerified:!manifestOnly,distributionReady:!manifestOnly&&problems.length===0,declaredDistributionReady:manifest.distributionReady,releaseBlockers:problems},null,2));
if(release&&problems.length)process.exitCode=1;
