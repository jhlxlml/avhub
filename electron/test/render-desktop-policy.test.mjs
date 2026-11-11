// Resource policy harness; does not claim a real packaged Electron acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const {resolveRenderRuntime}=require('../dist/renderRuntimeLayout.js');
const stage=JSON.parse(readFileSync(path.join(root,'build/replayed-render-staging.json'),'utf8')).folder;
function fixture(){
 const resources=mkdtempSync(path.join(root,'build/render-desktop-policy-'));
 mkdirSync(path.join(resources,'native-render'));
 const manifest=path.join(resources,'native-render/runtime.json');copyFileSync(path.join(stage,'runtime.json'),manifest);
 const marker={schema:1,purpose:'desktop-native-render',candidate:path.basename(stage),cohort:JSON.parse(readFileSync(manifest,'utf8')).cohort,
  manifestSha256:createHash('sha256').update(readFileSync(manifest)).digest('hex')};
 const file=path.join(resources,'native-render-desktop.json');writeFileSync(file,JSON.stringify(marker));return {resources,file,marker,manifest};
}
test('installed desktop runtime needs no environment flag or acceptance launcher',()=>{
 const f=fixture(),r=resolveRenderRuntime(root,true,f.resources,'../ignored','0');
 assert.equal(r.desktopEnabled,true);assert.equal(r.localAcceptance,false);assert.equal(r.replayedCandidate,true);
 assert.equal(r.dll,path.join(f.resources,'native-render/libmpv-2.dll'));
});
test('wrong cohort, external paths and changed manifest cannot enable desktop playback',()=>{
 const f=fixture();
 for(const change of [m=>m.schema=2,m=>m.cohort='unknown',m=>m.candidate='../outside',m=>m.purpose='other',m=>m.manifestSha256='0'.repeat(64)]){
  const marker=structuredClone(f.marker);change(marker);writeFileSync(f.file,JSON.stringify(marker));
  assert.throws(()=>resolveRenderRuntime(root,true,f.resources,undefined,'0'));
 }
 writeFileSync(f.file,JSON.stringify(f.marker));writeFileSync(f.manifest,'{}');
 assert.throws(()=>resolveRenderRuntime(root,true,f.resources,undefined,'0'),/清单不匹配/);
});
