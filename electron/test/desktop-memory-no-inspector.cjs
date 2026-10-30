// Test-only entry point, excluded from packaged files. Drives trusted preload
// IPC from the normal page without opening an inspector/debugging transport.
const {app,BrowserWindow,BaseWindow,screen,session}=require('electron');
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync,renameSync}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {setTimeout:delay}=require('node:timers/promises');
const config=JSON.parse(readFileSync(process.env.AVHUB_NO_INSPECTOR_CONFIG,'utf8'));
assert.equal(app.isPackaged,false);
assert.match(path.basename(config.workspace),/^avhub-no-inspector-/);
assert.equal(path.dirname(config.profile),config.workspace);
assert.equal(process.env.AVHUB_DATA_DIR,config.profile);
assert.ok(!process.execArgv.some(x=>/inspect|debug/i.test(x)));
assert.ok(!process.argv.some(x=>/--(?:inspect|remote-debugging)/.test(x)));
for(const option of ['inspect','inspect-brk','remote-debugging-port','remote-debugging-pipe'])assert.equal(app.commandLine.hasSwitch(option),false);
app.setAppPath(config.root);
const report={build:config.build,instrumentation:{playwright:false,inspector:false,driver:'main-webContents.executeJavaScript',forcedGc:false,cachePurge:false},
  phase:config.phase,walkPages:config.walkPages,playbackEngine:config.playbackEngine??'mpv',playbackEvery:config.playbackEvery??1,artwork:config.artwork??'present',resourceProbe:config.resourceProbe===true,backgroundUnthrottled:config.backgroundUnthrottled===true,settleMs:config.settleMs??150,cycleDelay:config.cycleDelay??3000,targetSeconds:config.seconds,targetReached:false,completed:false,cleanExit:false,sourceIdentityVerified:false,cycles:[],idle:[],errors:[],limitations:[
    'Automated main-process UI control, not manual interaction or physical mixed-DPI acceptance.',
    'Electron process working set/private bytes are not GPU VRAM or allocation attribution.',
    'Source hash before startup can warm OS caches. Not cold-disk startup measurement.',
    'No DOM/heap inspector counters. Optional webFrame resource counters describe Blink caches, not all allocations, decoded pixels or VRAM.',
    'Artwork-absent control clears only cloned index references; it is not a product optimization. Programmatic UI controls are not physical mouse/keyboard acceptance.']};
