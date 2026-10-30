// Generated local-media native-host matrix. No compositor/pixel-accuracy claim.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url),{RenderHostClient,verifyRenderRuntime}=require('../../electron/dist/renderHostClient.js');
const runtime={host:path.join(root,'build/native-render/AVHubNativeRender.exe'),dll:path.join(root,'build/libmpv-d3d11-input/runtime/libmpv-2.dll'),manifest:path.join(root,'build/native-render/runtime.json'),root};
const names=['Framecode-v2-640x360.mp4','Framecode-v2-3840x2160-hevc.mkv','Framecode-v3-3840x2160-av1.mkv','Precision-SDR10-3840x2160.mkv','Precision-SDR10-2160x3840.mkv'];
const folder=mkdtempSync(path.join(root,'build/native-render-matrix-')),report={kind:'real-native-matrix-not-electron',runtime:await verifyRenderRuntime(runtime),pixelAccuracyCertified:false,cases:[]};
const identity=file=>({sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),mtimeMs:statSync(file).mtimeMs});
try{for(const name of names){
 const source=path.join(root,'build/libmpv-render-spike/samples',name),before=identity(source);
 const probe=spawnSync('python',[path.join(root,'scripts/python-runtime.py'),path.join(root,'electron/test/native-render-contract.py'),source],{cwd:root,windowsHide:true,encoding:'utf8',timeout:15000});assert.equal(probe.status,0,probe.stderr);const contract=JSON.parse(probe.stdout);
 const client=new RenderHostClient(runtime,{drain:async()=>{}}),entry={name,contract,before};report.cases.push(entry);
 async function until(check){const start=Date.now();let s;do{s=await client.snapshot();assert.equal(s.error,null,JSON.stringify(s));if(s.frame.waiting)await client.acknowledge(s.frame.serial);if(check(s))return s;await delay(15);}while(Date.now()-start<10000);throw new Error('Native matrix timeout '+name);}
 try{await client.open({path:source,contract,startSec:0,autoplay:false});const opened=await until(s=>s.loaded&&s.properties['video-params']);entry.opened=opened;entry.seeks=[];
  assert.equal(opened.properties['video-params'].w,contract.width);assert.equal(opened.properties['video-params'].h,contract.height);
  for(const [i,target] of [2,1,4,.4].entries()){await client.control('seek',{seconds:target,seekId:i+1});const s=await until(s=>s.frame.seekId===i+1);assert.ok(Math.abs(s.frame.positionSec-target)<=.1);assert.equal(s.frame.pixelFormat,'rgbaf16');entry.seeks.push({target,frame:s.frame});}
  await client.close();entry.after=identity(source);assert.deepEqual(entry.after,before);entry.passed=true;assert.equal(client.alive,false);
 }finally{await client.close();}
}report.passed=true;}catch(error){report.passed=false;report.error=String(error.stack||error);throw error;}finally{writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,report:path.join(folder,'report.json')}));}
