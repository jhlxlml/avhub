// Packaged-resource path/policy harness only. No packaged app is created or run.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,copyFileSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url);
const {resolveRenderRuntime,renderRuntimeLayout}=require('../dist/renderRuntimeLayout.js');
const {replayedRenderPin:pin}=require('../dist/replayedRenderPin.js');
const stage=JSON.parse(readFileSync(path.join(root,'build/replayed-render-staging.json'),'utf8')).folder;
function fixture(){
 const resources=mkdtempSync(path.join(root,'build/render-resource-policy-'));
 mkdirSync(path.join(resources,'native-render'));
 const manifest=path.join(resources,'native-render/runtime.json'),file=path.join(resources,'local-render-acceptance.json');
 copyFileSync(path.join(stage,'runtime.json'),manifest);
 const marker={schema:1,purpose:'local-render-acceptance',candidate:path.basename(stage),cohort:JSON.parse(readFileSync(manifest,'utf8')).cohort,
  manifestSha256:createHash('sha256').update(readFileSync(manifest)).digest('hex'),distributionReady:false};
 writeFileSync(file,JSON.stringify(marker));return {resources,file,manifest,marker};
}

test('default packaged policy ignores development selection and never enables local mode',()=>{
 const f=fixture();
 for(const flag of [undefined,'','0','true']){
  const r=resolveRenderRuntime(root,true,f.resources,path.basename(stage),flag);
  assert.equal(r.localAcceptance,false);assert.equal(r.replayedCandidate,false);
 }
 const dev=resolveRenderRuntime(root,false,f.resources,path.basename(stage),'1');
 assert.equal(dev.localAcceptance,false);assert.equal(dev.dll,path.join(stage,'libmpv-2.dll'));
 assert.throws(()=>renderRuntimeLayout(root,true,f.resources,path.basename(stage)),/发行验收/);
});

test('explicit local opt-in plus matching marker resolves exclusively inside resources',()=>{
 const f=fixture(),r=resolveRenderRuntime(root,true,f.resources,'../ignored-development-path','1');
 assert.equal(r.localAcceptance,true);assert.equal(r.replayedCandidate,true);
 assert.equal(r.dll,path.join(f.resources,'native-render/libmpv-2.dll'));
 assert.equal(r.ffiBase,path.join(f.resources,'native-render/ffi'));
 assert.equal(r.root,path.join(f.resources,'native-render/source'));
});

test('missing marker, wrong cohort/schema/path/approval and changed manifest fail closed',()=>{
 const f=fixture();unlinkSync(f.file);
 assert.throws(()=>resolveRenderRuntime(root,true,f.resources,undefined,'1'),/缺少/);
 for(const mutate of [m=>m.schema=2,m=>m.cohort='unknown',m=>m.candidate='../outside',m=>m.distributionReady=true,m=>m.manifestSha256='0'.repeat(64)]){
  const marker=structuredClone(f.marker);mutate(marker);writeFileSync(f.file,JSON.stringify(marker));
  assert.throws(()=>resolveRenderRuntime(root,true,f.resources,undefined,'1'));
 }
 writeFileSync(f.file,JSON.stringify(f.marker));writeFileSync(f.manifest,readFileSync(f.manifest,'utf8')+'\n');
 assert.throws(()=>resolveRenderRuntime(root,true,f.resources,undefined,'1'),/清单不匹配/);
});

test('relocated native-resource evidence retains its non-package scope',()=>{
 const report=JSON.parse(readFileSync(path.join(root,'build/render-local-resources-Y40np8/report.json'),'utf8'));
 assert.equal(report.kind,'relocated-native-resources-harness-not-packaged-electron');
 assert.equal(report.runtime.cohort,pin.id);assert.equal(report.passed,true);
 assert.equal(report.screenshot.frameCode,31);assert.equal(report.helperAliveAfterClose,false);
});
