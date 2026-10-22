// Real Electron, normal GPU/sandbox, owned generated media only. Not a browser
// product test, a no-inspector experiment, or a benchmark of the paused real file.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,copyFileSync,readFileSync,writeFileSync,statfsSync,statSync,existsSync,realpathSync,renameSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
import {installPlaybackTimeline} from './playback-timeline.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const option=(name,fallback)=>Number(process.argv.find(arg=>arg.startsWith(`--${name}=`))?.split('=')[1]??fallback);
const seconds=option('seconds',1200),size=option('videos',600);
const stopFile=process.argv.find(arg=>arg.startsWith('--stop-file='))?.slice(12);
if(stopFile){
 const stop=path.resolve(stopFile),build=path.join(root,'build');
 assert.ok(stop.startsWith(build+path.sep),'Stop marker must be inside project build');
 assert.ok(realpathSync(path.dirname(stop)).startsWith(realpathSync(build)+path.sep),'Stop marker parent must be an owned build subdirectory');
}
assert.ok(Number.isSafeInteger(seconds)&&seconds>=60&&seconds<=7200);
assert.ok(Number.isSafeInteger(size)&&size>=192&&size<=2000);
const workspace=ownedTemporaryWorkspace('avhub-desktop-usage-'),media=path.join(workspace,'media'),profile=path.join(workspace,'profile');mkdirSync(media);
const space=statfsSync(workspace);assert.ok(space.bavail*space.bsize>1024**3,'Owned soak requires 1 GiB free');
const sample=path.join(media,'Owned video 0000.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12','-t','20','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',sample],{windowsHide:true,timeout:30000}).status,0);
assert.ok(statSync(sample).size*size<256*1024**2,'Generated library capacity bound exceeded');
for(let index=1;index<size;index++)copyFileSync(sample,path.join(media,`Owned video ${String(index).padStart(4,'0')}.mp4`));
const identity=()=>({sha256:createHash('sha256').update(readFileSync(sample)).digest('hex'),mtime:statSync(sample).mtimeMs,size:statSync(sample).size}),before=identity();
const report={schema:2,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),seconds,videos:size,completed:false,cleanExit:false,sourceUnchanged:false,cycles:[],errors:[],limitations:[
 'Generated 320x180 H.264 SDR library; not real-media 4K/HDR/long-GOP acceptance or the deferred problem video.',
 'Normal Electron GPU/sandbox, with Playwright transport attached; not a cold-cache, isolated frame-rate or no-inspector memory benchmark.',
 'Workload includes page changes, decoded cover art, decoded muted previews, original-file playback, incremental scans and thumbnail retries. Pause windows intentionally let cover work proceed.',
 'Process working sets are samples, GPU process RAM is not VRAM, and a bounded run does not prove leak freedom.',
 'frames/dropped cover the entire opened session including startup; activeFrames/activeDropped cover only the measured playing interval after readiness.',
]};
const artifact=path.join(root,'build','desktop-usage-'+path.basename(workspace));mkdirSync(artifact,{recursive:true});
const persist=()=>{const file=path.join(artifact,'soak.json');writeFileSync(file+'.tmp',JSON.stringify(report,null,2));renameSync(file+'.tmp',file);};persist();
let desktop,page,api,stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
const shouldStop=()=>stopping||Boolean(stopFile&&existsSync(path.resolve(stopFile)));
async function close(){
 let timer;try{await Promise.race([desktop.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Desktop usage exit timeout')),30000);})]);desktop=null;report.cleanExit=true;}finally{clearTimeout(timer);}
}
async function memory(){
 const values=await desktop.evaluate(({app})=>app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,workingSetKiB:m.memory.workingSetSize,privateKiB:m.memory.privateBytes??null})));
 assert.ok(values.every(m=>m.workingSetKiB<2*1024**2),'Safety stop: an Electron process exceeded 2 GiB working set');return values;
}
try{
 desktop=await _electron.launch({args:[root],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:workspace,AVHUB_PROFILE_PROGRESS:'1',AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow({timeout:50000});page.on('pageerror',e=>report.errors.push(e.message));
 report.windowPolicy=await desktop.evaluate(({BrowserWindow})=>{const contents=BrowserWindow.getAllWindows()[0].webContents,p=contents.getLastWebPreferences();return{backgroundThrottling:contents.getBackgroundThrottling(),sandbox:p.sandbox,contextIsolation:p.contextIsolation};});
 assert.equal(report.windowPolicy.backgroundThrottling,true);assert.equal(report.windowPolicy.sandbox,true);
 // Keep production's work-area-fitted startup bounds. An oversized test window
 // is not representative on small/high-DPI desktops; record display conditions.
 report.windowPlacement=await desktop.evaluate(({BrowserWindow,screen})=>{
  const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();
  const bounds=w.getBounds(),display=screen.getDisplayMatching(bounds),work=display.workArea;
  return{bounds,workArea:work,scale:display.scaleFactor,frequency:display.displayFrequency,
   withinWorkArea:bounds.x>=work.x&&bounds.y>=work.y&&bounds.x+bounds.width<=work.x+work.width&&bounds.y+bounds.height<=work.y+work.height};
 });
 assert.equal(report.windowPlacement.withinWorkArea,true);
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor({timeout:30000});
 api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
 await api('/api/preferences','PATCH',{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,hoverPreview:true,audio:{volume:0,muted:true}}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:180000}).toBe('completed');
 await expect.poll(async()=>{const t=await api('/api/thumbnails');return t.pending===0&&t.current===null;},{timeout:180000}).toBe(true);
 await page.goto(new URL('/?pageSize=96',page.url()).href);
 // Configure the preference through the actual UI. A late first-mount default
 // save can otherwise race a test-only API PATCH made after startup.
 await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
 await page.getByRole('checkbox',{name:'封面悬停预览',exact:true}).check();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 const baseline=await api('/api/diagnostics');
 report.initialDatabaseTiming=baseline.database_timing;
 const started=performance.now();report.workloadStartedAt=Date.now();let lastLog=0,direction=1;
 console.log('Desktop usage soak started:',JSON.stringify({seconds,videos:size,report:path.join(artifact,'soak.json')}));
 while(performance.now()-started<seconds*1000&&!shouldStop()){
   await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();});
   const cycle={elapsedSeconds:0,previews:0,decodedCovers:0,frames:0,dropped:0,waiting:0,stalled:0,unexpectedReloads:0,memories:[]};
   await expect(page.locator('.card').first()).toBeVisible({timeout:15000});
   const cards=page.locator('.card'),count=await cards.count();
   for(const index of [0,Math.floor(count/2),count-1]){
     const cover=cards.nth(index).locator('.cover');await cover.scrollIntoViewIfNeeded();
     await expect.poll(()=>cover.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:15000}).toBe(true);
     await cover.hover();await expect.poll(()=>page.locator('video.hover-preview').evaluateAll(videos=>videos.some(v=>v.readyState>=2&&v.getVideoPlaybackQuality().totalVideoFrames>0)),{timeout:10000}).toBe(true);
     cycle.previews++;await delay(250);
   }
   cycle.decodedCovers=await page.locator('.card img').evaluateAll(images=>images.filter(img=>img.complete&&img.naturalWidth>0).length);
   cycle.memories.push({phase:'browse',values:await memory()});
   await page.mouse.move(2,2);await expect(page.locator('video.hover-preview')).toHaveCount(0);
   await cards.first().locator('.open-video').click();
   const video=page.locator('.player-shell video');
   await expect.poll(()=>video.evaluate(v=>v.readyState>=2&&!v.paused&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:30000}).toBe(true);
   await video.evaluate(installPlaybackTimeline);
   await video.evaluate(v=>{window.__usage={waiting:0,stalled:0,reloads:0};for(const name of ['waiting','stalled','loadstart'])v.addEventListener(name,()=>window.__usage[name==='loadstart'?'reloads':name]++);});
   const first=await video.evaluate(v=>({time:v.currentTime,frames:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames}));
   if(report.cycles.length%3===0){
     copyFileSync(sample,path.join(media,`Owned discovered ${report.cycles.length}.mp4`));await api('/api/scan','POST');
     const rows=(await api('/api/media?page=1&page_size=4')).items;
     for(const row of rows)await api(`/api/media/${row.id}/thumbnail/retry`,'POST',{});
   }
   await delay(4000);
   const state=await video.evaluate(v=>({...window.__usage,time:v.currentTime,frames:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames}));
   assert.ok(state.frames>first.frames&&state.time>first.time,'Actual decoded frames and media clock must advance');
   assert.equal(state.reloads,0,'Background work cannot replace the active source');
   Object.assign(cycle,{frames:state.frames,dropped:state.dropped,waiting:state.waiting,stalled:state.stalled,unexpectedReloads:state.reloads});
   Object.assign(cycle,{readyFrames:first.frames,readyDropped:first.dropped,activeFrames:state.frames-first.frames,activeDropped:state.dropped-first.dropped});
   cycle.memories.push({phase:'play',values:await memory()});
   cycle.display=await desktop.evaluate(({BrowserWindow,screen})=>{
    const w=BrowserWindow.getAllWindows()[0],display=screen.getDisplayMatching(w.getBounds());
    return{frequency:display.displayFrequency,scale:display.scaleFactor};
   });
   const wal=path.join(profile,'library.db-wal');cycle.walBytes=existsSync(wal)?statSync(wal).size:0;
   const pauseStarted=Date.now(),pauseCommand=performance.now();
   await video.evaluate(v=>{window.__playbackTimeline.record('pause-call');v.pause();});cycle.pauseCommandMs=performance.now()-pauseCommand;
   await delay(2500);
   const thumbnails=await api('/api/thumbnails'),scan=await api('/api/scan');
   assert.equal(thumbnails.failed,0);assert.equal(scan.error_count,0);assert.notEqual(scan.state,'failed');
   cycle.thumbnailPublished=thumbnails.published;cycle.scanState=scan.state;
   const returning=performance.now(),mediaId=new URL(page.url()).searchParams.get('video');
   // The application's explicit save guard has a 20s write deadline. Observe
   // its actual response, then allow the ordinary 5s UI assertion to navigate.
   // Return latency remains reported; slow commits are never called fast.
   const saved=page.waitForResponse(response=>{
     if(new URL(response.url()).pathname!==`/api/media/${mediaId}/progress`||response.request().method()!=='PUT')return false;
     // A still-pending pause save may legitimately be shared by back(). A
     // completed pause save is not cached, so back then starts a fresh write.
     return response.request().postDataJSON()?.updated_at>=pauseStarted;
   },{timeout:25000});
   void saved.catch(()=>{}); // The outer catch still preserves a failed click.
   await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
   assert.ok((await saved).ok(),'Explicit progress save must succeed before returning');
   await expect(page.locator('.player-shell')).toHaveCount(0);await expect(page.locator('.card').first()).toBeVisible();
   cycle.returnMs=Math.round(performance.now()-returning);
   cycle.timeline=await page.evaluate(()=>{const t=window.__playbackTimeline;return {rows:t.rows.slice(),longTasks:t.longTasks.slice(),restored:t.stop()};});
   assert.equal(cycle.timeline.restored,true,'Each cycle must restore fetch instead of stacking observation wrappers');
   const returnedScope=Number((await saved).headers()['x-avhub-save-trace']);
   const timing=(await api('/api/diagnostics')).database_timing;
   cycle.progressSaves=cycle.timeline.rows.filter(row=>row.kind==='fetch-headers').map(row=>{
    const start=cycle.timeline.rows.find(candidate=>candidate.kind==='fetch-start'&&candidate.updatedAt===row.updatedAt);
    const database=timing.save_trace.operations.find(candidate=>candidate.scope_id===Number(row.scope));
    assert.ok(start&&database);assert.equal(database.transaction_outcome,'committed');
    assert.match(row.serverBodyReadyMs,/^\d+\.\d+$/);assert.match(row.serverDispatchMs,/^\d+\.\d+$/);
    return {updatedAt:row.updatedAt,scope:Number(row.scope),fetchMs:row.at-start.at,httpMs:Number(row.serverHttpMs),
     bodyReadyMs:Number(row.serverBodyReadyMs),dispatchMs:Number(row.serverDispatchMs),handlerMs:Number(row.serverHandlerMs),database};
   });
   assert.ok(cycle.progressSaves.some(row=>row.scope===returnedScope));
   const back=cycle.timeline.rows.find(row=>row.kind==='back-click'),dom=cycle.timeline.rows.find(row=>row.kind==='library-dom');
   assert.ok(back&&dom,'Separate the real click and library DOM commit from Playwright polling');cycle.returnDomMs=dom.at-back.at;
   assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
   cycle.memories.push({phase:'returned',values:await memory()});
   const next=page.getByRole('button',{name:direction===1?'下一页':'上一页',exact:true});
   if(await next.isDisabled())direction=-direction;
   await page.getByRole('button',{name:direction===1?'下一页':'上一页',exact:true}).click();
   cycle.elapsedSeconds=Math.round((performance.now()-started)/1000);report.cycles.push(cycle);persist();
   if(cycle.elapsedSeconds-lastLog>=60){lastLog=cycle.elapsedSeconds;console.log(JSON.stringify({elapsedSeconds:lastLog,cycles:report.cycles.length,previews:report.cycles.length*3,thumbnailPublished:thumbnails.published}));}
 }
 report.elapsedSeconds=(performance.now()-started)/1000;
 report.maxObservedWalBytes=Math.max(0,...report.cycles.map(c=>c.walBytes));
 assert.ok(!shouldStop()&&report.elapsedSeconds>=seconds,'Incomplete workload is not acceptance');
 assert.ok(report.cycles.length>=2);assert.deepEqual(identity(),before);report.sourceUnchanged=true;assert.deepEqual(report.errors,[]);
 const finalDiagnostics=await api('/api/diagnostics');
 report.sqliteRuntime=finalDiagnostics.sqlite_runtime;assert.equal(report.sqliteRuntime.verified,true);
 report.databaseTiming=finalDiagnostics.database_timing;report.databaseLifecycle=finalDiagnostics.database_lifecycle;
 report.serviceLifecycle=finalDiagnostics.service_lifecycle;
 report.publicationGate=finalDiagnostics.thumbnail_service.publication_gate;
 assert.equal(report.publicationGate.policy,'observe-existing-rlock');
 assert.ok(report.publicationGate.groups['scan-media'].count>=size);
 assert.equal(report.databaseLifecycle.connected,true);assert.equal(report.databaseLifecycle.error,null);
 assert.ok(report.databaseTiming.lifetime,'All-run database timing must be present');
 assert.ok(report.serviceLifecycle,'Maintenance evidence must be present');
 assert.ok(Object.values(report.serviceLifecycle.steps).every(step=>step.error===null),'Maintenance must not end with an unhandled failure');
 report.completed=true;await close();
 const wal=path.join(profile,'library.db-wal');report.walBytesAfterExit=existsSync(wal)?statSync(wal).size:0;
}catch(error){
 report.errors.push(String(error));
 if(page){report.failureEvidence=await page.evaluate(()=>({focused:document.hasFocus(),visible:document.visibilityState,hoveredCovers:document.querySelectorAll('.cover:hover').length,previews:[...document.querySelectorAll('video')].map(v=>({class:v.className,ready:v.readyState,paused:v.paused,error:v.error?.code,frames:v.getVideoPlaybackQuality().totalVideoFrames}))})).catch(()=>null);await page.screenshot({path:path.join(artifact,'failure.png')}).catch(()=>{});}
 throw error;
}
finally{report.sourceUnchanged=JSON.stringify(identity())===JSON.stringify(before);if(desktop)await close().catch(error=>report.errors.push(String(error)));persist();console.log('Desktop usage report:',path.join(artifact,'soak.json'));}
