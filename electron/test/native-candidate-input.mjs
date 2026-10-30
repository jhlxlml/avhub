// Test-only runtime override. This module is never packaged or exposed over IPC.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
export function candidateRuntime(root,selection){
 if(!selection)return null;
 if(/^mpv-desktop-runtime-[a-z0-9_]{8}$/.test(selection)){
  const runtime=path.join(root,'build',selection),manifest=JSON.parse(readFileSync(path.join(runtime,'runtime.json'),'utf8'));
  assert.equal(manifest.status,'source-built-candidate');assert.match(manifest.sourceCommit,/^[a-f0-9]{40}$/);
  for(const file of [{name:'mpv.exe',sha256:manifest.exeSha256},{name:'LICENSE.GPL',sha256:manifest.licenseSha256},...manifest.dependencies]){
   assert.match(file.name,/^[A-Za-z0-9_+.-]+$/);const target=path.join(runtime,file.name),stat=lstatSync(target);
   assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(realpathSync(target).toLowerCase(),target.toLowerCase());assert.equal(sha(target),file.sha256);
  }
  return {executable:path.join(runtime,'mpv.exe'),tag:'source-built',sourceCommit:manifest.sourceCommit};
 }
 assert.equal(selection,'stable-0.41.0','Only the explicitly catalogued candidate may be tested');
 const manifest=JSON.parse(readFileSync(path.join(root,'ci/mpv-stable-candidate.json'),'utf8'));
 const folder=path.join(root,'build/mpv-stable-candidate'),runtime=path.join(folder,'verified-runtime');
 const addressed=path.join(folder,manifest.archiveSha256+'.zip');
 assert.equal(sha(lstatOrNull(addressed)?addressed:path.join(folder,'runtime.zip')),manifest.archiveSha256);
 assert.equal(sha(path.join(folder,'unpacked',manifest.innerArchive.name)),manifest.innerArchive.sha256);
 assert.deepEqual(readdirSync(runtime).filter(n=>/\.(exe|dll)$/i.test(n)).sort(),manifest.files.map(f=>f.name).sort());
 for(const file of manifest.files){
  assert.match(file.name,/^[a-zA-Z0-9_+.-]+\.(exe|dll)$/);assert.match(file.sha256,/^[a-f0-9]{64}$/);
  const target=path.join(runtime,file.name),stat=lstatSync(target);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
  assert.equal(realpathSync(target).toLowerCase(),target.toLowerCase());assert.equal(stat.size,file.size);assert.equal(sha(target),file.sha256);
 }
 return {executable:path.join(runtime,'mpv.exe'),tag:manifest.releaseTag,sourceCommit:manifest.sourceCommit};
}
function lstatOrNull(file){try{return lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