const file=path.join(config.workspace,'memory.json');
const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(report,null,2));renameSync(file+'.tmp',file);};
const wait=async(fn,label,timeout=35000)=>{const end=Date.now()+timeout;for(;;){const value=await fn();if(value)return value;if(Date.now()>end)throw new Error(`Timeout: ${label}`);await delay(100);}};
const run=async(window,fn,arg)=>{
 const result=await window.webContents.executeJavaScript(`(async()=>{try{return {ok:true,value:await (${fn.toString()})(${JSON.stringify(arg)??'undefined'})};}catch(error){return {ok:false,error:String(error?.message||error)}}})()`);
 if(!result.ok)throw new Error(result.error);return result.value;
};
const metrics=async main=>{
 const debuggerAttached=BrowserWindow.getAllWindows().some(w=>w.webContents.debugger.isAttached()||w.webContents.isDevToolsOpened());assert.equal(debuggerAttached,false);
 return {sampledAt:Date.now(),debuggerAttached,resourceUsage:config.resourceProbe?await run(main,()=>window.__avhubMemoryResources.snapshot()):null,processes:app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,role:m.pid===process.pid?'main':m.pid===main.webContents.getOSProcessId()?'library-renderer':'other',workingSetKiB:m.memory.workingSetSize,privateKiB:m.memory.privateBytes??null})),
 windows:{browser:BrowserWindow.getAllWindows().length,base:BaseWindow.getAllWindows().length,displayListeners:screen.listenerCount('display-metrics-changed')}};
};
save();
// Register before the production boot creates/loads its window. This extra
// read-only preload is confined to the test session and never edits preload.js.
if(config.resourceProbe)app.whenReady().then(()=>session.defaultSession.registerPreloadScript({type:'frame',filePath:path.join(config.root,'electron/test/memory-resource-preload.cjs')}));
require(path.join(config.root,'electron/dist/main.js'));
app.whenReady().then(async()=>{
 let main;
 try{
  main=await wait(()=>BrowserWindow.getAllWindows().find(w=>/^http:\/\/127\.0\.0\.1:/.test(w.webContents.getURL())),'main window',60000);
  main.setContentSize(1440,900);
  const activate=()=>{if(config.backgroundUnthrottled){main.webContents.setBackgroundThrottling(false);main.showInactive();}else{main.show();main.focus();}};activate();
  await wait(()=>run(main,()=>Boolean(window.avhubDesktop&&document.querySelector('section.library'))),'library ready');
  await run(main,async engine=>{const r=await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{hoverPreview:false,privacyMode:false,appearance:{theme:'dark',coverSize:'standard'},playerEngine:engine,mpvWindowMode:'embedded',resumeBehavior:'restart',audio:{volume:0,muted:true},autoNext:false,screenshots:{directory:'',shortcut:'C'}}})});if(!r.ok)throw new Error('Isolated preferences failed');},config.playbackEngine??'mpv');
  const url=new URL(main.webContents.getURL());url.searchParams.set('pageSize','96');await main.loadURL(url.href);
  await wait(()=>run(main,()=>document.querySelectorAll('.card').length===96&&!document.querySelector('section.library[aria-busy="true"]')),'96 covers');
  const token=await run(main,()=>window.__noInspectorDocument=crypto.randomUUID());
  const chromium=await import(pathToFileURL(path.join(config.root,'electron/test/chromium-cycle-observer.mjs')).href);
  const {advanceLibraryPage}=await import(pathToFileURL(path.join(config.root,'electron/test/library-page-driver.mjs')).href);
  report.startedAt=Date.now();report.baseline=await metrics(main);save();let forward=true,lastCheckpoint=Date.now();
  const library=()=>run(main,()=>({page:Number(new URL(location.href).searchParams.get('page'))||1,cards:document.querySelectorAll('.card').length,
    images:document.querySelectorAll('.card img[src]').length,decodedImages:[...document.querySelectorAll('.card img')].filter(i=>i.complete&&i.naturalWidth>0).length,
    imagePixels:[...document.querySelectorAll('.card img')].reduce((n,i)=>n+i.naturalWidth*i.naturalHeight,0),nodes:document.getElementsByTagName('*').length}));
  for(let i=0;config.seconds?Date.now()-report.startedAt<config.seconds*1000:i<config.cycles;i++){
   assert.ok(i<5000,'Owned workload cycle safety limit');
   report.stage='scroll';
   activate();
   for(const f of [0,1,.25,.75,0]){await run(main,f=>{const n=document.querySelector('#app-scroll-area');n.scrollTo({top:(n.scrollHeight-n.clientHeight)*f,behavior:'instant'});},f);await delay(config.settleMs??150);}
   if(config.artwork==='absent')assert.equal(await run(main,()=>document.querySelectorAll('.card img.thumbnail').length),0);
   else await wait(()=>run(main,()=>[...document.querySelectorAll('.card img')].some(i=>i.complete&&i.naturalWidth>0&&i.getBoundingClientRect().bottom>0&&i.getBoundingClientRect().top<innerHeight)),'visible covers decoded');
   const browsing=await library();
   let playback=null;
   if(config.phase==='mixed'&&i%(config.playbackEvery??1)===0){
   report.stage='playback';
   if(config.playbackEngine==='chromium')await run(main,chromium.installChromiumCycleObserver);
   await run(main,id=>{const url=new URL(location.href);url.searchParams.set('video',String(id));const index=Number(history.state?.avhubIndex)||0;history.pushState({...history.state,avhubIndex:index+1,avhubLibraryIndex:index},'',url);dispatchEvent(new PopStateEvent('popstate'));},config.mediaId);
   if(config.playbackEngine==='chromium'){
    try{
     await wait(()=>run(main,()=>Boolean(window.__chromiumLibraryCycle.snapshot().firstFrameMs!==null&&document.querySelector('.player-shell video')&&!document.querySelector('.player-shell video').paused&&!document.querySelector('.play-toggle')?.disabled)),'Chromium decoded playback');
     const source=await run(main,()=>document.querySelector('.player-shell video').currentSrc);
     assert.equal(new URL(source).pathname,`/media/${config.mediaId}/file`,'H.264 control must play the original file');
     await delay(10000);
     await run(main,()=>document.querySelector('.play-toggle').click());
     await wait(()=>run(main,()=>document.querySelector('.player-shell video').paused),'pause via application control');
     const seek=await run(main,()=>{const video=document.querySelector('.player-shell video');const value={target:Math.min(video.duration-.1,video.currentTime+5),started:performance.now()};window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));return value;});
     await wait(()=>run(main,({target,started})=>{const frame=window.__chromiumLibraryCycle.snapshot().lastFrame;return frame&&frame.at>=started&&Math.abs(frame.mediaTime-target)<.5;},seek),'new Chromium frame at seek target');
     const state=await run(main,()=>{const video=document.querySelector('.player-shell video');return {...window.__chromiumLibraryCycle.snapshot(),source:video.currentSrc,width:video.videoWidth,height:video.videoHeight,quality:{frames:video.getVideoPlaybackQuality().totalVideoFrames,dropped:video.getVideoPlaybackQuality().droppedVideoFrames}};});
     assert.equal(state.source,source);assert.equal(state.sourceLoads,1);assert.equal(state.width,config.fixture.sample.width);assert.equal(state.height,config.fixture.sample.height);
     assert.ok(state.quality.frames>0);assert.equal(state.events.some(e=>e.name==='error'),false);
     playback={engine:'chromium',firstFrameMs:state.firstFrameMs,seekMs:state.lastFrame.at-seek.started,target:seek.target,position:state.lastFrame.mediaTime,sourceLoads:state.sourceLoads,bufferingEvents:state.events.filter(e=>e.name==='waiting').length,waitingByPhase:chromium.classifyChromiumWaits(state.events),dropped:state.quality.dropped,frames:state.quality.frames};
    }finally{await run(main,()=>{window.__chromiumLibraryCycle?.stop();delete window.__chromiumLibraryCycle;});}
    await run(main,()=>{const button=[...document.querySelectorAll('.player-top button')].find(b=>b.textContent.includes('返回媒体库'));if(!button)throw new Error('Return button absent');button.click();});
    await wait(()=>run(main,()=>!document.querySelector('.player-shell video')&&document.querySelectorAll('.card').length>0&&!document.querySelector('section.library[aria-busy="true"]')),'Chromium library restored');
    assert.equal(await run(main,()=>window.__noInspectorDocument),token);
   }else{
   const state=await wait(async()=>{const s=await run(main,async()=>{if(!(await window.avhubDesktop.nativePlayer('status')).active)return null;return window.avhubDesktop.nativePlayer('snapshot');});return s?.phase==='ready'&&s.properties['time-pos']>.1?s:null;},'native decoded playback');
   const overlay=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`nativePlayer=${state.session}`)),'controls');
   const action=(action,value)=>run(overlay,({action,value,session})=>window.avhubDesktop.nativePlayer(action,{session,value}),{action,value,session:state.session});
   await delay(10000);await action('pause',true);
   const decodedHash=async()=>{const capture=await action('screenshot');assert.equal(capture.width,config.fixture.sample.width);assert.equal(capture.height,config.fixture.sample.height);return createHash('sha256').update(readFileSync(capture.path)).digest('hex');};
   const frameBefore=i===0?await decodedHash():null;
   const target=Math.min(30,config.fixture.sample.duration/2);await action('seek',target);
   const final=await wait(async()=>{const s=await run(main,()=>window.avhubDesktop.nativePlayer('snapshot'));return s.pendingSeek===null&&Math.abs(s.properties['time-pos']-target)<.5?s:null;},'accurate seek');
   assert.equal(final.sourceLoads,1);assert.equal(final.bufferingEvents,0);
   if(i===0){const frameAfter=await decodedHash();assert.notEqual(frameBefore,frameAfter);report.decodedEvidence={frameBefore,frameAfter,width:config.fixture.sample.width,height:config.fixture.sample.height};}
   const diagnostics=await action('diagnostics');
   await run(main,()=>{const b=[...document.querySelectorAll('.player-top button')].find(b=>b.textContent.includes('返回媒体库'));if(!b)throw new Error('Return button absent');b.click();});
   await wait(async()=>!(await run(main,()=>window.avhubDesktop.nativePlayer('status'))).active,'native closed');
   await wait(()=>run(main,()=>!document.querySelector('.player-shell')&&document.querySelectorAll('.card').length>0&&document.querySelectorAll('.card').length<=96&&!document.querySelector('section.library[aria-busy="true"]')),'library restored');
   assert.equal(await run(main,()=>window.__noInspectorDocument),token);
   playback={firstFrameMs:final.firstFrameMs,seekMs:final.lastSeekMs,sourceLoads:final.sourceLoads,bufferingEvents:final.bufferingEvents,audioTracks:final.properties['track-list'].filter(t=>t.type==='audio').length,dropped:final.properties['frame-drop-count']??null,decoderDropped:final.properties['decoder-frame-drop-count']??null,duringPlayback:diagnostics.processMemory};
   }
   }
   const row={cycle:i,elapsedMs:Date.now()-report.startedAt,...playback,browsing,library:await library(),afterClose:await metrics(main)};
   assert.deepEqual(row.afterClose.windows,{browser:1,base:1,displayListeners:0});report.cycles.push(row);
   if(config.walkPages){
    report.stage='pagination';
    const previous=await run(main,()=>document.querySelector('.open-video')?.getAttribute('aria-label'));
    const target=await wait(()=>run(main,advanceLibraryPage,forward),'pagination enabled');forward=target.forward;
    await wait(()=>run(main,({page,previous})=>Number(new URL(location.href).searchParams.get('page')||1)===page&&document.querySelector('section.library')?.getAttribute('aria-busy')==='false'&&document.querySelector('.open-video')?.getAttribute('aria-label')!==previous,{page:target.page,previous}),'next page loaded');
   }
   if(Date.now()-lastCheckpoint>=30000||i===0){lastCheckpoint=Date.now();console.log(JSON.stringify({cycle:i,elapsedMs:row.elapsedMs,page:row.library.page,library:row.afterClose.processes.find(p=>p.role==='library-renderer')}));save();}
   await delay(config.cycleDelay??3000);
  }
  report.workloadMs=Date.now()-report.startedAt;report.targetReached=config.seconds?report.workloadMs>=config.seconds*1000:report.cycles.length===config.cycles;
  if(config.walkPages)assert.ok(new Set(report.cycles.map(r=>r.library.page)).size>=2,'Cross-page workload actually visited multiple pages');
  report.stage='idle';const idleStart=Date.now();
  for(;;){report.idle.push({elapsedMs:Date.now()-idleStart,...await metrics(main)});save();const remaining=config.idleSeconds*1000-(Date.now()-idleStart);if(remaining<=0)break;await delay(Math.min(10000,remaining));}
  assert.equal(await run(main,()=>window.__noInspectorDocument),token);report.completed=true;save();app.quit();
 }catch(error){
  report.completed=false;report.errors.push(String(error));
  if(main&&!main.isDestroyed()){
   report.windowAtFailure={visible:main.isVisible(),minimized:main.isMinimized(),focused:main.isFocused(),bounds:main.getBounds()};
   report.rendererAtFailure=await run(main,async()=>{
    const images=[...document.querySelectorAll('.card img')].slice(0,3).map(i=>({src:i.getAttribute('src'),complete:i.complete,width:i.naturalWidth,rect:i.getBoundingClientRect().toJSON()}));
    const r=await fetch('/api/media?page=1&page_size=1'),data=await r.json(),url=data.items?.[0]?.thumbnail_url;
    const response=url?await fetch(url):null;
    return {hidden:document.hidden,viewport:{width:innerWidth,height:innerHeight},images,thumbnail:response?{status:response.status,type:response.headers.get('content-type')}:null};
   }).catch(()=>null);
  }
  save();process.exitCode=1;app.quit();
 }
});
