// Real Electron, read-only original index and artwork; owned TEMP clone only.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,writeFileSync,renameSync,existsSync,createReadStream,readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {nativeProcessMetrics} from './native-owned-process.mjs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),source=process.argv[2];assert.ok(source&&path.isAbsolute(source),'Provide authorized index path');
const nativeLazy=process.argv.includes('--native-lazy');
const hardwareGpu=process.argv.includes('--hardware-gpu');
const walkPages=process.argv.includes('--walk');
const phase=process.argv.find(value=>value.startsWith('--phase='))?.slice(8)??'mixed';
assert.ok(['mixed','scroll','pages'].includes(phase));
const passes=Number(process.argv.find(value=>value.startsWith('--passes='))?.slice(9)??12);
assert.ok(Number.isSafeInteger(passes)&&passes>=12&&passes<=120);
const option=(name,fallback)=>Number(process.argv.find(value=>value.startsWith(`--${name}=`))?.split('=')[1]??fallback);
const seconds=option('seconds',0),settleMs=option('settle-ms',seconds?1000:150),cycleDelay=option('cycle-delay',seconds?3000:0);
const playbackId=option('playback-id',0),playbackEvery=option('playback-every',10);
const idleSeconds=option('idle-seconds',0);
const networkMode=process.argv.find(value=>value.startsWith('--network-metrics='))?.split('=')[1]??'on';
assert.ok(['on','off'].includes(networkMode));
assert.ok(Number.isSafeInteger(idleSeconds)&&idleSeconds>=0&&idleSeconds<=300);
const instrumentation={additionalNetworkMetrics:networkMode==='on',playwrightTransport:true,forcedGc:false};
assert.ok(Number.isSafeInteger(seconds)&&seconds>=0&&seconds<=7200);
assert.ok(Number.isSafeInteger(settleMs)&&settleMs>=150&&settleMs<=10000);
assert.ok(Number.isSafeInteger(cycleDelay)&&cycleDelay>=0&&cycleDelay<=30000);
assert.ok(Number.isSafeInteger(playbackId)&&playbackId>=0&&Number.isSafeInteger(playbackEvery)&&playbackEvery>=1);
const stopFile=process.argv.find(value=>value.startsWith('--stop-file='))?.slice(12);
if(stopFile)assert.ok(path.resolve(stopFile).startsWith(path.join(root,'build')+path.sep),'stop marker must be inside owned build directory');
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
const workspace=ownedTemporaryWorkspace('avhub-cover-stress-'),profile=path.join(workspace,'profile');mkdirSync(profile);
const clone=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',
`import os,sqlite3,json,shutil
from pathlib import Path
original=Path(os.environ['AVHUB_INDEX']).resolve(); target=Path(os.environ['AVHUB_CLONE']).resolve()
src=sqlite3.connect(original.as_uri()+'?mode=ro',uri=True); dst=sqlite3.connect(str(target/'library.db'));src.backup(dst);src.close()
prefix='E:'+chr(92)+'downloads'+chr(92)
dst.execute('DELETE FROM media WHERE lower(substr(path,1,?))<>lower(?)',(len(prefix),prefix));dst.execute('DELETE FROM roots WHERE id NOT IN (SELECT DISTINCT root_id FROM media)')
tables={r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
for t in ('thumbnail_jobs','file_operations','recycle_actions','source_changes','media_subtitle_links','scan_checkpoint','root_file_permissions'):
 if t in tables:dst.execute('DELETE FROM '+t)
dst.execute('INSERT OR REPLACE INTO thumbnail_control(id,paused) VALUES(1,1)');dst.execute('DELETE FROM playlist_items WHERE media_id NOT IN (SELECT id FROM media)')
copied=0
for media_id,thumb,cover in dst.execute('SELECT id,thumbnail,custom_cover FROM media').fetchall():
 for key,value in [('thumbnail',thumb),('custom_cover',cover)]:
  if not value:continue
  candidate=(original.parent/value).resolve(); destination=target/value
  if not candidate.is_relative_to(original.parent) or not destination.resolve().is_relative_to(target) or candidate.suffix.lower() not in ('.jpg','.jpeg','.png','.webp') or not candidate.is_file():dst.execute('UPDATE media SET '+key+'=NULL WHERE id=?',(media_id,));continue
  destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(candidate,destination);copied+=1
dst.commit();print(json.dumps({'videos':dst.execute('SELECT COUNT(*) FROM media').fetchone()[0],'covers':copied}));dst.close()`],{cwd:root,env:{...process.env,AVHUB_INDEX:source,AVHUB_CLONE:profile},encoding:'utf8',windowsHide:true,timeout:60000});
assert.equal(clone.status,0,clone.stderr);const counts=JSON.parse(clone.stdout);assert.ok(counts.videos>1000&&counts.covers>100,'Need real large index and existing covers');
counts.walkPages=walkPages;
let desktop;const samples=[],errors=[];let requests=0,forward=true;
const playbacks=[],idleSamples=[];let started=0,elapsedMs=0,totalElapsedMs=0,cleanExit=false,sourceIdentity=null,parentPid;
const network={enabled:networkMode==='on',completed:0,cacheHits:0,notModified:0,transferBytes:0,failed:0,policies:{}};const inflight=new Map();
const hash=file=>new Promise((resolve,reject)=>{const digest=createHash('sha256'),stream=createReadStream(file);stream.on('data',chunk=>digest.update(chunk));stream.on('error',reject);stream.on('end',()=>resolve(digest.digest('hex')));});
const snapshotIdentity=async file=>({hash:await hash(file),size:statSync(file).size,mtime:statSync(file).mtimeMs});
const stopping=()=>stopped||Boolean(stopFile&&existsSync(path.resolve(stopFile)));
const timing={longTasks:0,maxLongTaskMs:0,frames:0,gapsOver50ms:0,maxGapMs:0};
const installTiming=()=>{const timing={longTasks:0,maxLongTaskMs:0,frames:0,gapsOver50ms:0,maxGapMs:0};window.__coverTiming=timing;const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){timing.longTasks++;timing.maxLongTaskMs=Math.max(timing.maxLongTaskMs,entry.duration);}});observer.observe({type:'longtask'});let last=performance.now(),id;const frame=now=>{const gap=now-last;last=now;timing.frames++;if(gap>50)timing.gapsOver50ms++;timing.maxGapMs=Math.max(timing.maxGapMs,gap);id=requestAnimationFrame(frame);};id=requestAnimationFrame(frame);window.__stopCoverTiming=()=>{observer.disconnect();cancelAnimationFrame(id);};};
const reportFile=path.join(workspace,seconds?'library-soak.json':'covers.json');
const build=JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8'));
const writeCheckpoint=value=>{const file=path.join(workspace,'checkpoint.json'),pending=file+'.tmp';writeFileSync(pending,JSON.stringify(value,null,2));renameSync(pending,file);};
console.log('Isolated report:',reportFile);
try{
 desktop=await _electron.launch({args:[root,...(hardwareGpu?[]:['--in-process-gpu','--disable-gpu']),'--no-sandbox'],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});const page=await desktop.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/thumbs/'))requests++;});
 const cdp=await page.context().newCDPSession(page);if(network.enabled)await cdp.send('Network.enable');
 const rendererDiagnostics=async()=>({
   processes:await desktop.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,pid:m.pid,workingSetKB:m.memory.workingSetSize,privateKB:m.memory.privateBytes??null,cpuPercent:m.cpu.percentCPUUsage}))),
   dom:await cdp.send('Memory.getDOMCounters'),heapUsage:await cdp.send('Runtime.getHeapUsage'),
 });
 parentPid=await desktop.evaluate(()=>process.pid);
 cdp.on('Network.requestWillBeSent',event=>{if(new URL(event.request.url).pathname.startsWith('/thumbs/'))inflight.set(event.requestId,{cached:false});});
 cdp.on('Network.requestServedFromCache',event=>{const row=inflight.get(event.requestId);if(row)row.cached=true;});
 cdp.on('Network.responseReceived',event=>{const row=inflight.get(event.requestId);if(!row)return;row.cached ||= event.response.fromDiskCache===true;const policy=Object.entries(event.response.headers).find(([key])=>key.toLowerCase()==='cache-control')?.[1]??'missing';network.policies[policy]=(network.policies[policy]??0)+1;});
 cdp.on('Network.loadingFinished',event=>{const row=inflight.get(event.requestId);if(!row)return;network.completed++;if(row.cached)network.cacheHits++;network.transferBytes+=event.encodedDataLength;inflight.delete(event.requestId);});
 cdp.on('Network.loadingFailed',event=>{if(inflight.delete(event.requestId))network.failed++;});
 cdp.on('Network.responseReceivedExtraInfo',event=>{if(inflight.has(event.requestId)&&event.statusCode===304)network.notModified++;});
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await page.evaluate(async playback=>{const r=await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{hoverPreview:false,...(playback?{playerEngine:'mpv',resumeBehavior:'restart',audio:{volume:0,muted:true},autoNext:false,screenshots:{directory:'',shortcut:'C'}}:{})}})});if(!r.ok)throw new Error('Could not initialize isolated benchmark preferences');},Boolean(playbackId));
 let playbackItem;
 if(playbackId){playbackItem=await page.evaluate(async id=>{const r=await fetch(`/api/media/${id}`);if(!r.ok)throw new Error('Explicit playback sample not in cloned index');return r.json();},playbackId);assert.ok(playbackItem.path.toLowerCase().startsWith('e:\\downloads\\'));sourceIdentity=await snapshotIdentity(playbackItem.path);}
 await desktop.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.webContents.setBackgroundThrottling(false);window.showInactive();}); // Test only, visible without taking keyboard focus. Hidden windows can still throttle rAF to 1Hz.
 if(nativeLazy)await page.addInitScript(()=>{window.IntersectionObserver=undefined;}); // Explicit control harness: original img loading=lazy behavior.
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));await page.goto(new URL('/?pageSize=96',page.url()).href);await expect(page.locator('.card')).toHaveCount(96);await expect(page.locator('.thumbnail-ready').first()).toBeVisible();
 await page.evaluate(installTiming);
 const documentToken=await page.evaluate(()=>window.__librarySoakDocument=crypto.randomUUID());
 const collectTiming=async()=>{const value=await page.evaluate(()=>{window.__stopCoverTiming();return window.__coverTiming;});for(const key of ['longTasks','frames','gapsOver50ms'])timing[key]+=value[key];for(const key of ['maxLongTaskMs','maxGapMs'])timing[key]=Math.max(timing[key],value[key]);};
 started=performance.now();let checkpoint=started;
 for(let pass=0;(seconds?performance.now()-started<seconds*1000:pass<passes)&&!stopping();pass++){
  for(const fraction of phase==='pages'?[0]:[0,1,.25,.75,0]){
   await page.locator('#app-scroll-area').evaluate((node,f)=>node.scrollTo({top:(node.scrollHeight-node.clientHeight)*f,behavior:'instant'}),fraction);await page.waitForTimeout(settleMs);
   const state=await page.evaluate(()=>({cards:document.querySelectorAll('.card').length,attached:document.querySelectorAll('.card img.thumbnail[src]').length,decoded:document.querySelectorAll('.card img.thumbnail-ready').length,imagePixels:[...document.querySelectorAll('img.thumbnail')].reduce((sum,image)=>sum+image.naturalWidth*image.naturalHeight,0),heap:performance.memory?.usedJSHeapSize||null}));
   // Read current counters only. Leak-preparation/GC commands would invalidate
   // the working-set experiment by dropping internal caches.
   const {processes,dom,heapUsage}=await rendererDiagnostics();
   const memory=processes.filter(m=>m.type==='Tab').map(m=>m.workingSetKB);samples.push({elapsedMs:Math.round(performance.now()-started),pass,fraction,...state,dom,heapUsage,rendererKB:memory,processes,network:{...network,policies:{...network.policies}}});if(walkPages)assert.ok(state.cards>0&&state.cards<=96);else assert.equal(state.cards,96);assert.ok(state.attached<=96,'decoded image lifetime is bounded by the current page');
   assert.ok(memory.every(value=>value<2*1024*1024),'stop safely if renderer working set exceeds 2 GiB; not a product memory cap');
   if(!nativeLazy&&pass===0&&fraction===0&&samples.length===1)assert.ok(state.attached<96,'initial requests stay near the viewport');
  }
  if(playbackId&&pass%playbackEvery===0&&!stopping()){
    const libraryUrl=page.url(),openStart=performance.now();await collectTiming();
    // Drive the actual history router without reloading the renderer. Reloads
    // would discard memory and conceal lifecycle leaks after player close.
    await page.evaluate(id=>{const url=new URL(location.href);url.searchParams.set('video',String(id));const index=Number(history.state?.avhubIndex)||0;history.pushState({...history.state,avhubIndex:index+1,avhubLibraryIndex:index},'',url);dispatchEvent(new PopStateEvent('popstate'));},playbackId);
    await expect(page.getByText('MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:30000});
    const session=await page.evaluate(async()=>(await window.avhubDesktop.nativePlayer('snapshot')).session);
    const overlay=desktop.windows().find(window=>window.url().includes(`nativePlayer=${session}`));assert.ok(overlay);
    const snapshot=()=>overlay.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
    const call=(action,value)=>overlay.evaluate(({action,value,session})=>window.avhubDesktop.nativePlayer(action,{session,value}),{action,value,session});
    try{await expect.poll(async()=>(await snapshot()).phase,{timeout:35000}).toBe('ready');}
    catch(error){writeFileSync(path.join(workspace,'startup-failure.json'),JSON.stringify({snapshot:await snapshot(),processes:nativeProcessMetrics(parentPid)},null,2));throw error;}
    await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:15000}).toBeGreaterThan(.1);
    const row={cycle:playbacks.length,openMs:Math.round(performance.now()-openStart)};
    await page.waitForTimeout(10000);await call('pause',true);
    if(!playbacks.length){const capture=await call('screenshot');assert.equal(capture.width,playbackItem.width);assert.equal(capture.height,playbackItem.height);row.firstFrameHash=await hash(capture.path);}
    const target=Math.min(30,playbackItem.duration/2);await call('seek',target);
    await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:20000}).toBe(null);
    const state=await snapshot();assert.ok(Math.abs(state.properties['time-pos']-target)<.5);assert.equal(state.sourceLoads,1);
    if(!playbacks.length){const capture=await call('screenshot');row.seekFrameHash=await hash(capture.path);assert.notEqual(row.seekFrameHash,row.firstFrameHash,'explicit moving 4K sample decoded pixels advance');}
    Object.assign(row,{firstFrameMs:state.firstFrameMs,sourceLoads:state.sourceLoads,bufferingEvents:state.bufferingEvents,dropped:state.properties['frame-drop-count']??null,decoderDropped:state.properties['decoder-frame-drop-count']??null,seekMs:state.lastSeekMs,position:state.properties['time-pos'],processes:nativeProcessMetrics(parentPid)});
    await page.locator('.player-top').getByRole('button',{name:'返回媒体库',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('status')).then(value=>value.active),{timeout:20000}).toBe(false);
    assert.deepEqual(nativeProcessMetrics(parentPid),[],'decoder released between library visits');
    await expect(page).toHaveURL(libraryUrl);await expect(page.locator('section.library')).toHaveAttribute('aria-busy','false');
    assert.equal(await page.evaluate(()=>window.__librarySoakDocument),documentToken,'same renderer document survives playback cycles');
    const windows=await desktop.evaluate(({BrowserWindow,BaseWindow,screen})=>({browser:BrowserWindow.getAllWindows().length,base:BaseWindow.getAllWindows().length,displayListeners:screen.listenerCount('display-metrics-changed')}));
    assert.equal(windows.browser,1);assert.equal(windows.base,1);row.windowsAfterClose=windows;
    row.afterClose=await rendererDiagnostics();
    await page.evaluate(installTiming);playbacks.push(row);
  }
  if(phase!=='scroll'){
    if(walkPages&&await page.getByRole('button',{name:forward?'下一页':'上一页',exact:true}).isDisabled())forward=!forward;
    await page.getByRole('button',{name:walkPages?(forward?'下一页':'上一页'):(pass%2===0?'下一页':'上一页'),exact:true}).click();await expect(page.locator('section.library')).toHaveAttribute('aria-busy','false');
  }
  if(cycleDelay)await page.waitForTimeout(cycleDelay);
  if(performance.now()-checkpoint>=60000){
    checkpoint=performance.now();const progress={elapsedMs:Math.round(checkpoint-started),targetSeconds:seconds,sample:samples.at(-1),playbackCycles:playbacks.length,network,errors};
    // Persist the curve, not just its final point. An interrupted run remains
    // explicitly incomplete; reaching wall-clock time is not a clean-exit proof.
    writeCheckpoint({build,seconds,elapsedMs:progress.elapsedMs,incomplete:true,targetReached:false,cleanExit:false,sourceIdentityVerified:false,hardwareGpu,phase,walkPages,counts,samples,playbacks,network,instrumentation,idleSeconds,idleSamples,errors});
    writeFileSync(path.join(workspace,'progress.json'),JSON.stringify(progress,null,2));console.log(JSON.stringify({elapsedMs:progress.elapsedMs,pass,rendererKB:progress.sample.rendererKB,heap:progress.sample.heap,playbackCycles:playbacks.length,network}));
  }
 }
 await collectTiming();
 elapsedMs=Math.round(performance.now()-started);assert.deepEqual(errors,[]);
 // Separate natural idle recovery from active workload duration. Waiting must
 // never turn an incomplete workload into a passed duration target.
 if(idleSeconds&&!stopping()){
   const idleStarted=performance.now();
   for(;;){
     idleSamples.push({elapsedMs:Math.round(performance.now()-idleStarted),...await rendererDiagnostics()});
     const remaining=idleSeconds*1000-(performance.now()-idleStarted);
     if(remaining<=0||stopping())break;
     await page.waitForTimeout(Math.min(10000,remaining));
   }
   assert.equal(await page.evaluate(()=>window.__librarySoakDocument),documentToken,'idle recovery never reloads the document');
 }
 totalElapsedMs=Math.round(performance.now()-started);assert.deepEqual(errors,[]);
 if(playbackItem)assert.deepEqual(await snapshotIdentity(playbackItem.path),sourceIdentity,'real media remains byte-identical');
 await desktop.close();desktop=null;assert.deepEqual(nativeProcessMetrics(parentPid),[],'normal app exit leaves no owned MPV');cleanExit=true;
 if(seconds)writeFileSync(reportFile,JSON.stringify({build,seconds,elapsedMs,totalElapsedMs,targetReached:elapsedMs>=seconds*1000,stopped:stopping(),cleanExit,sourceIdentityVerified:Boolean(playbackItem),hardwareGpu,phase,walkPages,counts,samples,playbacks,network,timing,instrumentation,idleSeconds,idleSamples,errors,limitations:['Single machine and read-only sample; not all codecs, HDR, physical mixed-DPI or monitor scanout acceptance.','Working set is sampled without forced GC. GPU process working set is not VRAM. HTTP transfer is not disk I/O.','Library and native playback alternate; native phases use original file and decoded PNG evidence for the first seek. No source mutation.','Disabling additional CDP Network metrics does not disable Playwright transport instrumentation. Disabled counters are unavailable, not zero traffic.']},null,2));
 writeFileSync(path.join(workspace,'covers.json'),JSON.stringify({nativeLazy,hardwareGpu,phase,...counts,requests,network,samples,timing,limitations:[`Read-only E downloads metadata and copied existing artwork; hover video explicitly disabled. No scan. ${playbackId?'Alternates with original-file native playback.':'No video playback.'} Working set is sampled without forced GC, not proof of leak freedom.`,'GPU process working set is not VRAM usage or a decoded-image-cache allocation measurement. Image pixels estimate current DOM images only.','Network encodedDataLength measures transferred HTTP bytes, not disk I/O; cache hits and logical request counts are separate.','Timing includes driver and paging intervals, not isolated scroll FPS. Native-lazy control disables IntersectionObserver only in this test profile.']},null,2));
 console.log(JSON.stringify({nativeLazy,hardwareGpu,phase,walkPages,...counts,requests,network,timing,maxAttached:Math.max(...samples.map(s=>s.attached)),heapFirst:samples[0].heap,heapLast:samples.at(-1).heap,rendererFirstKB:samples[0].rendererKB,rendererLastKB:samples.at(-1).rendererKB}));console.log('Owned real-cover report:',path.join(workspace,'covers.json'));
}catch(error){errors.push(String(error));writeFileSync(reportFile,JSON.stringify({build,seconds,elapsedMs:elapsedMs||(started?Math.round(performance.now()-started):0),totalElapsedMs:started?Math.round(performance.now()-started):0,targetReached:false,cleanExit:false,errors,samples,playbacks,network,instrumentation,idleSeconds,idleSamples},null,2));throw error;
}finally{if(desktop)await desktop.close();}
