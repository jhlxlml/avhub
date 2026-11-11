// Explicit local compatibility candidate; never a package or default promotion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),build=path.join(root,'build'),require=createRequire(import.meta.url);
const {mkvIndexRenderPin:pin}=require('../electron/dist/mkvIndexRenderPin.js');
assert.deepEqual(pin,JSON.parse(fs.readFileSync(path.join(root,'ci/mkv-index-render-runtime.json'),'utf8')),'Rebuild Electron: compatibility pin changed');
const selected=JSON.parse(fs.readFileSync(path.join(build,'mkv-index-candidate-latest.json'),'utf8')).folder;
const input=path.join(build,path.posix.basename(selected.replaceAll('\\','/')));
assert.match(path.basename(input),/^mkv-index-candidate-[a-z0-9_]+$/);
const report=JSON.parse(fs.readFileSync(path.join(input,'report.json'),'utf8'));
assert.equal(report.buildPassed,true);assert.equal(report.dllSha256,pin.dllSha256);
assert.equal(report.patchSha256,pin.patches[0].sha256);assert.equal(report.source.revision,pin.sourceRevision);
const old=JSON.parse(fs.readFileSync(path.join(build,'replayed-render-staging.json'),'utf8'));
assert.equal(path.dirname(path.resolve(old.folder)),build);
const hash=file=>{const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(fs.realpathSync(file).toLowerCase(),path.resolve(file).toLowerCase(),'No redirected candidate input');return createHash('sha256').update(fs.readFileSync(file)).digest('hex');};
const disk=fs.statfsSync(build);assert.ok(disk.bavail*disk.bsize>old.files.reduce((sum,item)=>sum+item.size,0)+256*1024**2,'Insufficient candidate headroom');
const folder=fs.mkdtempSync(path.join(build,'render-replayed-candidate-'));
for(const item of old.files){
 const source=path.resolve(old.folder,item.path),target=path.resolve(folder,item.path);
 assert.ok(source.startsWith(old.folder+path.sep)&&target.startsWith(folder+path.sep));
 assert.equal(hash(source),item.sha256);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
}
for(const name of ['MpvCore.cs','D3dSurface.cs','RenderHost.cs','DisplayProbe.cs'])fs.copyFileSync(path.join(root,'electron/native/render',name),path.join(folder,'source/electron/native/render',name));
const host=JSON.parse(fs.readFileSync(path.join(build,'native-render/runtime.json'),'utf8'));
assert.equal(hash(path.join(build,'native-render/AVHubNativeRender.exe')),host.hostSha256);
fs.copyFileSync(path.join(build,'native-render/AVHubNativeRender.exe'),path.join(folder,'AVHubNativeRender.exe'));
const dll=path.join(input,'install/bin/libmpv-2.dll');assert.equal(hash(dll),pin.dllSha256);fs.copyFileSync(dll,path.join(folder,'libmpv-2.dll'));
for(const item of pin.dependencies)assert.equal(hash(path.join(folder,item.name)),item.sha256);
fs.writeFileSync(path.join(folder,'runtime.json'),JSON.stringify({...host,dllSha256:pin.dllSha256,cohort:pin.id,dependencies:pin.dependencies,patches:pin.patches,productionDistributionReady:false},null,2));
fs.copyFileSync(path.join(root,'ci/render-ffi/runtime-manifest.json'),path.join(folder,'ffi/runtime-manifest.json'));
const materials=JSON.parse(fs.readFileSync(path.join(old.folder,'materials.json'),'utf8'));
fs.writeFileSync(path.join(folder,'materials.json'),JSON.stringify({...materials,subject:pin,compatibilityBuild:report,distributionReady:false},null,2));
const patch=path.join(root,pin.patches[0].path);assert.equal(hash(patch),pin.patches[0].sha256);
fs.mkdirSync(path.join(folder,'materials/compatibility'),{recursive:true});
fs.copyFileSync(patch,path.join(folder,'materials/compatibility/mkv-reversed-cues.patch'));
fs.copyFileSync(path.join(input,'report.json'),path.join(folder,'materials/compatibility/build.json'));
fs.copyFileSync(path.join(root,'scripts/build-mkv-index-candidate.py'),path.join(folder,'materials/compatibility/build-mkv-index-candidate.py'));
const files=[];
function collect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);assert.ok(!entry.isSymbolicLink());if(entry.isDirectory())collect(file);else files.push({path:path.relative(folder,file).replaceAll('\\','/'),size:fs.statSync(file).size,sha256:hash(file)});}}
collect(folder);const layout={schema:1,folder,scope:'explicit-local-MKV-Cues-compatibility-not-release',distributionReady:false,files};
fs.writeFileSync(path.join(folder,'layout.json'),JSON.stringify(layout,null,2));
fs.writeFileSync(path.join(build,'mkv-index-runtime-staging.json'),JSON.stringify(layout,null,2));
console.log(JSON.stringify({folder,files:files.length,defaultPromoted:false}));
