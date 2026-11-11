// Real Electron, original source read-only, copied index. GPU receipts are not scanout.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {mediaHash} from './media-pool.mjs';
const root=path.resolve(import.meta.dirname,'../..'),id=Number(process.argv[2]??1240),seconds=Number(process.argv[3]??18);
assert.ok(Number.isSafeInteger(id)&&id>0);assert.ok(seconds>=10&&seconds<=60);
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
  for(const method of ['frame','snapshot','acknowledge']){const original=RenderHostClient.prototype[method];RenderHostClient.prototype[method]=async function(...args){const at=performance.now(),result=await original.apply(this,args);if(globalThis.__cadence.length<20000)globalThis.__cadence.push({kind:method,at,ms:performance.now()-at,...(method==='frame'?{waiting:result.waiting,serial:result.serial}:{} )});return result;};}
  const present=RenderTextureBridge.prototype.present;RenderTextureBridge.prototype.present=async function(...args){const at=performance.now(),result=await present.apply(this,args);if(globalThis.__cadence.length<20000)globalThis.__cadence.push({kind:'present',at,ms:performance.now()-at,gpuAt:result.gpuAt,position:result.positionSec,serial:result.serial,seekId:result.seekId});return result;};
 });
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json();},{url,method,body});
 original=await api('/api/media/'+id);assert.equal(original.missing,0,'Choose an available indexed source; refresh the actual library separately if a file was restored');before={bytes:statSync(original.path).size,mtime:statSync(original.path).mtimeMs,sha256:mediaHash(original.path)};report.source=before;report.media={codec:original.video_codec,width:original.width,height:original.height,duration:original.duration};
 await api('/api/thumbnails/pause','POST');await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,mpvSeekPolicy:'fast',resumeBehavior:'restart',hoverPreview:false,autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>{window.__cadenceState=null;window.__cadenceStates=[];window.avhubDesktop.onRenderState(s=>{window.__cadenceState=s;if(window.__cadenceStates.length<1024)window.__cadenceStates.push({at:performance.now(),position:s.positionSec,pending:s.pendingSeek,decoderDrops:s.properties['decoder-frame-drop-count'],outputDrops:s.properties['frame-drop-count'],hwdec:s.properties['hwdec-current'],cache:s.properties['paused-for-cache']});});});
 await page.getByRole('button',{name:'播放 '+original.title,exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__cadenceState?.phase),{timeout:30000}).toBe('ready');
 for(const {policy,target} of [{policy:'fast',target:1040},{policy:'exact',target:1040},{policy:'fast',target:218},...(process.env.AVHUB_CADENCE_REPEAT_FAST==='1'?[{policy:'fast',target:1040}]:[])]){
  const row={policy,target};report.rows.push(row);assert.ok(target+seconds<original.duration);
  await page.evaluate(policy=>{const s=window.__cadenceState;return window.avhubDesktop.renderPlayer('seek-policy',{session:s.session,generation:s.generation,value:policy});},policy);
  row.resourcesBefore=await desktop.evaluate(()=>globalThis.__cadenceClient.resources());
  const previous=await page.evaluate(()=>window.__cadenceState.seekDiagnostics?.seekId??0);
  await desktop.evaluate(()=>{globalThis.__cadence=[];});await page.evaluate(()=>{window.__cadenceStates=[];});
  await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((slider,target)=>{slider.value=String(target);slider.dispatchEvent(new Event('input',{bubbles:true}));},target);
  await expect.poll(()=>page.evaluate(previous=>{const s=window.__cadenceState;return s.phase==='ready'&&s.pendingSeek===null&&s.seekDiagnostics?.seekId>previous;},previous),{timeout:20000,intervals:[10,20,40,80]}).toBe(true);
  row.resourcesAfter=await desktop.evaluate(()=>globalThis.__cadenceClient.resources());
  row.actualDemuxer=await page.evaluate(()=>window.__cadenceState.properties['current-demuxer']);
  row.nativeTrace=await page.evaluate(()=>window.__cadenceState.properties['avhub-native-seek-trace']);
  row.seek=await page.evaluate(()=>window.__cadenceState.seekDiagnostics);row.before=await page.evaluate(()=>({frame:window.__cadenceState.presented,properties:window.__cadenceState.properties}));
  await desktop.evaluate(()=>{globalThis.__cadence=[];});await page.evaluate(()=>{window.__cadenceStates=[];});
  await page.waitForTimeout(seconds*1000);row.pipeline=await desktop.evaluate(()=>globalThis.__cadence);row.states=await page.evaluate(()=>window.__cadenceStates);row.after=await page.evaluate(()=>window.__cadenceState);
  const frames=row.pipeline.filter(s=>s.kind==='present'),gaps=frames.slice(1).map((f,index)=>f.gpuAt-frames[index].gpuAt),percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
  row.summary={frames:frames.length,gapP50:percentile(gaps,.5),gapP95:percentile(gaps,.95),gapMax:Math.max(...gaps),stalls:gaps.flatMap((ms,index)=>ms>100?[{ms,position:frames[index+1].position}]:[]),stages:Object.fromEntries(['frame','snapshot','acknowledge','present'].map(kind=>{const samples=row.pipeline.filter(s=>s.kind===kind).map(s=>s.ms);return [kind,{count:samples.length,p95:percentile(samples,.95),max:Math.max(...samples)}];}))};
  assert.equal(row.after.phase,'ready');assert.equal(row.after.pendingSeek,null);assert.equal(row.after.sourceLoads,1);assert.equal(row.after.properties.pause,false);assert.ok(row.after.positionSec>row.before.frame.positionSec+seconds*.8);assert.ok(row.after.properties['hwdec-current']&&row.after.properties['hwdec-current']!=='no');assert.ok(frames.length>seconds*20);assert.ok(row.pipeline.length<20000,'Trace must not truncate');assert.ok(!row.states.some(s=>s.cache));row.passed=true;
  writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({policy,target,seek:row.seek,summary:row.summary}));
 }
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active).toBe(false);report.passed=true;
}catch(error){report.error=String(error.stack??error);report.body=await page?.locator('body').innerText().catch(()=>null);throw error;}
finally{await desktop?.close();if(original&&before){report.sourceAfter={bytes:statSync(original.path).size,mtime:statSync(original.path).mtimeMs,sha256:mediaHash(original.path)};assert.deepEqual(report.sourceAfter,before);}writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}
