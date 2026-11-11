// Real Electron, copied index, original media read-only. No source video copies.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,statSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),index=path.resolve(process.argv[2]??''),ids=process.argv.slice(3).map(Number);
assert.ok(process.argv[2]&&ids.length>0&&ids.length<=12&&ids.every(id=>Number.isSafeInteger(id)&&id>0));
const openOnly=process.env.AVHUB_TEST_OPEN_ONLY==='1',repeats=Number(process.env.AVHUB_TEST_OPEN_REPEATS??1);assert.ok(Number.isInteger(repeats)&&repeats>=1&&repeats<=5);
const prioritySeconds=Number(process.env.AVHUB_TEST_PRIORITY_SECONDS??0);assert.ok(prioritySeconds===0||prioritySeconds>=22&&prioritySeconds<=60);
const stressGroups=Number(process.env.AVHUB_TEST_SEEK_STRESS_GROUPS??0);assert.ok(Number.isInteger(stressGroups)&&stressGroups>=0&&stressGroups<=200);
const data=mkdtempSync(path.join(root,'build/render-library-seek-'));
const clone=spawnSync('python',['-X','utf8','-c',`import sqlite3,os,json
from pathlib import Path
s=sqlite3.connect(Path(os.environ['SEEK_INDEX']).as_uri()+'?mode=ro',uri=True)
t=sqlite3.connect(str(Path(os.environ['SEEK_DATA'])/'library.db'));s.backup(t);s.close()
ids=json.loads(os.environ['SEEK_IDS']);t.execute('DELETE FROM media WHERE id NOT IN ('+','.join('?' for _ in ids)+')',ids)
for name in ('preferences','root_file_permissions'):t.execute('DELETE FROM '+name)
t.execute('DELETE FROM thumbnail_jobs')
t.execute('UPDATE media SET progress=0,watched=0,custom_cover=NULL');t.commit();t.close()`],{env:{...process.env,SEEK_INDEX:index,SEEK_DATA:data,SEEK_IDS:JSON.stringify(ids)},encoding:'utf8',windowsHide:true,timeout:30000});
assert.equal(clone.status,0,clone.stderr);
const identity=async file=>{const s=statSync(file),hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return {size:s.size,mtimeMs:s.mtimeMs,sha256:hash.digest('hex')};};
const runtimeCandidate=process.env.AVHUB_RENDER_RUNTIME_CANDIDATE??'native-render';
const report={kind:'real-Electron-multi-source-render-seek',openOnly,repeats,prioritySeconds,stressGroups,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),runtimeCandidate,runtime:JSON.parse(readFileSync(path.join(root,'build',runtimeCandidate,'runtime.json'),'utf8')),scope:'Original read-only media. GPU completion receipts, not physical scanout. OS/driver caches uncontrolled. Input events are dispatched through application controls, not OS input latency.',rows:[],completed:false};
let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app})=>{
  const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js'),{RenderTextureBridge}=require(app.getAppPath()+'/electron/dist/renderTexture.js'),{RenderPlayer}=require(app.getAppPath()+'/electron/dist/renderPlayer.js');globalThis.__libraryOpenTimings=[];const seen=new WeakSet();
  for(const method of ['open','control','setSubtitleStyle','snapshot']){const original=RenderHostClient.prototype[method];RenderHostClient.prototype[method]=async function(...args){const began=performance.now(),result=await original.apply(this,args);if(globalThis.__libraryOpenTimings.length<256)globalThis.__libraryOpenTimings.push({method:method==='control'?'control:'+args[0]:method,atMs:began-globalThis.__libraryOpenBegin,ms:performance.now()-began,...(method==='open'?{phases:this.startupTimings}:{})});return result;};}
  const present=RenderTextureBridge.prototype.present;RenderTextureBridge.prototype.present=async function(...args){const began=performance.now(),first=!seen.has(this);seen.add(this);const result=await present.apply(this,args);if(first)globalThis.__libraryOpenTimings.push({method:'first-present',atMs:began-globalThis.__libraryOpenBegin,ms:performance.now()-began,gpuAtMs:result.gpuAt-globalThis.__libraryOpenBegin});return result;};
  const api=RenderPlayer.prototype.api;RenderPlayer.prototype.api=async function(...args){const began=performance.now(),result=await api.apply(this,args);if(globalThis.__libraryOpenTimings.length<256)globalThis.__libraryOpenTimings.push({method:'api',route:args[0].replace(/\d+/g,':id'),atMs:began-globalThis.__libraryOpenBegin,ms:performance.now()-began});return result;};
 });
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/thumbnails/pause','POST');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,mpvSeekPolicy:'fast',resumeBehavior:'restart',autoNext:false,hoverPreview:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>{window.__librarySeek=null;window.__librarySeekCompleted=null;window.__librarySeekStates=[];window.avhubDesktop.onRenderState(s=>{window.__librarySeek=s;if(s.phase==='ready'&&s.pendingSeek===null&&s.seekDiagnostics&&s.presented?.seekId===s.seekDiagnostics.seekId)window.__librarySeekCompleted=s;window.__librarySeekStates.push({at:performance.now(),pending:s.pendingSeek,presented:s.presented,phase:s.phase,error:s.error,diagnostic:s.seekDiagnostics,properties:{seeking:s.properties.seeking,pause:s.properties.pause,clock:s.properties['time-pos']}});if(window.__librarySeekStates.length>64)window.__librarySeekStates.shift();});});
 for(const {id,iteration} of ids.flatMap(id=>Array.from({length:repeats},(_,iteration)=>({id,iteration})))){
  const media=await api('/api/media/'+id);assert.ok(path.isAbsolute(media.path)&&statSync(media.path).isFile());
  const before=await identity(media.path),row={id,iteration,codec:media.video_codec,width:media.width,height:media.height,duration:media.duration,ext:media.ext,source:before,seeks:[],passed:false};report.rows.push(row);
  try{
   await page.evaluate(()=>{window.__librarySeek=null;window.__librarySeekCompleted=null;window.__librarySeekStates=[];});await desktop.evaluate(()=>{globalThis.__libraryOpenTimings=[];globalThis.__libraryOpenBegin=performance.now();});const opened=performance.now();await page.getByRole('button',{name:'播放 '+media.title,exact:true}).click();
   await expect.poll(()=>page.evaluate(id=>window.__librarySeek?.mediaId===id?window.__librarySeek.phase:'waiting',id),{timeout:30000}).toBe('ready');row.openObservedMs=performance.now()-opened;row.initial=await page.evaluate(()=>window.__librarySeek);assert.equal(row.initial.mediaId,id);
   row.openTimings=await desktop.evaluate(()=>globalThis.__libraryOpenTimings);
   if(prioritySeconds){
    row.priority={before:(await api('/api/diagnostics')).thumbnail_service};
    await api('/api/media/'+id+'/thumbnail/retry','POST',{frame_time:Math.min(12,media.duration*.1)});await api('/api/thumbnails/resume','POST');
    await page.waitForTimeout(prioritySeconds*1000);
    const actual=await page.evaluate(()=>window.__librarySeek);row.priority.after=(await api('/api/diagnostics')).thumbnail_service;row.priority.clock=actual.positionSec;row.priority.frameSerial=actual.presented.serial;
    assert.ok(actual.positionSec>prioritySeconds-2,'The real source must continue playing during the priority lease test');assert.equal(row.priority.after.yielding,true,'Embedded playback must renew its 20-second cover-yield lease');
    assert.equal(row.priority.after.paused,false,'Worker must be enabled, not artificially paused');assert.equal(row.priority.after.current,null);assert.equal((await api('/api/media/'+id+'/thumbnail')).state,'pending');row.priority.queuedCoverDeferred=true;
    await page.keyboard.press('Space');await expect.poll(async()=>(await api('/api/diagnostics')).thumbnail_service.yielding).toBe(false);row.priority.pauseReleased=true;
    await expect.poll(async()=>(await api('/api/diagnostics')).thumbnail_service.published,{timeout:30000}).toBeGreaterThan(row.priority.before.published);assert.equal((await api('/api/media/'+id+'/thumbnail')).state,'idle');row.priority.queuedCoverPublishedAfterPause=true;await api('/api/thumbnails/pause','POST');
    // Controlled GPU gate makes the priority transition observable. This is
    // lifecycle evidence, never a claim about real seek latency.
    const previous=await page.evaluate(()=>window.__librarySeek.seekDiagnostics?.seekId??0);
    await desktop.evaluate(({app})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{RenderTextureBridge}=require(app.getAppPath()+'/electron/dist/renderTexture.js');globalThis.__priorityOriginal=RenderTextureBridge.prototype.present;let once=true;RenderTextureBridge.prototype.present=async function(...args){if(once&&args[0].seekId>0){once=false;globalThis.__priorityWaiting=true;await new Promise(resolve=>globalThis.__priorityRelease=resolve);}return globalThis.__priorityOriginal.apply(this,args);};});
    try{
     await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((slider,value)=>{slider.value=String(value);slider.dispatchEvent(new Event('input',{bubbles:true}));},media.duration*.61);
     await expect.poll(()=>desktop.evaluate(()=>globalThis.__priorityWaiting)).toBe(true);
     await expect.poll(async()=>(await api('/api/diagnostics')).background_reads.yielding).toBe(true);row.priority.pausedSeekYielded=true;row.priority.controlledGpuGateNotPerformanceEvidence=true;
    }finally{await desktop.evaluate(({app})=>{globalThis.__priorityRelease?.();const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');require(app.getAppPath()+'/electron/dist/renderTexture.js').RenderTextureBridge.prototype.present=globalThis.__priorityOriginal;});}
    await expect.poll(()=>page.evaluate(previous=>window.__librarySeekCompleted?.seekDiagnostics.seekId>previous,previous)).toBe(true);
    await expect.poll(async()=>(await api('/api/diagnostics')).thumbnail_service.yielding).toBe(false);row.priority.completedSeekReleased=true;
   }
   row.stress=[];
   for(let group=0;group<stressGroups;group++){
    const policy=group%2?'exact':'fast';
    if((await page.evaluate(()=>window.__librarySeek.seekPolicy))!==policy){await page.getByRole('button',{name:'跳播与播放设置',exact:true}).click();await page.getByLabel('跳播模式',{exact:true}).selectOption(policy);await page.getByRole('button',{name:'关闭播放设置',exact:true}).click();}
    const previous=await page.evaluate(()=>window.__librarySeek.seekDiagnostics?.seekId??0),paused=group%3===0,flip=process.env.AVHUB_TEST_SEEK_STRESS_FLIP==='1'&&group%4===0;
    if((await page.evaluate(()=>window.__librarySeek.properties.pause))!==(flip?!paused:paused))await page.keyboard.press('Space');
    const target=await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate(async(slider,{duration,group})=>{
     let target;for(let n=0;n<12;n++){target=Math.round(duration*((group*17+n*29+7)%89+5)/100*100)/100;slider.value=String(target);slider.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,4));}return target;
    },{duration:media.duration,group});
    if(flip)await page.keyboard.press('Space');
    await expect.poll(()=>page.evaluate(({previous,target})=>{const s=window.__librarySeekCompleted;return window.__librarySeek.phase==='error'?'error':s?.seekDiagnostics.seekId>previous&&Math.abs(s.seekDiagnostics.target-target)<.011?'done':'waiting';},{previous,target}),{timeout:20000,intervals:[10,20,40,80]}).toBe('done');
    await expect.poll(()=>page.evaluate(()=>window.__librarySeek.properties.pause)).toBe(paused);
    const s=await page.evaluate(()=>window.__librarySeekCompleted);assert.equal(s.sourceLoads,1);assert.equal(s.presented.seekId,s.seekDiagnostics.seekId);assert.equal(s.properties.pause,paused);if(s.seekDiagnostics.strategy==='exact')assert.ok(Math.abs(s.seekDiagnostics.errorSec)<.11,JSON.stringify(s.seekDiagnostics));row.stress.push({group,policy,paused,flip,dispatches:s.properties['avhub-seek-dispatches'],coalesced:s.properties['avhub-seek-coalesced'],...s.seekDiagnostics});
   }
   for(const policy of openOnly?[]:['fast','exact']){
    if((await page.evaluate(()=>window.__librarySeek.seekPolicy))!==policy){await page.getByRole('button',{name:'跳播与播放设置',exact:true}).click();await page.getByLabel('跳播模式',{exact:true}).selectOption(policy);await page.getByRole('button',{name:'关闭播放设置',exact:true}).click();}
    await expect.poll(()=>page.evaluate(()=>window.__librarySeek.seekPolicy)).toBe(policy);
    for(const paused of [true,false]){
     if((await page.evaluate(()=>window.__librarySeek.properties.pause))!==paused)await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__librarySeek.properties.pause)).toBe(paused);
     for(const fraction of [.073,.61,.25,.87,.4,.16]){
      const target=media.duration*fraction,previous=await page.evaluate(()=>window.__librarySeek.seekDiagnostics?.seekId??0),began=performance.now();
      await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((slider,value)=>{slider.value=String(value);slider.dispatchEvent(new Event('input',{bubbles:true}));},target);
      await expect.poll(()=>page.evaluate(previous=>window.__librarySeek.phase==='error'?'error':window.__librarySeekCompleted?.seekDiagnostics.seekId>previous?'done':'waiting',previous),{timeout:20000,intervals:[10,20,40,80]}).toBe('done');
      const s=await page.evaluate(()=>window.__librarySeekCompleted),timing=s.seekDiagnostics;assert.equal(s.presented.seekId,timing.seekId);assert.equal(timing.sourceLoads,1);assert.equal(s.sourceLoads,1);assert.ok(timing.strategy===(policy==='fast'?'keyframe':'exact')||policy==='fast'&&timing.strategy==='exact'&&timing.corrections>0,'Only witnessed EOF correction may change fast to exact');if(timing.strategy==='exact')assert.ok(Math.abs(timing.errorSec)<.11,JSON.stringify(timing));
      row.seeks.push({policy,paused,target,observedMs:performance.now()-began,...timing,presented:s.presented,trace:s.properties['avhub-native-seek-trace'],drops:{output:s.properties['frame-drop-count'],decoder:s.properties['decoder-frame-drop-count']}});
     }
    }
   }
   if(process.env.AVHUB_TEST_CLOSE_DURING_SEEK==='1'){
    await page.getByRole('button',{name:'跳播与播放设置',exact:true}).click();await page.getByLabel('跳播模式',{exact:true}).selectOption('exact');await page.getByRole('button',{name:'关闭播放设置',exact:true}).click();
    await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((slider,value)=>{slider.value=String(value);slider.dispatchEvent(new Event('input',{bubbles:true}));},media.duration*.509);
    row.closeSeekWasPending=await page.evaluate(()=>window.__librarySeek.pendingSeek!==null);
    const began=performance.now();await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(ids.length);row.closeSeekMs=performance.now()-began;row.closedDuringSeek=true;
   }
   row.passed=true;
  }catch(error){row.error=String(error.stack??error);row.states=await page.evaluate(()=>window.__librarySeekStates);row.last=await page.evaluate(()=>window.__librarySeek);}
  finally{
   const back=page.getByRole('button',{name:'返回媒体库',exact:true});if(await back.count())await back.click();await expect(page.locator('.card')).toHaveCount(ids.length);if(row.priority?.pauseReleased){await expect.poll(async()=>(await api('/api/diagnostics')).thumbnail_service.yielding).toBe(false);row.priority.closedReleased=true;}assert.deepEqual(await identity(media.path),before);row.sourceUnchanged=true;
   writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));
  }
 }
 report.completed=true;report.passed=report.rows.every(row=>row.passed);if(!report.passed)process.exitCode=1;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await desktop?.close();writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}
