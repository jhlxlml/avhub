// Identity/marker contracts only, not packaged decoding acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const {renderCandidatePolicy}=require('../render-candidate-policy.cjs');
const {resolveRenderRuntime}=require('../dist/renderRuntimeLayout.js');
const {replayedRenderPin:old}=require('../dist/replayedRenderPin.js');
const {mkvIndexRenderPin:current}=require('../dist/mkvIndexRenderPin.js');
const runtime={replayedCandidate:true,selfBuiltCandidate:true};
test('old and compatibility layouts preserve exact cohort identities',()=>{
 for(const pin of [old,current]){
  const scope=pin===old?'single-display-SDR-D3D11-development-only':'explicit-local-MKV-Cues-compatibility-not-release';
  assert.equal(renderCandidatePolicy({schema:1,scope,distributionReady:false},{cohort:pin.id,dllSha256:pin.dllSha256},runtime,[old,current]).cohort,pin.id);
 }
});
test('unknown DLL/cohort, promoted layout and swapped scopes fail closed',()=>{
 const layout={schema:1,scope:'explicit-local-MKV-Cues-compatibility-not-release',distributionReady:false},manifest={cohort:current.id,dllSha256:current.dllSha256};
 for(const changed of [{...manifest,dllSha256:old.dllSha256},{...manifest,cohort:'unknown'}])assert.throws(()=>renderCandidatePolicy(layout,changed,runtime,[old,current]));
 for(const changed of [{...layout,distributionReady:true},{...layout,scope:old.scope},{...layout,schema:9}])assert.throws(()=>renderCandidatePolicy(changed,manifest,runtime,[old,current]));
});
test('packaged marker resolves both exact cohorts and refuses mismatched manifest',()=>{
 for(const purpose of ['desktop-native-render','local-render-acceptance'])for(const pin of [old,current]){
  const resources=mkdtempSync(path.join(root,'build/render-marker-contract-'));mkdirSync(path.join(resources,'native-render'));
  const bytes=JSON.stringify({cohort:pin.id}),manifest=path.join(resources,'native-render/runtime.json');writeFileSync(manifest,bytes);
  const marker={schema:1,purpose,candidate:'render-replayed-candidate-ABC123',cohort:pin.id,distributionReady:false,manifestSha256:createHash('sha256').update(bytes).digest('hex')};
  const file=path.join(resources,purpose==='desktop-native-render'?'native-render-desktop.json':'local-render-acceptance.json');writeFileSync(file,JSON.stringify(marker));
  assert.equal(resolveRenderRuntime(root,true,resources,undefined,'1').manifest,manifest);
  writeFileSync(file,JSON.stringify({...marker,cohort:pin===old?current.id:old.id}));assert.throws(()=>resolveRenderRuntime(root,true,resources,undefined,'1'),/cohort mismatch/);
 }
});
