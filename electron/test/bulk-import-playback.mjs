// Real Electron / normal window policy. Owned generated sources only. The
// already-playing original video stays open while another root is indexed.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,copyFileSync,readFileSync,writeFileSync,statSync,statfsSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
import {installPlaybackTimeline,frameIntervals} from './playback-timeline.mjs';
import {startSteadyFrames,summarizeSteadyFrames} from './steady-frame-observation.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const sqlitePin=JSON.parse(readFileSync(path.join(root,'app/sqlite-runtime.json'),'utf8'));
const count=Number(process.argv.find(arg=>arg.startsWith('--videos='))?.slice(9)??1200);
const label=process.argv.find(arg=>arg.startsWith('--label='))?.slice(8)??'local';
const searchChecks=process.argv.includes('--search-checks');
const frameComparison=process.argv.includes('--frame-comparison');
const captureDiagnostics=process.argv.includes('--capture-diagnostics');
const memoryBarrierChecks=process.argv.includes('--memory-barrier-checks');
const playbackFps=Number(process.argv.find(arg=>arg.startsWith('--playback-fps='))?.slice(15)??12);
assert.ok([12,60].includes(playbackFps));
const readinessMode=process.argv.find(arg=>arg.startsWith('--readiness='))?.slice(12)??'on';
assert.ok(['on','off'].includes(readinessMode));
const readinessEnabled=readinessMode==='on';
assert.ok(Number.isSafeInteger(count)&&count>=600&&count<=2000);assert.match(label,/^[a-z0-9-]{1,32}$/);
const workspace=ownedTemporaryWorkspace('avhub-bulk-playback-'),profile=path.join(workspace,'profile');
const playingRoot=path.join(workspace,'watch'),bulkRoot=path.join(workspace,'bulk');mkdirSync(playingRoot);mkdirSync(bulkRoot);
const artifact=path.join(root,'build','bulk-playback-'+path.basename(workspace));mkdirSync(artifact,{recursive:true});
assert.ok(statfsSync(workspace).bavail*statfsSync(workspace).bsize>1024**3);
const video=path.join(playingRoot,'Owned playback target.mp4'),template=path.join(workspace,'owned-import-template.mp4');
function encode(file,seconds,fps=12){
 const result=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i',`testsrc2=s=320x180:r=${fps}`,'-t',String(seconds),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',file],{windowsHide:true,timeout:30000});
 assert.equal(result.status,0,result.stderr?.toString());
}
encode(video,300,playbackFps);encode(template,2);
if(memoryBarrierChecks)writeFileSync(path.join(playingRoot,'Owned playback target.srt'),'1\n00:00:01,000 --> 00:00:04,000\nOwned subtitle fixture\n');
assert.ok(statSync(template).size*count<256*1024**2);
const imported=[];
for(let n=0;n<count;n++){
 const folder=path.join(bulkRoot,`Group ${String(Math.floor(n/20)).padStart(3,'0')}`);if(n%20===0)mkdirSync(folder);
 const file=path.join(folder,`Owned import ${String(n).padStart(4,'0')}.mp4`);copyFileSync(template,file);imported.push(file);
}
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const before={videoHash:hash(video),templateHash:hash(template),copies:imported.map(file=>({size:statSync(file).size,mtime:statSync(file).mtimeMs}))};
const report={schema:1,label,videos:count,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),completed:false,cleanExit:false,sourceUnchanged:false,phases:[],errors:[],limitations:[
 `Real Electron normal GPU/sandbox, Playwright attached. Generated H.264 SDR 320x180 ${playbackFps}fps; not real-media, cold-disk or physical-display acceptance.`,
 'Fresh import uses real FFprobe; no prebuilt index or fake scan. Cover decoding deliberately yields to playing video, then drains after returning.',
 'Pause/resume invokes the real video element in the application; actual progress PUT responses and persisted positions are checked. Return uses the application button.',
 'Counts are connection operations, not fsync or physical I/O. Single before/after runs cannot establish general latency percentages.',
]};
report.saveSchedule=frameComparison?'ordinary-periodic-8s-and-return':'processed-fractions-5-30-55-80';
report.searchChecksEnabled=searchChecks;
report.readinessEnabled=readinessEnabled;
report.frameComparison=frameComparison;report.playbackFps=playbackFps;
const persist=()=>writeFileSync(path.join(artifact,'acceptance.json'),JSON.stringify(report,null,2));persist();
let desktop,page,api,mediaId,bulkId;
async function snapshot(){return page.locator('.player-shell video').evaluate(v=>({time:v.currentTime,paused:v.paused,ready:v.readyState,source:v.currentSrc,total:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames,...window.__bulkEvents}));}
function saveResponse(minimum,updatedAfter=0){
 const promise=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/media/${mediaId}/progress`&&r.request().method()==='PUT'&&r.request().postDataJSON()?.progress>=minimum-.1&&r.request().postDataJSON()?.updated_at>=updatedAfter,{timeout:25000});
 void promise.catch(()=>{});return promise;
}
async function savedTrace(response){
 const scope=Number(response.headers()['x-avhub-save-trace']);assert.ok(Number.isSafeInteger(scope)&&scope>0,'Successful save must carry its diagnostic correlation ID');
 const report=(await api('/api/diagnostics')).database_timing;
 const operation=report.save_trace.operations.find(row=>row.scope_id===scope);
 assert.ok(operation,'The HTTP response must map to its actual database operation');
 assert.equal(operation.transaction_outcome,'committed');
 const observedWriter=[...report.slow_operations,...report.lifetime.worst_operations].find(row=>row.connection_id===operation.observed_writer_connection_id)??null;
 return{operation,observedWriter};
}
async function checkMemoryBarriers(){
 // Functional fault injection AFTER performance measurements, never included
 // in reported pause latency. Use actual controls and real persisted progress.
 report.memoryBarriers=[];
 const detail=await api(`/api/media/${mediaId}`),subtitle=detail.external_subtitles?.[0];assert.ok(subtitle);
 for(const fail of [false,true]){
  await page.goto(new URL(`/?video=${mediaId}`,page.url()).href);
  const element=page.locator('.player-shell video');
  await expect.poll(()=>element.evaluate(v=>v.readyState>=2&&!v.paused&&v.currentTime>.2)).toBe(true);
  let release,reject=fail,memoryWrites=0;const gate=new Promise(resolve=>release=resolve);
  await page.route(`**/api/media/${mediaId}/playback-state`,async route=>{
   if(route.request().method()!=='PATCH')return route.continue();
   memoryWrites++;await gate;return reject?route.fulfill({status:503,json:{detail:'owned memory failure'}}):route.continue();
  });
  const choice=fail?'':subtitle.path;
  try{
   // Put the whole player in view before revealing its untransformed hotzone.
   // Scrolling only a hidden bar can leave it beneath the sticky page header.
   const wrap=page.locator('.video-wrap');
   await wrap.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
   const hotzone=await wrap.evaluate(node=>{const bounds=node.getBoundingClientRect(),bar=node.querySelector('.player-controls');return{x:bounds.left+bounds.width/2,y:bounds.bottom-Math.min(20,bar.offsetHeight/2)};});
   await page.mouse.move(hotzone.x-8,hotzone.y);await page.mouse.move(hotzone.x,hotzone.y);
   await expect(wrap).not.toHaveClass(/controls-hidden/);
   const subtitles=page.getByRole('button',{name:'字幕',exact:true});await subtitles.hover();await subtitles.click();
   await page.getByRole('combobox',{name:'字幕轨道',exact:true}).selectOption(choice);
   await expect.poll(()=>memoryWrites).toBe(1);await page.keyboard.press('Escape');
   const saved=saveResponse((await element.evaluate(v=>v.currentTime)));await element.evaluate(v=>v.pause());
   const response=await saved;assert.ok(response.ok());const body=await response.json();
   assert.equal((await api(`/api/media/${mediaId}`)).progress,body.progress);
   await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
   await expect(page.getByRole('button',{name:'正在保存…',exact:true})).toBeVisible();
   await expect(page.locator('.player-shell')).toHaveCount(1);release();
   if(fail){
    await expect(page.locator('.player-shell .notice[role="alert"]')).toContainText('进度已保存，但播放记忆尚未保存');
    await expect(page.locator('.player-shell')).toHaveCount(1);reject=false;
    await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
   }
   await expect(page.locator('.player-shell')).toHaveCount(0);
   assert.equal((await api(`/api/media/${mediaId}/playback-state`)).subtitle,choice);
   assert.equal(memoryWrites,fail?3:1,'Overlapping confirmations share one automatic retry; explicit retry remains separate');
   report.memoryBarriers.push({fail,durableProgressBeforeMemoryReleased:true,navigationWaited:true,retried:fail,memoryWrites});persist();
  }finally{release();await page.unrouteAll({behavior:'wait'});}
 }
}
async function compareFrames(){
 const comparison=report.comparison={warmupMs:3000,windows:[]};persist();
 await page.goto(new URL(`/?video=${mediaId}`,page.url()).href);
 const element=page.locator('.player-shell video');
 await expect.poll(()=>element.evaluate(v=>v.readyState>=2&&!v.paused&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:30000}).toBe(true);
 await element.evaluate(installPlaybackTimeline);
 await page.waitForTimeout(comparison.warmupMs);
 const source=await element.evaluate(v=>v.currentSrc);
 async function window(name){
  const scanBefore=await api('/api/scan');
  await element.evaluate(startSteadyFrames);await page.waitForTimeout(8000);
  const trace=await element.evaluate(()=>window.__steadyFrames.stop()),scanAfter=await api('/api/scan');
  const summary=summarizeSteadyFrames(trace,playbackFps);
  comparison.windows.push({name,scanBefore,scanAfter,summary,trace});persist();
  console.log(JSON.stringify({window:name,fps:playbackFps,...summary}));
  assert.equal(trace.frameCallbacksSupported,true);assert.equal(summary.omitted,0);
  assert.ok(summary.total>0&&summary.mediaSeconds>6);assert.equal(summary.allPlaying,true);
  assert.equal(summary.allVisible,true);assert.deepEqual(summary.events,[]);
  assert.equal(await element.evaluate(v=>v.currentSrc),source);
 }
 await window('idle-before');
 await api(`/api/scan?root_id=${bulkId}`,'POST');await window('scanning');
 const scanning=comparison.windows[1];assert.ok(['running','discovering'].includes(scanning.scanBefore.state));
 assert.ok(['running','discovering'].includes(scanning.scanAfter.state),'The full measurement must overlap real metadata work');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:180000}).toBe('completed');
 await window('idle-after');
 comparison.timeline=await element.evaluate(()=>({rows:window.__playbackTimeline.rows.slice(),longTasks:window.__playbackTimeline.longTasks.slice(),longTasksSupported:window.__playbackTimeline.longTasksSupported}));
 if(captureDiagnostics){
  // Separate explicit 8s capture AFTER all timed windows have stopped.
  const destination=path.join(workspace,'owned-playback-diagnostics.json');
  await desktop.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},destination);
  await page.locator('.playback-diagnostics summary').click();
  await page.getByRole('button',{name:'采集并导出播放诊断（8 秒）',exact:true}).click();
  await expect(page.getByText('播放诊断已保存',{exact:true})).toBeVisible({timeout:20000});
  comparison.exportedDiagnostics=JSON.parse(readFileSync(destination,'utf8'));
  const display=comparison.exportedDiagnostics.display;
  assert.ok(display.first.reportedRefreshHz>0&&display.last.reportedRefreshHz>0);
  const scheduling=comparison.exportedDiagnostics.playback.scheduling;
  assert.ok(scheduling.animationGapMs.count>0&&scheduling.predictedPresentationGapMs.count>0);
  assert.ok(scheduling.animationGapMs.count<=4096&&scheduling.reportedProcessingMs.count<=4096);
  assert.equal(scheduling.truncated,false);
  assert.ok(comparison.exportedDiagnostics.summary.observations.some(text=>text.includes('不是实测物理刷新率')));
 }
 const stamp=Date.now(),saved=saveResponse(0,stamp);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();const returned=await saved;assert.ok(returned.ok());
 const returnedBody=await returned.json();comparison.returnTrace=await savedTrace(returned);
 assert.equal((await api(`/api/media/${mediaId}`)).progress,returnedBody.progress);
 await expect(page.locator('.player-shell')).toHaveCount(0);
 await expect.poll(async()=>{const t=await api('/api/thumbnails');return t.pending===0&&t.current===null;},{timeout:180000}).toBe(true);
 comparison.scan=await api('/api/scan');comparison.thumbnails=await api('/api/thumbnails');
 assert.equal(comparison.scan.processed,count);assert.equal(comparison.scan.error_count,0);assert.equal(comparison.thumbnails.failed,0);
 assert.equal(comparison.thumbnails.published,count+1);
 comparison.diagnostics=await api('/api/diagnostics');
 assert.equal(comparison.diagnostics.sqlite_runtime.verified,true);
 comparison.saves=comparison.timeline.rows.filter(row=>row.kind==='fetch-headers').map(row=>{
  const start=comparison.timeline.rows.find(candidate=>candidate.kind==='fetch-start'&&candidate.updatedAt===row.updatedAt);
  const operation=comparison.diagnostics.database_timing.save_trace.operations.find(candidate=>candidate.scope_id===Number(row.scope));
  assert.ok(start&&operation);assert.equal(operation.transaction_outcome,'committed');
  assert.match(row.serverHttpMs,/^\d+\.\d+$/);assert.match(row.serverHandlerMs,/^\d+\.\d+$/);
  return {fetchMs:row.at-start.at,httpMs:Number(row.serverHttpMs),handlerMs:Number(row.serverHandlerMs),database:operation};
 });
 assert.ok(comparison.saves.length>=2,'Observe ordinary periodic saves during uninterrupted playback');persist();
}
async function phase(name){
 const phase={name,pauseSaves:[],samples:[],searches:[],activeScanSamples:0,returnedDuringScan:false};report.phases.push(phase);persist();
 await page.goto(new URL(`/?video=${mediaId}`,page.url()).href);
 const element=page.locator('.player-shell video');
 await expect.poll(()=>element.evaluate(v=>v.readyState>=2&&!v.paused&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:30000}).toBe(true);
 await element.evaluate(v=>{window.__bulkEvents={waiting:0,stalled:0,reloads:0};for(const event of ['waiting','stalled','loadstart'])v.addEventListener(event,()=>window.__bulkEvents[event==='loadstart'?'reloads':event]++);});
 await element.evaluate(installPlaybackTimeline);
 phase.first=await snapshot();phase.before=(await api('/api/diagnostics')).database_timing.lifetime;
 phase.startedAt=Date.now();await api(`/api/scan?root_id=${bulkId}`,'POST');
 // Pause/save/return while metadata work is live, not only after import ends.
 for(let n=0;n<4;n++){
  const target=Math.floor(count*[.05,.30,.55,.80][n]);
  await expect.poll(async()=>{const s=await api('/api/scan');return s.processed>=target||s.state==='completed';},{timeout:180000}).toBe(true);
  const scan=await api('/api/scan');if(['running','discovering'].includes(scan.state))phase.activeScanSamples++;
  phase.samples.push({processed:scan.processed,state:scan.state,video:await snapshot()});persist();
  if(searchChecks){
   const started=performance.now(),query=n%2?'Owned import':'Owned import 00';
   const found=await api('/api/media?'+new URLSearchParams({q:query,page:'1',page_size:'48'}));
   assert.ok(found.total>0);assert.equal(found.items.length,Math.min(found.total,48));
   assert.ok(found.items.every(item=>item.name.startsWith('Owned import ')));
   phase.searches.push({duringScan:['running','discovering'].includes(scan.state),query,total:found.total,elapsedMs:performance.now()-started,video:await snapshot()});
  }
  await element.evaluate(()=>window.__playbackTimeline.record('steady-start'));
  await page.waitForTimeout(750);
  const minimum=(await snapshot()).time,response=saveResponse(minimum),began=Date.now();
  const commandStarted=performance.now(),commandDispatchedAt=Date.now();
  const invoked=await element.evaluate(v=>{window.__playbackTimeline.record('steady-end');const mark=window.__playbackTimeline.record('pause-call');v.pause();return mark;});
  const commandMs=performance.now()-commandStarted;
  const saved=await response;assert.ok(saved.ok());const body=await saved.json();
  const responseMs=performance.now()-commandStarted;
  const paused=await snapshot();assert.ok(Math.abs(body.progress-paused.time)<.15,'Actual durable response must match the paused frame time');
  const stored=await api(`/api/media/${mediaId}`);assert.ok(Math.abs(stored.progress-paused.time)<.15);
  const finishedAt=Date.now(),database=await savedTrace(saved);
  const timeline=await element.evaluate(()=>window.__playbackTimeline.rows.slice());
  const start=timeline.find(row=>row.kind==='fetch-start'&&row.updatedAt===saved.request().postDataJSON().updated_at);
  const headers=timeline.find(row=>row.kind==='fetch-headers'&&row.updatedAt===start?.updatedAt);
  const pause=timeline.find(row=>row.kind==='pause'&&row.at>=invoked.at);
  assert.ok(start&&headers&&pause,'Actual pause event and exact saved request must be observed');
  assert.equal(Number(headers.scope),database.operation.scope_id);
  assert.match(headers.serverHttpMs,/^\d+\.\d+$/);assert.match(headers.serverHandlerMs,/^\d+\.\d+$/);
  assert.ok(Number(headers.serverHttpMs)>=Number(headers.serverHandlerMs),'HTTP boundary must include the actual handler');
  phase.pauseSaves.push({startedAt:began,finishedAt,elapsedMs:finishedAt-began,progress:body.progress,database,
   timeline:{commandRoundTripMs:commandMs,dispatchToInvocationWallMs:invoked.wallAt-commandDispatchedAt,
    responseObservedMs:responseMs,verificationMs:finishedAt-began-responseMs,
    pauseObserverMs:pause.at-invoked.at,pauseCallToFetchMs:start.at-invoked.at,
    observerToFetchSignedMs:start.at-pause.at,fetchToHeadersMs:headers.at-start.at,
    serverHttpMs:headers.serverHttpMs===null?null:Number(headers.serverHttpMs),
    serverHandlerMs:headers.serverHandlerMs===null?null:Number(headers.serverHandlerMs),
    requestUpdatedAt:start.updatedAt,scope:headers.scope}});persist();
  await page.waitForTimeout(250); // Natural cover-yield release, not a delayed API response.
  if(n===3||scan.state==='completed')break;
  await element.evaluate(v=>{window.__playbackTimeline.record('paused-settled');window.__playbackTimeline.record('play-call');return v.play();});
 }
 await element.evaluate(()=>window.__playbackTimeline.record('phase-end'));
 phase.rendererTimeline=await element.evaluate(()=>({origin:window.__playbackTimeline.origin,rows:window.__playbackTimeline.rows.slice(),longTasks:window.__playbackTimeline.longTasks.slice(),longTasksSupported:window.__playbackTimeline.longTasksSupported}));
 phase.frameIntervals=frameIntervals(phase.rendererTimeline.rows);
 phase.steadyWindows=[];
 let steadyStart=null;
 for(const row of phase.rendererTimeline.rows){
  if(row.kind==='steady-start')steadyStart=row;
  if(row.kind==='steady-end'&&steadyStart){
   const intervening=phase.rendererTimeline.rows.filter(event=>event.at>=steadyStart.at&&event.at<=row.at&&['pause','playing','seeking','waiting','stalled','loadstart'].includes(event.kind));
   phase.steadyWindows.push({ms:row.at-steadyStart.at,total:row.total-steadyStart.total,dropped:row.dropped-steadyStart.dropped,uninterrupted:!intervening.length});
   steadyStart=null;
  }
 }
 phase.last=await snapshot();assert.equal(phase.last.source,phase.first.source);assert.equal(phase.last.reloads,0);
 assert.ok(phase.last.total>phase.first.total&&phase.last.time>phase.first.time,'Actual decoded frames and media clock must advance');
 const scanBeforeReturn=await api('/api/scan');phase.returnedDuringScan=['running','discovering'].includes(scanBeforeReturn.state);
 if(name==='fresh')assert.ok(phase.activeScanSamples>0&&phase.returnedDuringScan,'Fresh acceptance must really overlap playback/saves/return with active bulk indexing');
 const stamp=Date.now(),returning=performance.now(),saved=saveResponse(phase.last.time,stamp);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();const returnedSave=await saved;assert.ok(returnedSave.ok());
 await expect(page.locator('.player-shell')).toHaveCount(0);await expect(page.locator('.card').first()).toBeVisible();
 phase.returnMs=Math.round(performance.now()-returning);phase.returnTrace=await savedTrace(returnedSave);persist();
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:180000}).toBe('completed');
 phase.scan=await api('/api/scan');phase.scanMs=Math.round((phase.scan.finished_at-phase.scan.started_at)*1000);
 assert.equal(phase.scan.error_count,0);assert.equal(phase.scan.processed,count);
 if(name==='incremental')assert.equal(phase.scan.updated,0);
 await expect.poll(async()=>{const t=await api('/api/thumbnails');return t.pending===0&&t.current===null;},{timeout:180000}).toBe(true);
 phase.thumbnails=await api('/api/thumbnails');assert.equal(phase.thumbnails.failed,0);
 if(searchChecks){
  for(const query of ['Owned import 00','Owned import']){
   const expected=query.endsWith('00')?100:count;
   const found=await api('/api/media?'+new URLSearchParams({q:query,page:'99999',page_size:'48',sort:'name'}));
   assert.equal(found.total,expected);assert.equal(found.page,Math.ceil(expected/48));
   const offset=(found.page-1)*48;
   assert.deepEqual(found.items.map(item=>item.name),imported.slice(0,expected).slice(offset).map(file=>path.basename(file)));
   phase.searches.push({afterScan:true,query,total:found.total,page:found.page,ids:found.items.map(item=>item.id)});
  }
 }
 const diagnostic=await api('/api/diagnostics');phase.after=diagnostic.database_timing.lifetime;phase.services=diagnostic.service_lifecycle;
 phase.operationTiming=diagnostic.database_timing.operation_lifetime;
 assert.ok(phase.operationTiming.groups['read:scan-reconcile'].count>0);
 assert.equal(phase.operationTiming.groups['serialized:scan-reconcile'],undefined,'Unchanged roots must not enter the writer queue');
 const publication=phase.operationTiming.groups['serialized:cover-publish'];
 assert.equal(publication.changed_rows,phase.thumbnails.published*2,'Each committed cover must update metadata and delete its job together');
 assert.equal(phase.operationTiming.groups['serialized:cover-queue'].changed_rows,0,
  'Fresh metadata must enqueue its cover in the same transaction, without standalone queue writes');
 const indexed=phase.operationTiming.groups['serialized:scan-media'];
 assert.equal(indexed.count,phase.thumbnails.published,'Each generated source has one metadata/enqueue transaction');
 assert.equal(indexed.changed_rows,phase.thumbnails.published*4,
  'Metadata insert, source identity, series assignment and cover enqueue must all remain persisted');
 phase.scanReadiness=diagnostic.scan_readiness;
 assert.equal(phase.scanReadiness.policy,'observe-only-no-batching');
 assert.equal(phase.scanReadiness.enabled,readinessEnabled);
 assert.equal(phase.scanReadiness.outcomes.committed,readinessEnabled?indexed.count:0);
 for(const key of ['cancelled','failed','abandoned'])assert.equal(phase.scanReadiness.outcomes[key],0);
 assert.equal(phase.scanReadiness.omitted,0);assert.equal(phase.scanReadiness.invalid_transitions,0);
 assert.equal(phase.scanReadiness.other_ready_at_writer_entry_counts.reduce((a,b)=>a+b,0),readinessEnabled?indexed.count:0);
 assert.ok(phase.scanReadiness.peak_active<=2,'Production scan keeps its existing two-worker bound');
 assert.ok(phase.scanReadiness.other_ready_at_writer_entry_counts.slice(2).every(n=>n===0),
  'There cannot be a four/eight-item ready queue in the unchanged production pipeline');
 phase.publicationGate=diagnostic.thumbnail_service.publication_gate;
 assert.equal(phase.publicationGate.policy,'observe-existing-rlock');
 assert.equal(phase.publicationGate.groups['scan-media'].count,indexed.count);
 const coverGate=phase.publicationGate.groups['cover-publish'];
 assert.equal(coverGate.count-coverGate.failed,phase.thumbnails.published,
  'Cancelled publication attempts may enter the gate without a database commit; only completed holds count here');
 assert.ok(coverGate.count>=publication.count,'Every database publication attempt must still be protected by the gate');
 assert.ok(Object.keys(phase.publicationGate.groups).length<=phase.publicationGate.group_capacity);
 assert.ok(phase.publicationGate.recent.some(row=>row.operation==='cover-publish'&&Number.isSafeInteger(row.scope_id)),
  'Real cover publication must retain the database correlation scope');
 phase.writeQueue=diagnostic.database_write_queue;
 phase.sqlite=diagnostic.sqlite_runtime;
 assert.equal(phase.sqlite.policy,'pinned-private-runtime');assert.equal(phase.sqlite.verified,true);
 assert.equal(phase.sqlite.version,sqlitePin.version);assert.equal(phase.sqlite.source_id,sqlitePin.source_id);
 assert.equal(phase.sqlite.sha256,sqlitePin.dll_sha256);
 assert.equal(phase.writeQueue.policy,'serialized-save-priority');assert.equal(phase.writeQueue.save_burst_limit,4);
 assert.ok(phase.writeQueue.served_saves>0,'Real progress requests must enter the save-priority lane');
 assert.ok(Object.values(phase.services.steps).every(s=>s.error===null));
 phase.finishedAt=Date.now();persist();console.log(JSON.stringify({phase:name,scanMs:phase.scanMs,pauseMs:phase.pauseSaves.map(s=>s.elapsedMs),returnMs:phase.returnMs,returnedDuringScan:phase.returnedDuringScan}));
}
try{
 desktop=await _electron.launch({args:[root],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:workspace,AVHUB_PROFILE_PROGRESS:'1',AVHUB_PROFILE_SCAN_READY:readinessEnabled?'1':'0',AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow({timeout:50000});page.on('pageerror',e=>report.errors.push(e.message));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 report.policy=await desktop.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();const d=screen.getDisplayMatching(w.getBounds());return{sandbox:w.webContents.getLastWebPreferences().sandbox,backgroundThrottling:w.webContents.getBackgroundThrottling(),bounds:w.getBounds(),workArea:d.workArea,frequency:d.displayFrequency,scale:d.scaleFactor};});
 assert.equal(report.policy.sandbox,true);assert.equal(report.policy.backgroundThrottling,true);
 api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/preferences','PATCH',{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,hoverPreview:false,audio:{volume:0,muted:true}}});
 await api('/api/roots','POST',{path:playingRoot});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await expect.poll(async()=>(await api('/api/thumbnails')).pending,{timeout:30000}).toBe(0);
 mediaId=(await api('/api/media?page=1')).items[0].id;bulkId=(await api('/api/roots','POST',{path:bulkRoot})).id;
 if(frameComparison)await compareFrames();else{await phase('fresh');await phase('incremental');}
 if(memoryBarrierChecks)await checkMemoryBarriers();
 assert.equal((await api('/api/media?page=1')).total,count+1);assert.deepEqual(report.errors,[]);
 const closing=desktop.waitForEvent('close',{timeout:25000});await desktop.evaluate(({app})=>app.quit());await closing;desktop=null;report.cleanExit=true;
 assert.equal(hash(video),before.videoHash);assert.equal(hash(template),before.templateHash);
 assert.deepEqual(imported.map(file=>({size:statSync(file).size,mtime:statSync(file).mtimeMs})),before.copies);
 report.sourceUnchanged=true;report.walAfterExit=existsSync(path.join(profile,'library.db-wal'));assert.equal(report.walAfterExit,false);
 report.completed=true;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:path.join(artifact,'failure.png')}).catch(()=>{});throw error;}
finally{if(desktop)await desktop.close().catch(error=>report.errors.push(String(error)));persist();console.log('Bulk playback evidence:',path.join(artifact,'acceptance.json'));}
