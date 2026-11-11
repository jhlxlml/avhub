// Read-only runtime/material preflight. Does not stage, package or grant release admission.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {developmentIndependentRuntime} from './development-independent-runtime.mjs';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const json=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const pin=json('ci/mkv-index-render-runtime.json');
const native=process.env.AVHUB_RENDER_RUNTIME_CANDIDATE??path.basename(json('build/mkv-index-runtime-staging.json').folder);
const independent=developmentIndependentRuntime(root,process.env.AVHUB_MPV_RUNTIME_CANDIDATE);
if(!independent)throw new Error('No accepted independent compatibility runtime selected');
const {renderRuntimeLayout}=require('../electron/dist/renderRuntimeLayout.js');
const {verifyRenderRuntime}=require('../electron/dist/renderHostClient.js');
const {NativeRuntime}=require('../electron/dist/nativeRuntime.js');
const {renderCandidatePolicy}=require('../electron/render-candidate-policy.cjs');
const {replayedRenderPin}=require('../electron/dist/replayedRenderPin.js');
const {mkvIndexRenderPin}=require('../electron/dist/mkvIndexRenderPin.js');
if(JSON.stringify(pin)!==JSON.stringify(mkvIndexRenderPin))throw new Error('Compiled native pin is stale; run build:electron');
const runtime=renderRuntimeLayout(root,false,'',native),nativeRoot=path.relative(root,path.dirname(runtime.manifest));
const layout=json(path.join(nativeRoot,'layout.json')),render=json(path.join(nativeRoot,'runtime.json'));
renderCandidatePolicy(layout,render,runtime,[replayedRenderPin,mkvIndexRenderPin]);
await verifyRenderRuntime(runtime);
const independentRoot=path.join('build',independent),exe=json(path.join(independentRoot,'runtime.json'));
const status=await new NativeRuntime(()=>path.join(root,independentRoot,'mpv.exe'),path.join(root,independentRoot,'runtime.json')).check(true);
if(!status.available)throw new Error(status.reason);
if(render.cohort!==pin.id||render.dllSha256!==pin.dllSha256||exe.sourceCommit!==pin.sourceRevision||JSON.stringify(exe.patches)!==JSON.stringify(pin.patches))throw new Error('Dual runtime source/patch cohort differs');
const verified=[];
function verify(relative,expected){
 const file=path.resolve(root,relative),info=fs.lstatSync(file),inside=path.relative(root,file);
 if(inside.startsWith('..')||path.isAbsolute(inside)||!info.isFile()||info.isSymbolicLink()||fs.realpathSync(file).toLowerCase()!==file.toLowerCase())throw new Error('Invalid material path: '+relative);
 const hash=createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024**2);
 try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));}finally{fs.closeSync(fd);}
 const sha256=hash.digest('hex');if(sha256!==expected)throw new Error('Material hash changed: '+relative);
 verified.push({path:relative,size:info.size,sha256});
}
// Verify full staged inventory, including provenance; never edit historical receipts.
layout.files.forEach(file=>verify(path.join(nativeRoot,file.path),file.sha256));
pin.patches.forEach(file=>verify(file.path,file.sha256));
verify(path.join(nativeRoot,'materials/compatibility/mkv-reversed-cues.patch'),pin.patches[0].sha256);
verify('build/native-git-inputs/mpv-'+pin.sourceRevision.slice(0,12)+'.tar',exe.sourceArchiveSha256);
verify(exe.luaSource.archive,exe.luaSource.archiveSha256);
verify(path.join(independentRoot,'materials/desktop-sources',path.basename(exe.luaSource.archive)),exe.luaSource.archiveSha256);
verify(path.join(independentRoot,'materials/desktop-sources/mkv-reversed-cues.patch'),pin.patches[0].sha256);
render.sources.forEach(file=>verify(file.name,file.sha256));
const receipt=json(path.relative(root,exe.buildReceipt));
if(receipt.buildPassed!==true||JSON.stringify(receipt.patches)!==JSON.stringify(pin.patches))throw new Error('Independent build receipt differs');
const report={schema:1,scope:'source-and-runtime-preflight-not-packaged-acceptance',passed:true,distributionReady:false,native,independent,cohort:pin.id,verified,releaseBlockers:['No new packaged EXE/ZIP acceptance for this paired runtime; local source regression is not packaged evidence','Corresponding source delivery and schema-2 release receipt must be regenerated and verified for the final application build']};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--release'))process.exitCode=1;
