// Real Electron, original source read-only, copied index. GPU receipts are not scanout.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {mediaHash} from './media-pool.mjs';
import {summarizeFrameCounter} from './frame-counter-summary.mjs';
const root=path.resolve(import.meta.dirname,'../..'),id=Number(process.argv[2]??1240),seconds=Number(process.argv[3]??18);
assert.ok(Number.isSafeInteger(id)&&id>0);assert.ok(seconds>=10&&seconds<=300);
// Explicit benchmark expectation for a known source, never an inferred frame
// rate or a physical scanout claim. Functional success alone cannot admit it.
const minimumReceiptRate=Number(process.env.AVHUB_CADENCE_MIN_RECEIPTS_PER_SECOND??0);
assert.ok(Number.isFinite(minimumReceiptRate)&&minimumReceiptRate>=0&&minimumReceiptRate<=240);
const data=mkdtempSync(path.join(root,'build/render-frame-cadence-'));
const clone=spawnSync('python',['-X','utf8','-c',`import sqlite3,sys
from pathlib import Path
s=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True);t=sqlite3.connect(sys.argv[2]);s.backup(t);s.close()
t.execute('DELETE FROM media WHERE id<>?',(int(sys.argv[3]),))
for table in ('preferences','root_file_permissions','thumbnail_jobs'):t.execute('DELETE FROM '+table)
t.execute('UPDATE media SET progress=0,watched=0,custom_cover=NULL');t.commit();t.close()`,path.join(root,'AVHub-data/library.db'),path.join(data,'library.db'),String(id)],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(clone.status,0,clone.stderr);
const report={kind:'real-Electron-source-window-cadence',scope:'Read-only original, GPU completion and existing pipe timings; not physical scanout, cold storage or exact per-frame loss certification',build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),candidate:process.env.AVHUB_RENDER_RUNTIME_CANDIDATE,nativeTrace:process.env.AVHUB_NATIVE_SEEK_TRACE==='1',seconds,id,rows:[],passed:false};let desktop,page,original,before;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app})=>{
  const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js'),{RenderTextureBridge}=require(app.getAppPath()+'/electron/dist/renderTexture.js');globalThis.__cadence=[];const open=RenderHostClient.prototype.open;RenderHostClient.prototype.open=async function(...args){const result=await open.apply(this,args);globalThis.__cadenceClient=this;return result;};
  for(const method of ['frame','snapshot','acknowledge']){const original=RenderHostClient.prototype[method];RenderHostClient.prototype[method]=async function(...args){const at=performance.now(),result=await original.apply(this,args);if(globalThis.__cadenceCollecting&&globalThis.__cadence.length<120000)globalThis.__cadence.push({kind:method,at,ms:performance.now()-at,...(method==='frame'?{waiting:result.waiting,serial:result.serial}:method==='snapshot'?{outputDrops:result.properties['frame-drop-count'],decoderDrops:result.properties['decoder-frame-drop-count']}:{} )});return result;};}
  const present=RenderTextureBridge.prototype.present;RenderTextureBridge.prototype.present=async function(...args){const at=performance.now(),result=await present.apply(this,args);if(globalThis.__cadenceCollecting&&globalThis.__cadence.length<120000)globalThis.__cadence.push({kind:'present',at,ms:performance.now()-at,gpuAt:result.gpuAt,position:result.positionSec,serial:result.serial,seekId:result.seekId});return result;};
 });
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json();},{url,method,body});
 original=await api('/api/media/'+id);assert.equal(original.missing,0,'Choose an available indexed source; refresh the actual library separately if a file was restored');before={bytes:statSync(original.path).size,mtime:statSync(original.path).mtimeMs,sha256:mediaHash(original.path)};report.source=before;report.media={codec:original.video_codec,width:original.width,height:original.height,duration:original.duration};
 await api('/api/thumbnails/pause','POST');await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,mpvSeekPolicy:'fast',resumeBehavior:'restart',hoverPreview:false,autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>{window.__cadenceState=null;window.__cadenceStates=[];window.avhubDesktop.onRenderState(s=>{window.__cadenceState=s;if(window.__cadenceStates.length<4096)window.__cadenceStates.push({at:performance.now(),position:s.positionSec,pending:s.pendingSeek,decoderDrops:s.properties['decoder-frame-drop-count'],outputDrops:s.properties['frame-drop-count'],hwdec:s.properties['hwdec-current'],cache:s.properties['paused-for-cache']});});});
 await page.getByRole('button',{name:'播放 '+original.title,exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__cadenceState?.phase),{timeout:30000}).toBe('ready');
 if(process.env.AVHUB_CADENCE_MINIMIZE==='1')report.background=await desktop.evaluate(({BrowserWindow},disable)=>{const main=BrowserWindow.getAllWindows()[0];if(disable)main.webContents.setBackgroundThrottling(false);const throttling=main.webContents.getBackgroundThrottling();main.minimize();return {throttling};},process.env.AVHUB_TEST_DISABLE_NATIVE_THROTTLING==='1');
 for(const {policy,target} of (process.env.AVHUB_CADENCE_SINGLE_FAST==='1'?[{policy:'fast',target:1040}]:[{policy:'fast',target:1040},{policy:'exact',target:1040},{policy:'fast',target:218},...(process.env.AVHUB_CADENCE_REPEAT_FAST==='1'?[{policy:'fast',target:1040}]:[])])){
  const row={policy,target};report.rows.push(row);assert.ok(target+seconds<original.duration);
  await page.evaluate(()=>{const s=window.__cadenceState;return window.avhubDesktop.renderPlayer('command',{session:s.session,generation:s.generation,action:'play'});});
  await page.evaluate(policy=>{const s=window.__cadenceState;return window.avhubDesktop.renderPlayer('seek-policy',{session:s.session,generation:s.generation,value:policy});},policy);
  row.resourcesBefore=await desktop.evaluate(()=>globalThis.__cadenceClient.resources());
  const previous=await page.evaluate(()=>window.__cadenceState.seekDiagnostics?.seekId??0);
  await desktop.evaluate(()=>{globalThis.__cadence=[];globalThis.__cadenceCollecting=true;});await page.evaluate(()=>{window.__cadenceStates=[];});
  await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((slider,target)=>{slider.value=String(target);slider.dispatchEvent(new Event('input',{bubbles:true}));},target);
  await expect.poll(()=>page.evaluate(previous=>{const s=window.__cadenceState;return s.phase==='ready'&&s.pendingSeek===null&&s.seekDiagnostics?.seekId>previous;},previous),{timeout:20000,intervals:[10,20,40,80]}).toBe(true);
  row.resourcesAfter=await desktop.evaluate(()=>globalThis.__cadenceClient.resources());
  row.actualDemuxer=await page.evaluate(()=>window.__cadenceState.properties['current-demuxer']);
  row.nativeTrace=await page.evaluate(()=>window.__cadenceState.properties['avhub-native-seek-trace']);
  row.seek=await page.evaluate(()=>window.__cadenceState.seekDiagnostics);row.before=await page.evaluate(()=>({frame:window.__cadenceState.presented,properties:window.__cadenceState.properties}));
  await desktop.evaluate(()=>{globalThis.__cadence=[];globalThis.__cadenceCollecting=true;});await page.evaluate(()=>{window.__cadenceStates=[];});
  const cpuBefore=await desktop.evaluate(()=>process.cpuUsage());row.playbackResourcesBefore=await desktop.evaluate(()=>globalThis.__cadenceClient.resources());const playbackBegan=performance.now();
  await page.waitForTimeout(seconds*1000);row.playbackElapsedMs=performance.now()-playbackBegan;row.playbackResourcesAfter=await desktop.evaluate(()=>globalThis.__cadenceClient.resources());const cpuAfter=await desktop.evaluate(()=>process.cpuUsage());
  row.cpu={mainCoreEquivalent:(cpuAfter.user+cpuAfter.system-cpuBefore.user-cpuBefore.system)/(row.playbackElapsedMs*1000),nativeCoreEquivalent:(row.playbackResourcesAfter.cpuTimeMs-row.playbackResourcesBefore.cpuTimeMs)/row.playbackElapsedMs};
  row.measurementCut=await desktop.evaluate(()=>{globalThis.__cadenceCollecting=false;return {at:performance.now(),records:globalThis.__cadence.length};});
  row.frameNotifications=await desktop.evaluate(()=>globalThis.__cadenceClient.frameNotificationStats());
  row.after=await page.evaluate(()=>window.__cadenceState);
  // Serializing tens of thousands of records during playback can itself block
  // the main process and cause output drops. Freeze first, then pause before
  // transferring that trace. Do not count this export tail as steady playback.
  await page.evaluate(()=>{const s=window.__cadenceState;return window.avhubDesktop.renderPlayer('command',{session:s.session,generation:s.generation,action:'pause'});});
  await expect.poll(()=>page.evaluate(()=>window.__cadenceState.properties.pause)).toBe(true);
  row.exportPaused=true;
  row.pipeline=await desktop.evaluate(()=>globalThis.__cadence);row.states=await page.evaluate(()=>window.__cadenceStates);
  assert.equal(row.pipeline.length,row.measurementCut.records,'Export must not append to the measured trace');
  row.dropCounterScope='Existing native snapshots completed before the main-process measurement cut; diagnostic export after pause is excluded';
  row.dropCounters=Object.fromEntries(['outputDrops','decoderDrops'].map(name=>[name,summarizeFrameCounter(row.pipeline.filter(call=>call.kind==='snapshot').map(s=>({value:s[name]})))]));
  const frames=row.pipeline.filter(s=>s.kind==='present'),gaps=frames.slice(1).map((f,index)=>f.gpuAt-frames[index].gpuAt),percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
  row.summary={frames:frames.length,gapP50:percentile(gaps,.5),gapP95:percentile(gaps,.95),gapMax:Math.max(...gaps),stalls:gaps.flatMap((ms,index)=>ms>100?[{ms,position:frames[index+1].position}]:[]),stages:Object.fromEntries(['frame','snapshot','acknowledge','present'].map(kind=>{const samples=row.pipeline.filter(s=>s.kind===kind).map(s=>s.ms);return [kind,{count:samples.length,p95:percentile(samples,.95),max:Math.max(...samples)}];}))};
  row.performanceGate={scope:'Measured GPU receipt rate against an explicitly selected source expectation, not screen scanout',receiptsPerSecond:frames.length/(row.playbackElapsedMs/1000),minimum:minimumReceiptRate||null,passed:minimumReceiptRate?frames.length/(row.playbackElapsedMs/1000)>=minimumReceiptRate:null};
  // All timestamps below use the main-process performance clock. Preserve the
  // actual calls intersecting each longest GPU-receipt interval, rather than
  // confusing a slow polling cadence with slow native drawing or scanout.
  row.deliveryGapsScope='Main-process GPU-receipt intervals; uninstrumented time includes scheduling and native readiness, not exclusively idle time or physical scanout';
  row.deliveryGaps=gaps.map((ms,index)=>({ms,index})).sort((a,b)=>b.ms-a.ms).slice(0,16).map(({ms,index})=>{
   const start=frames[index].gpuAt,end=frames[index+1].gpuAt;
   const calls=row.pipeline.filter(call=>call.at<end&&call.at+call.ms>start).map(call=>({kind:call.kind,offsetMs:Math.max(start,call.at)-start,ms:Math.min(end,call.at+call.ms)-Math.max(start,call.at),...(call.kind==='frame'?{waiting:call.waiting,serial:call.serial}:{})})).sort((a,b)=>a.offsetMs-b.offsetMs);
   let covered=0,until=0;for(const call of calls){const finish=call.offsetMs+call.ms;covered+=Math.max(0,finish-Math.max(until,call.offsetMs));until=Math.max(until,finish);}
   const uninstrumentedMs=Math.max(0,ms-covered);
   assert.ok(Math.abs(covered+uninstrumentedMs-ms)<.01,'Receipt interval accounting must balance');
   return {ms,position:frames[index+1].position,serial:frames[index+1].serial,uninstrumentedMs,calls};
  });
  // Renderer performance.now() has a different origin. Counter correlations
  // therefore use the existing snapshot RPC's main-process interval only.
  const snapshots=row.pipeline.filter(call=>call.kind==='snapshot');
  row.dropWindows=snapshots.slice(1).flatMap((sample,index)=>{
   const previous=snapshots[index],increase=sample.outputDrops-previous.outputDrops;
   if(!Number.isSafeInteger(increase)||increase<=0)return [];
   const start=previous.at,end=sample.at+sample.ms;
   return [{start,end,increase,scope:'Observed counter increase within polling interval, not an exact drop timestamp or causal proof',gaps:gaps.flatMap((ms,index)=>frames[index].gpuAt<end&&frames[index+1].gpuAt>start?[{ms,start:frames[index].gpuAt,end:frames[index+1].gpuAt,position:frames[index+1].position}]:[]).sort((a,b)=>b.ms-a.ms).slice(0,5)}];
  });
  assert.notEqual(row.performanceGate.passed,false,'Measured GPU delivery misses the selected performance minimum');
  assert.equal(row.after.phase,'ready');assert.equal(row.after.pendingSeek,null);assert.equal(row.after.sourceLoads,1);assert.equal(row.after.properties.pause,false);assert.ok(row.after.positionSec>row.before.frame.positionSec+seconds*.8);assert.ok(row.after.properties['hwdec-current']&&row.after.properties['hwdec-current']!=='no');assert.ok(frames.length>seconds*20);assert.ok(row.pipeline.length<120000,'Trace must not truncate');assert.ok(row.states.length<4096,'State trace must not truncate');assert.ok(!row.states.some(s=>s.cache));row.passed=true;
  writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({policy,target,seek:row.seek,summary:row.summary}));
 }
 if(process.env.AVHUB_CADENCE_MINIMIZE==='1')await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].restore());
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active).toBe(false);report.passed=true;
}catch(error){report.error=String(error.stack??error);report.body=await page?.locator('body').innerText().catch(()=>null);throw error;}
finally{await desktop?.close();if(original&&before){report.sourceAfter={bytes:statSync(original.path).size,mtime:statSync(original.path).mtimeMs,sha256:mediaHash(original.path)};assert.deepEqual(report.sourceAfter,before);}writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}
