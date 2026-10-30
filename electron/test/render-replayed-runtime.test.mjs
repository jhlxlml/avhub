// Actual new closure identity and admission boundaries, not pixel acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url);
const {renderRuntimeLayout}=require('../dist/renderRuntimeLayout.js');
const {verifyRenderRuntime}=require('../dist/renderHostClient.js');
const {replayedRenderPin:pin}=require('../dist/replayedRenderPin.js');
const stage=JSON.parse(readFileSync(path.join(root,'build/replayed-render-staging.json'),'utf8')).folder;
const runtime=renderRuntimeLayout(root,false,'',path.basename(stage));

test('replayed closure is exactly pinned and remains explicit development only',async()=>{
 assert.deepEqual(pin,JSON.parse(readFileSync(path.join(root,'ci/replayed-render-runtime.json'),'utf8')));
 assert.ok(readFileSync(path.join(root,'electron/native/render/MpvCore.cs'),'utf8').includes('ReplayedDllHash="'+pin.dllSha256+'"'));
 assert.equal(runtime.replayedCandidate,true);
 assert.equal((await verifyRenderRuntime(runtime)).cohort,pin.id);
 assert.throws(()=>renderRuntimeLayout(root,true,'',path.basename(stage)),/发行验收/);
 assert.equal(renderRuntimeLayout(root,false,'').bundled,false);
 await assert.rejects(verifyRenderRuntime({...runtime,replayedCandidate:false}),/完整性/);
 await assert.rejects(verifyRenderRuntime({...runtime,selfBuiltCandidate:false}),/不一致/);
});

test('new closure cannot omit/change dependencies or declare distribution ready',async()=>{
 const original=JSON.parse(readFileSync(runtime.manifest,'utf8'));
 for(const mutate of [m=>m.dependencies.pop(),m=>m.dependencies[0].sha256='0'.repeat(64),
  m=>m.dependencies[0].name='../outside.dll',m=>m.cohort='old-or-unknown',m=>m.productionDistributionReady=true]){
  const manifest=structuredClone(original);mutate(manifest);
  const folder=mkdtempSync(path.join(root,'build/replayed-integrity-')),file=path.join(folder,'runtime.json');
  writeFileSync(file,JSON.stringify(manifest));await assert.rejects(verifyRenderRuntime({...runtime,manifest:file}));
 }
});

test('previous self-built cohort and native candidate pointers remain separate',()=>{
 const old=JSON.parse(readFileSync(path.join(root,'build/selfbuilt-render-staging.json'),'utf8')).folder;
 assert.notEqual(old,stage);
 assert.equal(renderRuntimeLayout(root,false,'',path.basename(old)).replayedCandidate,false);
 assert.equal(JSON.parse(readFileSync(path.join(root,'build/libmpv-windows-cross-latest.json'),'utf8')).folder.split(/[\\/]/).at(-1),'libmpv-windows-cross-06dva4ei');
});
