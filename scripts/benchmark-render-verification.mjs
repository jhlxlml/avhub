// Real verification, including negative checks on owned copies. Not an OS cold-cache test.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,cpSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const {renderRuntimeLayout}=require('../electron/dist/renderRuntimeLayout.js'),{verifyRenderRuntime}=require('../electron/dist/renderHostClient.js');
const folder=JSON.parse(readFileSync(path.join(root,'build/replayed-render-staging.json'),'utf8')).folder;
const runtime=renderRuntimeLayout(root,false,'',path.basename(folder)),dir=mkdtempSync(path.join(root,'build/render-verification-'));
const report={kind:'actual-runtime-integrity',coldCache:false,implementationSha256:createHash('sha256').update(readFileSync(path.join(root,'electron/dist/renderHostClient.js'))).digest('hex'),rows:[],passed:false};
try{
 const first=verifyRenderRuntime(runtime),overlapping=verifyRenderRuntime(runtime);assert.equal(first,overlapping,'Only an in-flight full verification is shared');await first;
 const next=verifyRenderRuntime(runtime);assert.notEqual(next,first,'Completed validation cannot be reused');await next;report.inFlightShared=true;report.completedNotCached=true;
 for(let i=0;i<8;i++){const began=performance.now();await verifyRenderRuntime(runtime);report.rows.push(performance.now()-began);}
 const info=JSON.parse(readFileSync(runtime.manifest,'utf8'));
 const copy={...runtime,host:path.join(dir,'AVHubNativeRender.exe'),dll:path.join(dir,'libmpv-2.dll'),manifest:path.join(dir,'runtime.json'),root:path.join(dir,'source')};
 for(const file of [runtime.host,runtime.dll,runtime.manifest,...info.dependencies.map(file=>path.join(path.dirname(runtime.dll),file.name))])copyFileSync(file,path.join(dir,path.basename(file)));
 cpSync(runtime.root,copy.root,{recursive:true});await verifyRenderRuntime(copy);
 const file=path.join(dir,info.dependencies.at(-1).name),original=readFileSync(file),tampered=Buffer.from(original);tampered[tampered.length-1]^=1;writeFileSync(file,tampered);
 await assert.rejects(verifyRenderRuntime(copy),/依赖未通过完整性校验/);report.dependencyTamperingRejected=true;writeFileSync(file,original);
 const manifest=readFileSync(copy.manifest),changed=JSON.parse(manifest);changed.dependencies[0].name='../unexpected.dll';writeFileSync(copy.manifest,JSON.stringify(changed));
 await assert.rejects(verifyRenderRuntime(copy),/依赖未通过完整性校验/);report.invalidNameRejected=true;writeFileSync(copy.manifest,manifest);
 const host=readFileSync(copy.host),badHost=Buffer.from(host);badHost[badHost.length-1]^=1;writeFileSync(copy.host,badHost);
 await assert.rejects(verifyRenderRuntime(copy),/完整性校验/);report.hostTamperingRejected=true;
 report.passed=true;
}finally{writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(path.join(dir,'report.json'));}
