import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,rename,readFile} from 'node:fs/promises';
import path from 'node:path';
const {NativeRuntime}=createRequire(import.meta.url)('../dist/nativeRuntime.js');
const root=path.resolve(import.meta.dirname,'../..');
async function fixture(){
 const folder=await mkdtemp(path.join(root,'build','runtime-contract-')),exe=path.join(folder,'mpv.exe'),license=path.join(folder,'LICENSE.GPL'),manifest=path.join(folder,'runtime.json');
 const hash=v=>createHash('sha256').update(v).digest('hex');
 await writeFile(exe,'test fixture only');await writeFile(license,'test license');
 await writeFile(manifest,JSON.stringify({schema:1,exeSha256:hash('test fixture only'),licenseSha256:hash('test license'),distributionReady:false}));
 return {folder,exe,license,manifest,runtime:new NativeRuntime(()=>exe,manifest,'win32')};
}
test('verified runtime detection coalesces, caches and retains distribution gate',async()=>{
 const {runtime}=await fixture(),results=await Promise.all(Array.from({length:8},()=>runtime.check()));
 for(const result of results){assert.equal(result.available,true);assert.equal(result.distributionReady,false);}
 assert.equal(results[0],results[7]);assert.equal((await runtime.check()).runtimeState,'ready');
});
test('modified executable, missing license and malformed manifest cannot enable playback',async()=>{
 const f=await fixture();assert.equal((await f.runtime.check()).available,true);
 await writeFile(f.exe,'tampered fixture!');assert.equal((await f.runtime.check(true)).runtimeState,'invalid');
 await rename(f.license,path.join(f.folder,'missing-license'));assert.equal((await f.runtime.check()).runtimeState,'missing');
 const next=await fixture();await writeFile(next.manifest,'{}');assert.equal((await next.runtime.check()).available,false);
 assert.equal((await new NativeRuntime(()=>next.exe,next.manifest,'linux').check()).runtimeState,'unsupported');
});
test('an executable path pointing to a directory fails safely without launching it',async()=>{
 const f=await fixture(),directory=path.join(f.folder,'directory');await mkdir(directory);await writeFile(path.join(directory,'LICENSE.GPL'),'test license');
 assert.equal((await new NativeRuntime(()=>directory,f.manifest,'win32').check()).available,false);
});

test('a source-built runtime validates its dynamic dependencies and rejects escaping names',async()=>{
 const f=await fixture(),dll=path.join(f.folder,'lua51.dll');await writeFile(dll,'owned fake dll');
 const manifest=JSON.parse(await readFile(f.manifest,'utf8'));
 manifest.dependencies=[{name:'lua51.dll',size:14,sha256:createHash('sha256').update('owned fake dll').digest('hex')}];
 await writeFile(f.manifest,JSON.stringify(manifest));assert.equal((await f.runtime.check()).available,true);
 await writeFile(dll,'other fake dll');assert.equal((await f.runtime.check(true)).runtimeState,'invalid');
 manifest.dependencies[0].name='../lua51.dll';await writeFile(f.manifest,JSON.stringify(manifest));assert.equal((await f.runtime.check()).runtimeState,'invalid');
});
