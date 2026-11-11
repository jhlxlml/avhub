import {placeTestMedia} from './media-pool.mjs';
import {playbackFixture} from './playback-fixtures.mjs';
// Real Electron paired MPV benchmark. Generated fixtures only; no original media writes.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,createReadStream,writeFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import {seekPercentiles} from './benchmark-resources.mjs';

const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/mpv-seek-paired-')),media=path.join(data,'media');
const longGopTs=process.env.AVHUB_MPV_LONG_GOP_TS==='1';
const subject=process.argv[2];
assert.ok(!subject||['render','exe'].includes(subject));
const extraFrames=process.env.AVHUB_TEST_MPV_EXTRA_FRAMES;assert.ok(extraFrames===undefined||['6','16','32'].includes(extraFrames));
const hwdec=process.env.AVHUB_TEST_MPV_HWDEC;assert.ok(hwdec===undefined||['nvdec','nvdec-copy','d3d11va'].includes(hwdec));
const decodeThreads=process.env.AVHUB_TEST_MPV_THREADS;assert.ok(decodeThreads===undefined||['1','2','4','8'].includes(decodeThreads));
const report={runtimeCandidate:process.env.AVHUB_MPV_RUNTIME_CANDIDATE??'installed-development-runtime',longGopTs,subject:subject??'both',extraFrames:extraFrames??'default',hwdec:hwdec??'default',decodeThreads:decodeThreads??'default',rows:[],completed:false};
const stressBursts=Number(process.env.AVHUB_MPV_STRESS_BURSTS??0);assert.ok(Number.isInteger(stressBursts)&&stressBursts>=0&&stressBursts<=200);report.stressBursts=stressBursts;
const sourceOverride=process.env.AVHUB_TEST_SEEK_SOURCE;
if(sourceOverride)assert.ok(path.isAbsolute(sourceOverride)&&path.resolve(sourceOverride).toLowerCase().startsWith('e:\\downloads\\'));
const realMedia=Boolean(sourceOverride)||process.env.AVHUB_MPV_REAL_HDR==='1',original=sourceOverride??(realMedia?'E:/downloads/The World in HDR in 4K (ULTRA HD).mkv':null);
const hashFile=async file=>{const hash=createHash('sha256');await pipeline(createReadStream(file),hash);return hash.digest('hex');};
const originalHash=()=>original?hashFile(original):null;
const originalBefore=await originalHash();report.realMedia=realMedia;report.sourceSha256=originalBefore;
const fixtures=realMedia?['Real'+path.extname(original)]:['LongGop.mp4','Transport.ts','HEVC4K.mkv'];
mkdirSync(media);
if(realMedia)placeTestMedia(original,path.join(media,fixtures[0]));
else{placeTestMedia(playbackFixture('longGop38'),path.join(media,fixtures[0]));placeTestMedia(playbackFixture(longGopTs?'transportLong38':'transport38'),path.join(media,fixtures[1]));placeTestMedia(playbackFixture('hevc4k'),path.join(media,fixtures[2]));}
const hashes=()=>Promise.all(fixtures.map(file=>hashFile(path.join(media,file)))),before=await hashes();
let desktop,page,inspect;
try{
 const env={...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'};
 desktop=await _electron.launch({args:[root],cwd:data,env,timeout:60000});
 page=await desktop.firstWindow();
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app},{data,extraFrames,hwdec,decodeThreads})=>{
  const base=app.getAppPath(),require=process.getBuiltinModule('module').createRequire(base+'/package.json');
  const {MpvClient}=require(base+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start;
  let launches=0;globalThis.__seekTransport=[];globalThis.__seekWire=[];globalThis.__seekWireDuplicates=[];
  MpvClient.prototype.start=function(...args){globalThis.__seekClient=this;const launch=++launches;args[4]=[...(args[4]??[]),'--log-file='+data+'/mpv-'+launch+'.log',...(extraFrames?['--hwdec-extra-frames='+extraFrames]:[]),...(hwdec?['--hwdec='+hwdec]:[]),...(decodeThreads?['--vd-lavc-threads='+decodeThreads]:[])];return start.apply(this,args).then(value=>{
   this.child.once('exit',(code,signal)=>globalThis.__seekTransport.push({launch,kind:'exit',code,signal}));
   this.socket.on('error',error=>globalThis.__seekTransport.push({launch,kind:'pipe-error',code:error.code??null,stack:error.stack,pending:this.requests.size,writableLength:this.socket.writableLength}));this.socket.on('close',hadError=>globalThis.__seekTransport.push({launch,kind:'pipe-close',hadError}));
   const write=this.socket.write;this.socket.write=function(line,...args){const packet=JSON.parse(line);if(packet.command[0]==='seek'||packet.command[0]==='set_property'&&packet.command[1]==='time-pos'||packet.command[0]==='script-message-to'&&packet.command[2]==='seek-relative'){const event={launch,at:performance.now(),...packet,stack:new Error('wire').stack};if(globalThis.__seekWire.some(old=>old.launch===launch&&old.request_id===packet.request_id)&&globalThis.__seekWireDuplicates.length<16)globalThis.__seekWireDuplicates.push(event);globalThis.__seekWire.push(event);if(globalThis.__seekWire.length>256)globalThis.__seekWire.shift();}return write.call(this,line,...args);};return value;
  });};
 },{data,extraFrames,hwdec,decodeThreads});
 const mpv=command=>desktop.evaluate(async(_,args)=>globalThis.__seekClient.command(args),command);
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{
  const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:JSON.stringify(body)});
  if(!response.ok)throw new Error(await response.text());
  return response.json();
 },{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/thumbnails/pause','POST');
 for(const embedded of [true,false].filter(value=>!subject||value===(subject==='render'))){
  await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',mpvWindowMode:'independent',nativeRenderEnabled:embedded,playbackSessionCoordinatorEnabled:false,resumeBehavior:'restart',autoNext:false,audio:{volume:.05,muted:false}}});
  await page.reload();
  await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__pairedRender=s));
  for(const file of fixtures){
   const title=path.parse(file).name;
   const card=page.locator('.card').filter({has:page.getByRole('button',{name:'播放 '+title,exact:true})});
   const targetCard=card;
   await targetCard.getByRole('button',{name:'播放 '+title,exact:true}).click();
   const state=()=>embedded?page.evaluate(()=>window.__pairedRender):page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot')).catch(()=>null);
   inspect=state;
   await expect.poll(async()=>(await state())?.phase,{timeout:30000}).toBe('ready');
   const initial=await state(),row={file,engine:embedded?'render':'exe',samples:[]};report.rows.push(row);
   const native=(action,value)=>page.evaluate(({action,value,session})=>window.avhubDesktop.nativePlayer(action,{session,value,inputAt:Date.now()}),{action,value,session:initial.session});
   const setPolicy=async policy=>{
    if((await state()).seekPolicy===policy)return;
    if(embedded){
     await page.getByRole('button',{name:'跳播与播放设置',exact:true}).click();
     await page.getByLabel('跳播模式',{exact:true}).selectOption(policy);
     await page.getByRole('button',{name:'关闭播放设置',exact:true}).click();
    }else await native('seek-policy',policy);
    await expect.poll(async()=>(await state()).seekPolicy).toBe(policy);
   };
   const seek=async target=>{
    if(embedded)await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},target);
    else await native('seek',target);
   };
   const pause=async paused=>{
    if(embedded){const s=await state();if(s.properties.pause!==paused)await page.keyboard.press('Space');}
    else await mpv(['set_property','pause',paused]);
    await expect.poll(async()=>(await state()).properties.pause).toBe(paused);
   };
   const wait=async (target,previous,tolerance=.000001)=>{
    await expect.poll(async()=>{const s=await state();return s.pendingSeek===null&&Math.abs((s.seekDiagnostics?.target??Infinity)-target)<=tolerance&&JSON.stringify(s.seekDiagnostics)!==previous;},{timeout:16000,intervals:[10,20,40,80]}).toBe(true);
    const s=await state();assert.equal(s.sourceLoads,1);return s.seekDiagnostics;
   };
   const firstFar=Number(process.env.AVHUB_TEST_FIRST_FAR_SEEK??0);
   if(firstFar){
    assert.ok(!embedded&&realMedia&&Number.isFinite(firstFar)&&firstFar>0);
    await setPolicy('fast');
    const readIo=async()=>{
     const pid=await desktop.evaluate(()=>globalThis.__seekClient.processId);assert.ok(Number.isSafeInteger(pid)&&pid>0);
     const command=`$ErrorActionPreference='Stop';$mpvIo=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";[pscustomobject]@{readBytes=[double]$mpvIo.ReadTransferCount;kernel=[double]$mpvIo.KernelModeTime;user=[double]$mpvIo.UserModeTime}|ConvertTo-Json -Compress`;
     const run=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,encoding:'utf8',timeout:15000});assert.equal(run.status,0,run.stderr);const io=JSON.parse(run.stdout);assert.ok(Number.isFinite(io.readBytes)&&io.readBytes>0);return io;
    };
    const beforeIo=await readIo(),previous=JSON.stringify((await state()).seekDiagnostics);
    await seek(firstFar);const timing=await wait(firstFar,previous),afterIo=await readIo();
    row.firstFar={timing,beforeIo,afterIo,readBytes:afterIo.readBytes-beforeIo.readBytes,scope:'Native output clock/restart confirmation; not Electron GPU receipt or physical scanout'};
    assert.equal(timing.sourceLoads,1);assert.ok(timing.hwdec&&timing.hwdec!=='no');assert.ok(row.firstFar.readBytes>=0);
   }
   if(realMedia){
    await pause(true);await setPolicy('fast');
    const previous=JSON.stringify((await state()).seekDiagnostics);await seek(0);await wait(0,previous);
    const key=(delta=5)=>embedded?page.evaluate(delta=>{const key=delta>0?'ArrowRight':'ArrowLeft';document.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true}));},delta):mpv(['script-message-to','avhub_ui','seek-relative',String(delta)]);
    const beforeFirst=JSON.stringify((await state()).seekDiagnostics);await key();const first=await wait(5,beforeFirst,.08);
    const beforeSecond=JSON.stringify((await state()).seekDiagnostics);await key();
    await expect.poll(async()=>JSON.stringify((await state()).seekDiagnostics)!==beforeSecond).toBe(true);
    const second=(await state()).seekDiagnostics;
    if(first.position<first.target-.1)assert.ok(Math.abs(second.target-10)<.08,'completed approximate seeks must not trap repeated 5-second forward skips on the same keyframe');
    assert.ok(first.position>.1&&second.position>first.position+.1,'each completed forward keyframe seek must visibly advance');
    const beforeBack=JSON.stringify((await state()).seekDiagnostics);await key(-5);const backward=await wait(second.position-5,beforeBack,.08);
    assert.ok(backward.position<second.position-.1,'reversing direction must really move backward');
    row.relativeAdvance={first,second,backward};
   }
   const customTargets=process.env.AVHUB_TEST_SEEK_TARGETS?.split(',').map(Number);
   if(customTargets)assert.ok(customTargets.length===6&&customTargets.every(n=>Number.isFinite(n)&&n>=0));
   const targets=customTargets??(realMedia?[5,38,73,5,38,73]:[7.4,23.4,15.4,31.4,7.4,23.4]);report.targets=targets;
   for(const paused of [true,false]){
    await pause(paused);
    for(const [i,target] of targets.entries()){
     // Alternate strategy order while giving each strategy the same targets.
     for(const policy of i%2?['fast','exact']:['exact','fast']){
      await setPolicy(policy);
      const anchor=JSON.stringify((await state()).seekDiagnostics);await seek(2);await wait(2,anchor);
      const previous=JSON.stringify((await state()).seekDiagnostics);
      await seek(target);const timing=await wait(target,previous);
      assert.equal(timing.strategy,policy==='exact'?'exact':'keyframe');
      if(hwdec&&!embedded)assert.equal(timing.hwdec,hwdec,'a software fallback is not valid hardware optimization evidence');
      if(policy==='exact')assert.ok(Math.abs(timing.errorSec)<(embedded?.11:.51),JSON.stringify(timing));
      row.samples.push({paused,policy,...timing,...(process.env.AVHUB_NATIVE_SEEK_TRACE==='1'?{nativeTrace:(await state()).properties['avhub-native-seek-trace']}:{}),ms:timing.queueMs+timing.confirmationMs});
     }
    }
   }
   await pause(true);await setPolicy('exact');
   const previous=JSON.stringify((await state()).seekDiagnostics);
   await seek(10);const anchor=await wait(10,previous);
   const beforeBurst=JSON.stringify((await state()).seekDiagnostics);
   if(embedded)await page.evaluate(()=>{for(const key of ['ArrowRight','ArrowRight','ArrowLeft'])document.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true}));});

   // Exercise the real production relative controls; IPC injection is not an OS input benchmark.
   if(!embedded)await Promise.all(['5','5','-5'].map(delta=>mpv(['script-message-to','avhub_ui','seek-relative',delta])));
   const burst=await wait(anchor.position+5,beforeBurst,.08);
   assert.ok(Math.abs(burst.errorSec)<.51);row.burst=burst;
   if(!embedded&&file==='HEVC4K.mkv'&&stressBursts){
    row.burstStress=[];
    for(let i=0;i<stressBursts;i++){
     await pause(true);await setPolicy('exact');
     const target=[10,31.4,573.4,750.4][i%4],beforeAnchor=JSON.stringify((await state()).seekDiagnostics);
     await seek(target);const anchor=await wait(target,beforeAnchor);
     const before=JSON.stringify((await state()).seekDiagnostics),direction=i%2?'-':'',deltas=i%2?['-5','-5','5']:['5','5','-5'];
     await Promise.all(deltas.map(delta=>mpv(['script-message-to','avhub_ui','seek-relative',delta])));
     const timing=await wait(anchor.position+(direction?-5:5),before,.08);
     assert.ok(Math.abs(timing.errorSec)<.51);assert.equal((await state()).transport.exited,false);
     row.burstStress.push({iteration:i,...timing,transport:(await state()).transport});
    }
    const beforeRestore=JSON.stringify((await state()).seekDiagnostics);await seek(burst.position);await wait(burst.position,beforeRestore);
   }

   if(!embedded){
    await setPolicy('fast');
    const beforeNativeFast=JSON.stringify((await state()).seekDiagnostics);
    await mpv(['script-message-to','avhub_ui','seek-relative','5']);
    row.nativeFast=await wait(burst.position+5,beforeNativeFast,.08);
    assert.equal(row.nativeFast.strategy,'keyframe');
    assert.equal(row.nativeFast.frameMs,null);
    assert.ok(row.nativeFast.inputToDispatchMs>=0);
   }
   row.fastBursts=[];
   for(const paused of [true,false]){
    await pause(paused);await setPolicy('fast');
    const previous=JSON.stringify((await state()).seekDiagnostics);
    // One synchronous input burst exercises latest-intent coalescing in the actual overlay.
    const burstTargets=[31.4,7.4,23.4];
    if(embedded)await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((el,targets)=>{
     for(const target of targets){el.value=String(target);el.dispatchEvent(new Event('input',{bubbles:true}));}
    },burstTargets);
    else await Promise.all(burstTargets.map(target=>native('seek',target)));
    const timing=await wait(23.4,previous);
    assert.equal(timing.strategy,'keyframe');
    assert.ok(Number.isFinite(timing.position)&&Number.isFinite(timing.errorSec));
    assert.ok(Math.abs(timing.errorSec-(timing.position-timing.target))<.001,'approximate landing must report its real error');
    if(embedded)assert.ok(timing.frameMs!==null&&timing.frameMs>=0,'embedded completion requires a real GPU receipt');
    else assert.equal(timing.frameMs,null,'EXE must not claim a compositor receipt');
    assert.equal((await state()).properties.pause,paused,'seeking must preserve pause state');
    row.fastBursts.push({paused,...timing});
   }
   await pause(true);
   await setPolicy('smart');
   const beforeSmart=JSON.stringify((await state()).seekDiagnostics);
   await seek(12.4);const smart=await wait(12.4,beforeSmart);
   assert.equal(smart.strategy,'exact','smart keeps paused seeks precise');
   row.smartPlaying=[];
   await pause(false);
   if(file==='LongGop.mp4'||file==='Transport.ts'&&longGopTs){
    // Forward-aware seeks changed the natural landing errors. Supply a real
    // far seek whose next keyframe is >2s away, instead of assuming old errors.
    await setPolicy('fast');
    let previous=JSON.stringify((await state()).seekDiagnostics);await seek(2);await wait(2,previous);
    previous=JSON.stringify((await state()).seekDiagnostics);await seek(18.4);row.smartBadEvidence=await wait(18.4,previous);
    assert.ok(Math.abs(row.smartBadEvidence.errorSec)>2);
    await setPolicy('exact');previous=JSON.stringify((await state()).seekDiagnostics);await seek(12.4);await wait(12.4,previous);
    await setPolicy('smart');
   }
   // Exercise real playing decisions after the measured keyframe errors above.
   // The 8-second GOP fixtures have already supplied >2s deviations during far seeks.
   if(file==='LongGop.mp4'||file==='Transport.ts'&&longGopTs){
    const previous=JSON.stringify((await state()).seekDiagnostics);
    await seek(31.4);const timing=await wait(31.4,previous);
    assert.equal(timing.strategy,'exact','smart must reject measured large keyframe errors while playing');
    assert.ok(Math.abs(timing.errorSec)<(embedded?.11:.51));
    row.smartPlaying.push({kind:'large-error-fallback',...timing});
   }
   const currentPosition=Number((await state()).properties['time-pos']);
   // Match the production slider's 0.01-second input step.
   const nearTarget=Math.round((currentPosition>28?currentPosition-5:currentPosition+5)*100)/100;
   const beforeNear=JSON.stringify((await state()).seekDiagnostics);
   await seek(nearTarget);const near=await wait(nearTarget,beforeNear);
   assert.equal(near.strategy,'exact','smart keeps short forward/backward skips precise');
   assert.ok(Math.abs(near.errorSec)<(embedded?.11:.51));
   row.smartPlaying.push({kind:'short-skip',...near});
   if(!embedded&&(file==='LongGop.mp4'||file==='Transport.ts'&&longGopTs)){
    // Cover the Lua-owned control path, not only main-process seek actions.
    const beforeNativeSmart=JSON.stringify((await state()).seekDiagnostics);
    const nativeBase=Number((await state()).properties['time-pos']);
    await mpv(['script-message-to','avhub_ui','seek-relative','-15']);
    const timing=await wait(nativeBase-15,beforeNativeSmart,.5);
    assert.equal(timing.strategy,'exact','native controls must receive the same large-error smart evidence');
    assert.ok(Math.abs(timing.errorSec)<.51);
    assert.equal(timing.queueMs,null,'native input must stay owned by MPV');
    row.smartPlaying.push({kind:'native-large-error-fallback',...timing});
   }
   await pause(true);
   if(file==='HEVC4K.mkv'){
    await setPolicy('exact');
    const beforeFar=JSON.stringify((await state()).seekDiagnostics);
    await seek(573.4);row.far=await wait(573.4,beforeFar);
    assert.ok(Math.abs(row.far.errorSec)<.11);
   }
   row.stats=Object.fromEntries(['exact','fast'].map(policy=>[policy,seekPercentiles(row.samples.filter(s=>s.policy===policy))]));
   await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
   await expect(page.locator('.card')).toHaveCount(fixtures.length);
  }
 }
 assert.deepEqual(await hashes(),before);assert.equal(await originalHash(),originalBefore);
 report.transport=await desktop.evaluate(()=>globalThis.__seekTransport);report.wire=await desktop.evaluate(()=>globalThis.__seekWire);report.wireDuplicates=await desktop.evaluate(()=>globalThis.__seekWireDuplicates);assert.equal(report.wireDuplicates.length,0,'A request ID must never be physically sent twice');report.completed=true;
}catch(error){report.error=String(error.stack||error);report.state=await inspect?.().catch(()=>null);report.body=await page?.locator('body').innerText().catch(()=>null);report.transport=await desktop?.evaluate(()=>globalThis.__seekTransport).catch(()=>null);report.wire=await desktop?.evaluate(()=>globalThis.__seekWire).catch(()=>null);report.wireDuplicates=await desktop?.evaluate(()=>globalThis.__seekWireDuplicates).catch(()=>null);throw error;}
finally{
 try{await desktop?.close();}finally{const file=path.join(data,'report.json');writeFileSync(file,JSON.stringify(report,null,2));console.log(file);}
}
