// Actual application pipe client + actual libmpv helper. This does not certify
// Electron presentation; the generated fixture is reused read-only by identity.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const fixture=path.resolve(process.argv[2]||'');assert.ok(fixture.startsWith(path.join(root,'build/native-render-host-')));
const previous=JSON.parse(readFileSync(path.join(fixture,'report.json'),'utf8'));assert.equal(previous.passed,true);
const source=path.join(fixture,'test.mkv'),identity=()=>({hash:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs});assert.deepEqual(identity(),previous.sourceBefore);
const {RenderHostClient,verifyRenderRuntime}=require('../../electron/dist/renderHostClient.js');
const runtime={host:path.join(root,'build/native-render/AVHubNativeRender.exe'),dll:path.join(root,'build/libmpv-d3d11-input/runtime/libmpv-2.dll'),manifest:path.join(root,'build/native-render/runtime.json'),root};
const contract={width:640,height:360,depth:8,primaries:'bt709',transfer:'bt709',matrix:'bt709',range:'tv',hdr:false};
const folder=mkdtempSync(path.join(root,'build/render-host-client-')),report={kind:'real-native-client-not-electron',runtime:await verifyRenderRuntime(runtime),fixture,sourceBefore:identity()};const clients=[];
const create=()=>{const c=new RenderHostClient(runtime,{drain:async()=>{}});clients.push(c);return c;};
async function until(client,check){const start=Date.now();let s;do{s=await client.snapshot();if(s.frame.waiting)await client.acknowledge(s.frame.serial);assert.equal(s.error,null);if(check(s))return s;await delay(20);}while(Date.now()-start<10000);throw new Error('native state timeout');}
try{
 await verifyRenderRuntime(runtime);await assert.rejects(verifyRenderRuntime({...runtime,dll:path.join(folder,'missing.dll')}));
 const normal=create();const opening=normal.open({path:source,contract,startSec:1,autoplay:false});await assert.rejects(normal.open({path:source,contract,startSec:0,autoplay:false}),/不能重复/);await opening;await until(normal,s=>s.loaded&&s.properties.pause===true);await normal.control('mute',true);
 await normal.control('seek',{seconds:8,seekId:1});const seek=await until(normal,s=>s.frame.seekId===1);assert.ok(Math.abs(seek.frame.positionSec-8)<.1);report.seek=seek;
 await normal.control('play');await until(normal,s=>s.properties['time-pos']>8.1);await normal.control('pause');await until(normal,s=>s.properties.pause===true);
 for(let i=0;i<3;i++){await until(normal,()=>true);await delay(20);}const stopping=normal.close();assert.equal(normal.close(),stopping);await stopping;assert.equal(normal.alive,false);await assert.rejects(normal.snapshot());
 const crash=create();await crash.open({path:source,contract,startSec:0,autoplay:false});await until(crash,s=>s.loaded);let failure;crash.once('failure',e=>failure=e.message);process.kill(crash.pid);await delay(100);await assert.rejects(crash.snapshot());await crash.close();assert.equal(crash.alive,false);assert.ok(failure);report.processFailureHandled=true;
 const missing=create();await assert.rejects(missing.open({path:path.join(folder,'missing.mp4'),contract,startSec:0,autoplay:false}));await missing.close();assert.equal(missing.alive,false);report.missingSourceHandled=true;
 const early=create(),pending=early.open({path:source,contract,startSec:0,autoplay:false}),cancelled=assert.rejects(pending,{name:'AbortError'});await early.close();await cancelled;assert.equal(early.pid,0);report.cancelBeforeSpawnPassed=true;
 let rejectDrain=true;const guarded=new RenderHostClient(runtime,{drain:async()=>{if(rejectDrain)throw new Error('test-owned-reader-pending');}});clients.push(guarded);await guarded.open({path:source,contract,startSec:0,autoplay:false});await until(guarded,s=>s.loaded);await assert.rejects(guarded.close(),/reader-pending/);assert.equal(guarded.alive,true);await assert.rejects(guarded.control('play'),/正在关闭/);rejectDrain=false;await guarded.close();assert.equal(guarded.alive,false);report.failedDrainRetainsHost=true;
 report.sourceAfter=identity();assert.deepEqual(report.sourceAfter,report.sourceBefore);report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);throw error;}
finally{for(const c of clients)await c.close().catch(()=>{});writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(folder,'report.json')}));}
