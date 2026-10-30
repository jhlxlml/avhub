// Actual binary identities + negative manifest contracts, not pixel acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const {renderRuntimeLayout}=require('../dist/renderRuntimeLayout.js');
const {verifyRenderRuntime}=require('../dist/renderHostClient.js');
const {selfBuiltRenderPin:pin}=require('../dist/selfBuiltRenderPin.js');
const stage=JSON.parse(readFileSync(path.join(root,'build/selfbuilt-render-staging.json'),'utf8')).folder;
const runtime=renderRuntimeLayout(root,false,'',path.basename(stage));
test('cohort pin agrees with review record and native host; ordinary defaults stay old',()=>{
 assert.deepEqual(pin,JSON.parse(readFileSync(path.join(root,'ci/self-built-render-runtime.json'),'utf8')));
 assert.ok(readFileSync(path.join(root,'electron/native/render/MpvCore.cs'),'utf8').includes('SelfBuiltDllHash="'+pin.dllSha256+'"'));
 assert.equal(renderRuntimeLayout(root,false,'').selfBuiltCandidate,undefined);
 assert.throws(()=>renderRuntimeLayout(root,true,'',path.basename(stage)),/发行验收/);
});
test('explicit staged self-built candidate passes exact identity verification',async()=>{
 assert.equal((await verifyRenderRuntime(runtime)).cohort,pin.id);
 await assert.rejects(verifyRenderRuntime({...runtime,selfBuiltCandidate:false}),/完整性/);
});

test('source and support notice inventory stays honest and matches staged bytes',()=>{
 const materials=JSON.parse(readFileSync(path.join(stage,'materials.json'),'utf8'));
 const layout=JSON.parse(readFileSync(path.join(stage,'layout.json'),'utf8'));
 assert.equal(materials.distributionReady,false);
 assert.equal(materials.supportRuntime.correspondingSourceComplete,false);
 assert.equal(materials.supportRuntime.verifiedDlls,4);
 assert.equal(materials.sourceArchives.length,21);
 assert.ok(materials.releaseBlockers.length>0);
 const expected=['materials/notices/avhub/LICENSE','materials/notices/gcc-mingw-w64-base/copyright','materials/notices/mingw-w64-common/copyright'];
 for(const name of expected){
  const record=layout.files.find(file=>file.path===name);assert.ok(record);
  assert.equal(createHash('sha256').update(readFileSync(path.join(stage,name))).digest('hex'),record.sha256);
 }
 const support=JSON.parse(readFileSync(path.join(stage,materials.supportRuntime.report),'utf8'));
 assert.equal(support.cohort,pin.id);assert.equal(support.distributionReady,false);
 assert.equal(support.files.filter(file=>file.name.endsWith('.dll')).length,4);
});
test('missing, substituted, extra dependencies and wrong cohort/approval cannot pass',async()=>{
 const original=JSON.parse(readFileSync(runtime.manifest,'utf8'));
 const mutations=[m=>m.dependencies.pop(),m=>m.dependencies[0].sha256='0'.repeat(64),
  m=>m.dependencies.push({name:'outside.dll',sha256:'0'.repeat(64)}),
  m=>m.dependencies[0].name='../elsewhere.dll',m=>m.cohort='unknown',m=>m.productionDistributionReady=true];
 for(const mutate of mutations){
  const manifest=structuredClone(original);mutate(manifest);
  const folder=mkdtempSync(path.join(root,'build/selfbuilt-integrity-')),file=path.join(folder,'runtime.json');
  writeFileSync(file,JSON.stringify(manifest));await assert.rejects(verifyRenderRuntime({...runtime,manifest:file}));
 }
});
