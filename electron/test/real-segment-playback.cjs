const {app,BrowserWindow,screen,dialog}=require('electron');
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync,renameSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const config=JSON.parse(readFileSync(process.env.AVHUB_REAL_SEGMENT_CONFIG,'utf8'));
assert.equal(app.isPackaged,false);assert.equal(path.dirname(config.profile),config.folder);
assert.match(path.basename(config.folder),/^real-segment-/);assert.equal(path.dirname(config.folder),path.join(config.root,'build'));
for(const option of ['inspect','inspect-brk','remote-debugging-port','remote-debugging-pipe','disable-gpu','no-sandbox'])assert.equal(app.commandLine.hasSwitch(option),false);
assert.equal(app.commandLine.hasSwitch('disable-accelerated-video-decode'),config.softwareDecodeControl===true);
app.setAppPath(config.root);
const report={build:config.build,requested:{start:config.start,end:config.end},decoderPolicy:config.softwareDecodeControl?'software-decode-control-only':'normal-platform-choice',metadata:{codec:config.metadata.codec??null,width:config.metadata.width,height:config.metadata.height},completed:false,cleanExit:false,sourceIdentityVerified:false,chunks:[],processSamples:[],errors:[],limitations:[
 config.softwareDecodeControl?'Separate diagnostic: accelerated video decoding disabled in this owned process only; graphics GPU/sandbox/background policy unchanged. Not a production recommendation.':'Normal visible Electron, original-file playback, no inspector/Playwright/GPU or background-throttling override during baseline.',
 'One-minute bounded frame observers are restarted without pausing playback; brief observation boundaries are not claimed gap-free.',
 'Muted output; no physical sound/lip-sync acceptance. Frame callbacks are not physical monitor scanout.',
 'Completion means the requested interval was measured, not a smoothness pass. No screenshots or video copies.',
]};
const file=path.join(config.folder,'segment.json');const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(report,null,2));renameSync(file+'.tmp',file);};
const run=(window,fn,arg)=>window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`);
const wait=async(fn,label,ms=45000)=>{const until=Date.now()+ms;for(;;){const value=await fn();if(value)return value;if(Date.now()>until)throw new Error('Timeout: '+label);await delay(100);}};
const metrics=main=>({at:Date.now(),visible:main.isVisible(),focused:main.isFocused(),minimized:main.isMinimized(),processes:app.getAppMetrics().map(m=>({type:m.type,pid:m.pid,cpu:m.cpu.percentCPUUsage,workingSetKiB:m.memory.workingSetSize}))});
save();require(path.join(config.root,'electron/dist/main.js'));
app.whenReady().then(async()=>{
 let main;
 try{
  main=await wait(()=>BrowserWindow.getAllWindows().find(w=>/^http:\/\/127\.0\.0\.1:/.test(w.webContents.getURL())),'main window',60000);
  main.show();main.focus();
  await wait(()=>run(main,()=>Boolean(document.querySelector('section.library'))),'library');
  assert.equal(main.webContents.getBackgroundThrottling(),true);assert.equal(main.webContents.getLastWebPreferences().sandbox,true);
  report.display={bounds:main.getBounds(),scale:screen.getDisplayMatching(main.getBounds()).scaleFactor,refreshHz:screen.getDisplayMatching(main.getBounds()).displayFrequency};
  report.graphics=app.getGPUFeatureStatus();
  await run(main,()=>{
   window.__segmentLoads={count:0};document.addEventListener('loadstart',event=>{if(event.target instanceof HTMLVideoElement&&event.target.matches('.player-shell video'))window.__segmentLoads.count++;},true);
   const url=new URL(location.href);url.searchParams.set('video','1');history.pushState({...history.state,avhubIndex:1,avhubLibraryIndex:0},'',url);dispatchEvent(new PopStateEvent('popstate'));
  });
  const first=await wait(()=>run(main,()=>{const v=document.querySelector('.player-shell video');if(!v||v.paused||v.seeking||v.readyState<2||!v.videoWidth||v.getVideoPlaybackQuality().totalVideoFrames===0)return null;v.dataset.segmentIdentity='original';const q=v.getVideoPlaybackQuality();return {time:v.currentTime,source:v.currentSrc,total:q.totalVideoFrames,dropped:q.droppedVideoFrames,width:v.videoWidth,height:v.videoHeight,mode:document.querySelector('.playback-diagnostics summary')?.textContent};}),'actual original playback');
  assert.equal(new URL(first.source).pathname,'/media/1/file');assert.ok(Math.abs(first.time-config.start)<2);
  assert.equal(first.width,config.metadata.width);assert.equal(first.height,config.metadata.height);
  report.startup={...first,source:'original-file'};const stableSource=first.source;
  const {startSteadyFrames,summarizeSteadyFrames}=await import(pathToFileURL(path.join(config.root,'electron/test/steady-frame-observation.mjs')).href);
  const startSampler=()=>main.webContents.executeJavaScript(`(${startSteadyFrames.toString()})(document.querySelector('.player-shell video'))`);
  const began=Date.now();let state=first;
  while(state.time<config.end&&Date.now()-began<(config.end-config.start+120)*1000){
   assert.equal(main.webContents.debugger.isAttached(),false);assert.equal(main.webContents.isDevToolsOpened(),false);
   await startSampler();const duration=Math.min(60000,Math.max(100,(config.end-state.time)*1000));await delay(duration);
   const trace=await run(main,()=>window.__steadyFrames.stop());
   state=await run(main,()=>{const v=document.querySelector('.player-shell video'),q=v.getVideoPlaybackQuality();return {time:v.currentTime,source:v.currentSrc,identity:v.dataset.segmentIdentity,total:q.totalVideoFrames,dropped:q.droppedVideoFrames,width:v.videoWidth,height:v.videoHeight,rate:v.playbackRate,loads:window.__segmentLoads.count};});
   const summary=summarizeSteadyFrames(trace,30000/1001);
   report.chunks.push({index:report.chunks.length,summary,trace});report.processSamples.push(metrics(main));
   report.latest={...state,source:state.source===stableSource?'original-file':'changed'};save();
   console.log(JSON.stringify({time:state.time,frames:summary.total,dropped:summary.dropped,clockRatio:summary.mediaSeconds/(summary.elapsedMs/1000),gapP95:summary.presentationMs.p95,gapMax:summary.presentationMs.max,events:summary.events,visible:summary.allVisible}));
   assert.equal(state.source,stableSource);assert.equal(state.identity,'original');assert.equal(state.width,config.metadata.width);assert.equal(state.height,config.metadata.height);assert.equal(state.rate,1);
  }
  report.completed=state.time>=config.end;assert.equal(report.completed,true,'requested media interval must finish');
  report.baselineNoInspector=true;save();
  // Separate ordinary on-demand diagnostic AFTER the nine-minute baseline.
  const exportPath=path.join(config.folder,'decoder-after-baseline.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:exportPath});
  try{const exported=await run(main,()=>window.avhubDesktop.saveExport({kind:'playback-diagnostics'}));report.decoderExport={result:exported,report:JSON.parse(readFileSync(exportPath,'utf8'))};}
  catch(error){report.decoderExport={error:String(error)};}
  save();app.quit();
 }catch(error){report.errors.push(String(error));save();process.exitCode=1;app.quit();}
});
