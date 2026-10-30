// Synthetic inventory contracts only; not native loading or packaged acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {auditRenderDistribution} from '../../scripts/audit-render-distribution.mjs';
const root=path.resolve(import.meta.dirname,'../..');
function fixture(){
 const dir=mkdtempSync(path.join(root,'build/render-distribution-contract-'));
 const write=(name,value)=>{mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});writeFileSync(path.join(dir,name),typeof value==='string'?value:JSON.stringify(value));};
 const file=name=>{const text='synthetic '+name;write(name,text);return {name,sha256:createHash('sha256').update(text).digest('hex'),size:Buffer.byteLength(text)};};
 const binary=file('build/native-render/AVHubNativeRender.exe');
 const source=['MpvCore.cs','D3dSurface.cs','RenderHost.cs','DisplayProbe.cs'].map(n=>file('electron/native/render/'+n));
 const dll=file('build/libmpv-d3d11-input/runtime/libmpv-2.dll'),header=file('third_party/render_d3d11.h');
 const ffi=file('build/libmpv-render-spike/ffi/node_modules/koffi.node');
 write('ci/libmpv-d3d11-candidate.json',{dllSha256:dll.sha256,sourceCommit:'a'.repeat(40),distributionReady:false,files:[{...dll,name:'libmpv-2.dll'}],supplementalHeader:{...header,path:header.name}});
 write('build/native-render/runtime.json',{protocol:1,platform:'win32-x64',hostSha256:binary.sha256,dllSha256:dll.sha256,sources:source,productionDistributionReady:false});
 write('ci/render-ffi/runtime-manifest.json',{version:'3.3.4',platform:'win32-x64',files:[{...ffi,name:'node_modules/koffi.node'}]});
 write('electron/src/renderPlayer.ts',"build/native-render if(app.isPackaged)throw");
 write('electron/src/renderTexture.ts','build/libmpv-render-spike/ffi');
 write('package.json',{build:{extraResources:[{to:'backend'}]}});
 return {dir,write};
}
test('intact development files never imply permission or packaged readiness',()=>{
 const {dir}=fixture(),report=auditRenderDistribution(dir);
 assert.equal(report.runtimeVerified,true);assert.equal(report.distributionReady,false);
 assert.equal(report.files.length,8);assert.equal(report.releaseBlockers.length,8);
 assert.ok(report.releaseBlockers.some(p=>p.includes('vulkan-1.dll')));
});
test('a changed host or bridge binary cannot retain integrity approval',()=>{
 for(const name of ['build/native-render/AVHubNativeRender.exe','build/libmpv-render-spike/ffi/node_modules/koffi.node']){
  const {dir,write}=fixture();write(name,'changed');const report=auditRenderDistribution(dir);
  assert.equal(report.runtimeVerified,false);assert.ok(report.integrityProblems.some(p=>p.includes(name)));
 }
});
test('editing source after compiling requires a new host',()=>{
 const {dir,write}=fixture();write('electron/native/render/RenderHost.cs','new source');
 assert.equal(auditRenderDistribution(dir).runtimeVerified,false);
});
test('readiness booleans and resource mapping do not invent clean-machine acceptance',()=>{
 const {dir,write}=fixture();
 for(const [name,key]of [['ci/libmpv-d3d11-candidate.json','distributionReady'],['build/native-render/runtime.json','productionDistributionReady']]){
  const value=JSON.parse(readFileSync(path.join(dir,name),'utf8'));value[key]=true;write(name,value);
 }
 write('package.json',{build:{extraResources:[{to:'native-render'}]}});
 const report=auditRenderDistribution(dir);assert.equal(report.runtimeVerified,true);assert.equal(report.distributionReady,false);
 assert.ok(report.releaseBlockers.some(p=>p.includes('clean-machine')));
});
