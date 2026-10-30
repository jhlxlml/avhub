// Real Electron + native OpenGL Render API; generated fixtures only.
import assert from 'node:assert/strict';
import {build} from 'vite';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {nativeVisualEvidence} from '../native-visual-evidence.mjs';
import {fixture,referenceFrames,referencePrecision,sourceFingerprint} from './framecode-fixtures.mjs';
import sourceContracts from './source-contract.cjs';
import displayContracts from './display-contract.cjs';
import attestation from './runtime-attestation.cjs';
import {overlayAcceptance} from './overlay-acceptance.mjs';
import {soakAcceptance} from './soak-acceptance.mjs';
import {deviceLossAcceptance} from './device-loss-acceptance.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),folder=path.join(root,'build/libmpv-render-spike');
const packaged=process.argv.includes('--packaged');
let packagedExecutable,artifact;
if(packaged){const input=JSON.parse(readFileSync(path.join(folder,'packaged-location.json')));artifact=attestation.verifyLocation(input,await sourceFingerprint(),folder);packagedExecutable=artifact.executable;}
const verified=spawnSync('python',[path.join(root,'scripts/prepare-libmpv-render.py'),'--candidate',process.env.AVHUB_RENDER_BACKEND==='d3d11'?'d3d11':'render','--offline','--verify-only'],{windowsHide:true,encoding:'utf8'});assert.equal(verified.status,0,verified.stdout+verified.stderr);
const ffiVerified=spawnSync('python',[path.join(root,'scripts/prepare-render-ffi.py'),'--offline'],{windowsHide:true,encoding:'utf8'});assert.equal(ffiVerified.status,0,ffiVerified.stdout+ffiVerified.stderr);
const evidence=mkdtempSync(path.join(folder,'evidence-')),ui=path.join(folder,'ui');mkdirSync(ui,{recursive:true});
const source=fixture(root,process.env.AVHUB_RENDER_SAMPLE);
const precisionFixture=path.basename(source).startsWith('Precision-SDR10-');
const sourceOptions={floatingPoint:process.env.AVHUB_RENDER_FP16==='1',diagnosticSdr10:process.env.AVHUB_RENDER_SDR10==='1'};
const sourceProbe=spawnSync(path.join(root,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-read_intervals','%+#1','-show_format','-show_streams','-show_frames','-of','json',source],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(sourceProbe.status,0,sourceProbe.stderr);const verifiedSource=sourceContracts.mergeProbe(JSON.parse(sourceProbe.stdout));sourceContracts.sourceContract(verifiedSource,sourceOptions);
if(process.env.AVHUB_RENDER_SEEK_STRESS)throw new Error('Use AVHUB_RENDER_STRESS_SEEKS; unknown stress variable is forbidden');
const stress=Number(process.env.AVHUB_RENDER_STRESS_SEEKS||0);assert.ok(Number.isInteger(stress)&&stress>=0&&stress<=200);
const rounds=Number(process.env.AVHUB_RENDER_SEEK_ROUNDS||1);assert.ok(Number.isInteger(rounds)&&rounds>=1&&rounds<=4);
const cycle=[31,109,52,128,...Array.from({length:stress},(_,i)=>3+(i*37)%142)],targets=Array.from({length:rounds},()=>cycle).flat();
const reference=referenceFrames(root,source,verifiedSource.width,[0,...targets]);
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();
const compiled=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/platform:x64','/target:exe','/out:'+path.join(folder,'RenderHost.exe'),'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',path.join(import.meta.dirname,'RenderHost.cs'),path.join(import.meta.dirname,'SharedSurface.cs'),path.join(import.meta.dirname,'DisplayProbe.cs'),path.join(import.meta.dirname,'RenderSurface.cs'),path.join(import.meta.dirname,'D3dSurface.cs')],{windowsHide:true,encoding:'utf8'});assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
await build({configFile:false,root,base:'./',define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:ui,emptyOutDir:false,lib:{entry:path.join(import.meta.dirname,'controls.tsx'),name:'RenderSpike',formats:['iife'],fileName:()=> 'controls.js'}}});
writeFileSync(path.join(ui,'index.html'),'<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'unsafe-inline\'"></head><body><div id="root"></div><script src="./controls.js"></script></body></html>');
let desktop,hostPid;const report={scope:'isolated React fixture, not production player integration',mode:process.env.AVHUB_RENDER_SHARED_TEXTURE==='1'?'shared-texture':process.env.AVHUB_RENDER_STANDALONE_DIAGNOSTIC==='1'?'standalone-diagnostic':process.env.AVHUB_RENDER_DWM_DIAGNOSTIC==='1'?'direct-composition-disabled-diagnostic':'default-compositor-embedded',m2GatePassed:false,limitations:['Generated BT.709 SDR fixture only; source depth and output precision are recorded in runtime.contract; no private media','Experimental Electron sharedTexture + WGL_NV_DX_interop; other GPUs unverified','GPU copy and completion waits; not zero-copy or a production performance improvement claim','No physical HDR/colorimetry/mixed-DPI certification; SDR10 pixel evidence does not certify all 10-bit sources'],embeddedAcceptancePassed:false,completed:false,visuals:{},seeks:[]};console.log('Render API evidence:',evidence);
try{
 report.sourceFingerprint=await sourceFingerprint();report.artifact=artifact??null;
 if(precisionFixture)report.sourcePrecision=referencePrecision(root,source,verifiedSource.width,verifiedSource.height);
 report.limitations[0]=precisionFixture?'Generated lossless 10-bit BT.709 SDR precision ramp only; no private media':'Generated 8-bit BT.709 SDR only; no private media';
 report.limitations[3]='No HDR, physical display precision, general colorimetry or mixed-DPI certification';
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 desktop=await _electron.launch({...packaged?{executablePath:packagedExecutable,args:[]}:{args:[path.join(import.meta.dirname,'main.cjs')]},cwd:folder,env,timeout:30000});
 await expect.poll(()=>desktop.evaluate(()=>Boolean(globalThis.__renderSpike)),{timeout:30000}).toBe(true);
 hostPid=await desktop.evaluate(()=>globalThis.__renderSpike.pid);
 report.nativeDisplay=await desktop.evaluate(()=>globalThis.__renderSpike.command('display'));
 report.hdrDisplayAssessment=displayContracts.assessDisplay(report.nativeDisplay);
 report.displays=await desktop.evaluate(({screen})=>screen.getAllDisplays().map(d=>({id:d.id,size:d.size,scaleFactor:d.scaleFactor,colorDepth:d.colorDepth,depthPerComponent:d.depthPerComponent,displayFrequency:d.displayFrequency})));
 report.runtime=await desktop.evaluate(()=>globalThis.__renderSpike.runtime);assert.equal(report.runtime.packaged,packaged);if(packaged)report.mode='shared-texture';
 assert.equal(report.runtime.contract.width,verifiedSource.width);assert.equal(report.runtime.contract.height,verifiedSource.height);
 const controls=desktop.windows().find(w=>w.url().endsWith('/index.html'));assert.ok(controls);const errors=[];controls.on('pageerror',e=>errors.push(e.message));
 if(process.env.AVHUB_RENDER_OVERLAY_TEST!=='1'){await assert.rejects(()=>controls.evaluate(()=>window.renderSpike.command('subtitle-probe',true)),/Unsupported command/);report.overlayCommandsDisabledByDefault=true;}
 await expect(controls.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await expect(controls.getByRole('slider',{name:'跳播'})).toHaveAttribute('max',String(report.runtime.contract.durationSec??6));
 await expect(controls.getByRole('alert')).toHaveCount(0);
 const snapshot=()=>controls.evaluate(()=>window.renderSpike.command('snapshot'));
 await expect.poll(async()=>Number((await snapshot()).frames),{timeout:15000}).toBeGreaterThan(2);
 report.initial=await snapshot();report.renderOptions=await desktop.evaluate(()=>globalThis.__renderSpike.command('render-options'));assert.equal(report.initial.vo,'libmpv');assert.equal(report.initial.renderApi,report.runtime.backend);writeFileSync(path.join(evidence,'run-start.json'),JSON.stringify({runtime:report.runtime,initial:report.initial,displays:report.displays,sourceFingerprint:report.sourceFingerprint,artifact},null,2));assert.ok(report.initial.glRenderer&&!/GDI Generic|llvmpipe/i.test(report.initial.glRenderer));assert.equal(report.initial.renderError,null);
 if(report.mode==='shared-texture')await expect.poll(()=>controls.locator('#native-shared-video').getAttribute('data-frames')).not.toBe(null);
 if(report.mode==='shared-texture'){
  report.canvas=await controls.locator('#native-shared-video').evaluate(c=>({width:c.width,height:c.height,colorSpace:c.dataset.renderPath==='webgpu-rgba16float'?'srgb':c.getContext('2d').getContextAttributes().colorSpace,colorType:c.dataset.colorType,videoFormat:c.dataset.videoFormat,renderPath:c.dataset.renderPath,gpuAdapter:c.dataset.gpuAdapter?JSON.parse(c.dataset.gpuAdapter):null}));
  assert.equal(report.canvas.width,report.runtime.contract.width);assert.equal(report.canvas.height,report.runtime.contract.height);assert.equal(report.canvas.colorSpace,'srgb');
  if(sourceOptions.floatingPoint)assert.equal(report.canvas.colorType,'float16');
 }
 report.overlayAlpha=await desktop.evaluate(async()=>{const image=await globalThis.__renderSpike.controls.webContents.capturePage({x:200,y:200,width:100,height:100}),pixels=image.toBitmap();let opaque=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==0)opaque++;return {opaque,pixels:pixels.length/4};});
 report.environment=await desktop.evaluate(async({app,BrowserWindow,screen})=>({commandLine:process.argv,directCompositionDisabled:app.commandLine.hasSwitch('disable-direct-composition'),gpu:await app.getGPUInfo('complete'),displays:screen.getAllDisplays().map(d=>({scale:d.scaleFactor,bounds:d.bounds})),preferences:BrowserWindow.getAllWindows().map(w=>w.webContents.getLastWebPreferences())}));
 for(const p of report.environment.preferences){assert.equal(p.sandbox,true);assert.equal(p.contextIsolation,true);assert.equal(p.nodeIntegration,false);}
 if(process.env.AVHUB_RENDER_STANDALONE_DIAGNOSTIC==='1'){
  await desktop.evaluate(async({screen})=>{const s=globalThis.__renderSpike,b=s.main.getBounds(),scale=screen.getDisplayMatching(b).scaleFactor;s.controls.hide();await s.command('place',{x:Math.round(b.x*scale),y:Math.round(b.y*scale),width:Math.round(b.width*scale),height:Math.round(b.height*scale)});});
  const ownerHandle=await desktop.evaluate(()=>globalThis.__renderSpike.main.getNativeWindowHandle().readBigUInt64LE().toString());
  const foreground=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'electron/test/native-window-evidence.ps1'),'-HostHandle',ownerHandle],{windowsHide:true,encoding:'utf8'});assert.equal(foreground.status,0);const windows=JSON.parse(foreground.stdout);assert.ok([hostPid,windows.hostWindow.pid].includes(windows.foregroundWindow.pid),'Test surface lost foreground; abort desktop capture');
  await controls.waitForTimeout(300);report.standaloneDiagnostic=await nativeVisualEvidence(desktop,path.join(evidence,'standalone-diagnostic.png'),'render-api');writeFileSync(path.join(evidence,'standalone-diagnostic.json'),JSON.stringify(report.standaloneDiagnostic));
  assert.equal(report.standaloneDiagnostic.status,'pattern-visible');report.scope='standalone Render API diagnostic only; not embedded acceptance';
 }else{
 async function visible(name){
  if(sourceOptions.floatingPoint)await desktop.evaluate(()=>globalThis.__renderSpike.probeFrame());
  const display=await desktop.evaluate(()=>globalThis.__renderSpike.command('display'));
  report.displayStages??={};report.displayStages[name]={native:display,assessment:displayContracts.assessDisplay(display)};
  await desktop.evaluate(()=>{const {main,controls}=globalThis.__renderSpike;main.setAlwaysOnTop(false);main.setAlwaysOnTop(true);main.focus();controls.setAlwaysOnTop(false);controls.setAlwaysOnTop(true);controls.show();controls.focus();});await controls.waitForTimeout(300);
  const handles=await desktop.evaluate(()=>{const {main,controls}=globalThis.__renderSpike;return [main,controls].map(w=>w.getNativeWindowHandle().readBigUInt64LE().toString());});
  const windows=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'electron/test/native-window-evidence.ps1'),'-HostHandle',handles[0],'-ControlHandle',handles[1],...(report.mode==='shared-texture'?['-SkipForeground']:[])],{windowsHide:true,encoding:'utf8'});assert.equal(windows.status,0,windows.stderr);const placement=JSON.parse(windows.stdout);writeFileSync(path.join(evidence,name+'-windows.json'),windows.stdout);
  if(report.mode!=='shared-texture')assert.ok([hostPid,placement.hostWindow.pid].includes(placement.foregroundWindow.pid),'Test surface lost foreground; abort desktop capture');
  await controls.screenshot({path:path.join(evidence,name+'-react.png')});
  let result;
  if(report.mode==='shared-texture'){
   // The actual imported GPU video and React now share one Electron compositor.
   // Capture only that window, with no unrelated desktop contents or HWND layers.
   const capture=await desktop.evaluate(async()=>{const image=await globalThis.__renderSpike.main.webContents.capturePage(),s=image.getSize(),pixels=image.crop({x:Math.round(s.width*.2),y:Math.round(s.height*.2),width:Math.round(s.width*.6),height:Math.round(s.height*.5)}).toBitmap();let red=0,blue=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+2]-pixels[i]>60)red++;if(pixels[i]-pixels[i+2]>60)blue++;}return {redFraction:red/(pixels.length/4),blueFraction:blue/(pixels.length/4),png:image.toPNG().toString('base64')};});
   writeFileSync(path.join(evidence,name+'.png'),Buffer.from(capture.png,'base64'));delete capture.png;result={...capture,status:capture.redFraction>.03&&capture.blueFraction>.03?'pattern-visible':'pattern-not-visible',capture:'actual Electron compositor; physical desktop output unverified'};
   if(precisionFixture){const actual=await controls.locator('#native-shared-video').evaluate(c=>JSON.parse(c.dataset.precision));report.precisionProbe=actual;report.nativePrecisionProbe=await snapshot();assert.equal(actual.array,'WebGPU-F16-buffer');assert.ok(actual.levels>512,'The imported ramp was reduced to 8-bit precision');assert.equal(actual.plateauLevels,report.sourcePrecision.levels,'Source gray plateaus were merged');assert.ok(actual.maxBackwardStep<=1/1024,'Precision ramp is not monotonic within a source step');result={...result,status:'precision-ramp-visible',precision:actual};}
   assert.equal(placement.children.some(w=>w.className.startsWith('WindowsForms')),false,'Video must enter React through GPU texture, not a visible child HWND');
  }else result=await nativeVisualEvidence(desktop,path.join(evidence,name+'.png'),'render-api');
  report.visuals[name]=result;assert.equal(result.status,precisionFixture?'precision-ramp-visible':'pattern-visible',JSON.stringify(result));
 }
 await visible('normal');await controls.getByRole('button',{name:'暂停',exact:true}).click();await expect.poll(async()=>(await snapshot()).pause).toBe('yes');
 if(precisionFixture){
  const native=await desktop.evaluate(()=>globalThis.__renderSpike.command('precision-row'));
  const imported=await controls.locator('#native-shared-video').evaluate(c=>JSON.parse(c.dataset.precisionRow));
  assert.equal(native.values.length,verifiedSource.width);assert.equal(imported.length,verifiedSource.width);
  const deltas=imported.map((v,i)=>Math.abs(v-native.values[i]));
  report.transportPrecision={maxAbsoluteError:Math.max(...deltas),meanAbsoluteError:deltas.reduce((a,b)=>a+b,0)/deltas.length,overHalfStep:deltas.filter(v=>v>1/1024).length};
  writeFileSync(path.join(evidence,'precision-rows.json'),JSON.stringify({native:native.values,imported}));
  assert.ok(report.transportPrecision.maxAbsoluteError<=1e-6,'Shared texture transport changed actual F16 pixel values');
 }
 report.resourcesBefore=await desktop.evaluate(()=>globalThis.__renderSpike.command('resources'));
 if(process.env.AVHUB_RENDER_COMMAND_STRESS){
  const count=Number(process.env.AVHUB_RENDER_COMMAND_STRESS);assert.ok(Number.isInteger(count)&&count>=1&&count<=5000);
  const samples=[await desktop.evaluate(()=>globalThis.__renderSpike.command('resources'))];
  for(let i=0;i<count;i++){await desktop.evaluate(()=>globalThis.__renderSpike.command('ping'));if((i+1)%250===0)samples.push(await desktop.evaluate(()=>globalThis.__renderSpike.command('resources')));}
  report.commandStress={count,scope:'Actual serial native UI dispatch; not a playback FPS benchmark',samples};
 }
 if(process.env.AVHUB_RENDER_MEASURE_PLAYBACK==='1'){
  assert.equal(sourceOptions.floatingPoint,true,'Comparison requires the real F16 presenter');
  await desktop.evaluate(()=>globalThis.__renderSpike.command('seek',{value:0}));
  let first;await expect.poll(async()=>{first=await desktop.evaluate(()=>globalThis.__renderSpike.probeFrame());return first.top;}).toBe(0);
  const start=performance.now(),startedUtc=new Date().toISOString(),nativeBefore=await snapshot();const probes=[];
  await desktop.evaluate(()=>globalThis.__renderSpike.command('pause',{value:false}));
  for(let i=0;i<3;i++){await controls.waitForTimeout(1000);probes.push(await desktop.evaluate(()=>globalThis.__renderSpike.probeFrame()));}
  await desktop.evaluate(()=>globalThis.__renderSpike.command('pause',{value:true}));
  const last=await desktop.evaluate(()=>globalThis.__renderSpike.probeFrame()),nativeAfter=await snapshot(),count=last.metrics.frames-first.metrics.frames;
  const measured=last.metrics.serviceMs.slice(-count).slice(5).sort((a,b)=>a-b);
  const codes=probes.map(p=>p.top);assert.ok(codes.every(Number.isInteger));assert.ok(new Set(codes).size>=3,'Real video pixels did not advance');referenceFrames(root,source,verifiedSource.width,codes);
  report.playbackReadbackComparison={scope:'Short warm-cache F16 presenter comparison, not decoded FPS or physical scanout acceptance',startedUtc,endedUtc:new Date().toISOString(),mode:report.runtime.readbackMode,elapsedMs:performance.now()-start,frames:count,gpuCompletions:last.metrics.gpuCompletions-first.metrics.gpuCompletions,rowReadbacks:last.metrics.rowReadbacks-first.metrics.rowReadbacks,requestedReadbacks:last.metrics.requestedReadbacks-first.metrics.requestedReadbacks,sourcePixelCodes:codes,decoderDropsBefore:nativeBefore.drops,decoderDropsAfter:nativeAfter.drops,serviceSampleCount:measured.length,serviceP50Ms:measured[Math.floor(measured.length*.5)],serviceP95Ms:measured[Math.floor(measured.length*.95)]};
  assert.equal(report.playbackReadbackComparison.frames,report.playbackReadbackComparison.gpuCompletions);
  if(report.runtime.readbackMode==='on-demand')assert.equal(report.playbackReadbackComparison.rowReadbacks,report.playbackReadbackComparison.requestedReadbacks);
 }
 if(process.env.AVHUB_RENDER_DISPLAY_STRESS==='1'){
  const before=report.resourcesBefore;for(let i=0;i<30;i++)await desktop.evaluate(()=>globalThis.__renderSpike.command('display'));
  const after=await desktop.evaluate(()=>globalThis.__renderSpike.command('resources'));
  report.displayProbeStress={reads:30,before,after,handleGrowth:after.handles-before.handles,privateGrowth:after.privateBytes-before.privateBytes};
  assert.ok(report.displayProbeStress.handleGrowth<=8,'Native display query handles keep accumulating');
  assert.ok(report.displayProbeStress.privateGrowth<=32*1024*1024,'Native display query memory exceeds short-run budget');
 }
 report.resourceRounds=[];
 for(const target of targets.map(n=>n/25)){
  const start=performance.now(),old=Number((await snapshot()).frames),expected=reference[Math.round(target*25)];await controls.evaluate(value=>window.renderSpike.command('seek',value),target);
  let pixels;
  if(report.mode==='shared-texture')await expect.poll(async()=>{
   if(sourceOptions.floatingPoint)await desktop.evaluate(()=>globalThis.__renderSpike.probeFrame());
   pixels=await controls.locator('#native-shared-video').evaluate(c=>{
    if(c.dataset.renderPath==='webgpu-rgba16float')return {top:JSON.parse(c.dataset.framecodeTop),bottom:JSON.parse(c.dataset.framecodeBottom),nativeFrame:c.dataset.nativeFrame};
    function read(y){const row=c.getContext('2d').getImageData(0,y,c.width,1).data;let value=0;for(let bit=0;bit<16;bit++){const i=Math.floor((bit+.5)*c.width/16)*4,r=row[i],g=row[i+1],b=row[i+2];if(Math.abs(r-g)>12||Math.abs(r-b)>12||r>60&&r<180)return null;if(r>=180)value+=2**bit;}return value;}
    return {top:read(32),bottom:read(c.height-33),nativeFrame:c.dataset.nativeFrame};
   });report.lastPixelProbe=pixels;report.lastExpectedFrame=expected;return pixels.top!==null&&Math.abs(pixels.top-expected)<=1;
  },{timeout:10000,intervals:[10,20,50]}).toBe(true);
  else await expect.poll(async()=>{const state=await snapshot();return Math.abs(Number(state.time)-target)<.1&&Number(state.frames)>old;},{timeout:10000}).toBe(true);
  report.seeks.push({target,expectedFrame:expected,presentedPixels:pixels,frameError:pixels?pixels.top-expected:null,ms:performance.now()-start,snapshot:await snapshot(),metric:report.mode==='shared-texture'?'frame index decoded from actual imported video pixels, checked against independent FFmpeg source decoding; tolerance 1/25 second':'position and draw only'});
  if(report.seeks.length%cycle.length===0)report.resourceRounds.push(await desktop.evaluate(()=>globalThis.__renderSpike.command('resources')));
 }
 report.resourcesAfter=await desktop.evaluate(()=>globalThis.__renderSpike.command('resources'));
 const settledBefore=rounds>1?report.resourceRounds.at(-2):report.resourcesBefore;report.settledHandleGrowth=report.resourcesAfter.handles-settledBefore.handles;
 report.resourceConvergenceChecked=rounds>=3;
 if(report.resourceConvergenceChecked){
  {
   // Retain the original assertion; later idle drops cannot rescue its failure.
   await expect.poll(()=>desktop.evaluate(()=>{const s=globalThis.__renderSpike.transferStats;return s.imports-s.released;})).toBe(0);
   report.idleResourceTrace=[];
   const traceStart=performance.now();
   for(let i=0;i<30;i++){await controls.waitForTimeout(200);report.idleResourceTrace.push({elapsedMs:performance.now()-traceStart,resources:await desktop.evaluate(()=>globalThis.__renderSpike.command('resources')),handleTypes:process.env.AVHUB_RENDER_HANDLE_TYPES==='1'?await desktop.evaluate(()=>globalThis.__renderSpike.command('handle-types')):null,transfers:await desktop.evaluate(()=>({...globalThis.__renderSpike.transferStats}))});}
  }
  assert.ok(report.settledHandleGrowth<=8,'Native handle growth does not converge within the short-run budget');
  report.idleSettleMs=4000;const measuredIdle=report.idleResourceTrace.filter(p=>p.elapsedMs>=report.idleSettleMs).slice(-10);assert.equal(measuredIdle.length,10,'Missing fixed post-settle idle samples');assert.ok(measuredIdle.every(p=>p.transfers.imports===p.transfers.released),'GPU readers appeared during idle measurement');const idleHandles=measuredIdle.map(p=>p.resources.handles);report.idleHandleRange=Math.max(...idleHandles)-Math.min(...idleHandles);const sortedHandles=[...idleHandles].sort((a,b)=>a-b);report.postIdleHandleGrowth=sortedHandles[5]-settledBefore.handles;assert.ok(report.postIdleHandleGrowth<=8,'Released native handles failed to converge after fixed settling');
  assert.ok(report.idleHandleRange<=8,'Handles keep accumulating during paused, released-frame sampling');
  report.settledPrivateGrowth=report.resourcesAfter.privateBytes-settledBefore.privateBytes;
  assert.ok(report.settledPrivateGrowth<=64*1024*1024,'Native private memory does not converge within the short-run budget');
  if(report.resourcesAfter.gpuMemory){report.settledGpuGrowth=report.resourcesAfter.gpuMemory.CurrentUsage-settledBefore.gpuMemory.CurrentUsage;assert.ok(report.settledGpuGrowth<=64*1024*1024,'Native GPU memory does not converge within the short-run budget');assert.ok(report.resourcesAfter.gpuMemory.CurrentUsage<=report.resourcesAfter.gpuMemory.Budget);}
 }
 if(process.env.AVHUB_RENDER_OVERLAY_TEST==='1')report.overlayAcceptance=await overlayAcceptance({desktop,controls,evidence,floatingPoint:sourceOptions.floatingPoint});
 await controls.getByRole('button',{name:'设置',exact:true}).click();await expect(controls.getByRole('menu')).toBeVisible();await visible('react-menu');await controls.getByRole('button',{name:'关闭菜单',exact:true}).click();
 await controls.getByRole('button',{name:'全屏',exact:true}).click();await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.main.isFullScreen())).toBe(true);await visible('fullscreen');
 if(process.env.AVHUB_RENDER_OVERLAY_TEST==='1'){report.fullscreenOverlayAcceptance=await overlayAcceptance({desktop,controls,evidence,floatingPoint:sourceOptions.floatingPoint,label:'fullscreen'});assert.equal(await desktop.evaluate(()=>globalThis.__renderSpike.main.isFullScreen()),true,'Menu Escape unexpectedly exited fullscreen');}
 await controls.getByRole('button',{name:'全屏',exact:true}).click();await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.main.isFullScreen())).toBe(false);
 const restoreBounds=await desktop.evaluate(()=>globalThis.__renderSpike.main.getBounds());
 await desktop.evaluate(()=>globalThis.__renderSpike.main.maximize());await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.main.isMaximized())).toBe(true);await visible('maximized');
 await desktop.evaluate(()=>globalThis.__renderSpike.main.unmaximize());await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.main.isMaximized())).toBe(false);
 await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.main.getBounds())).toEqual(restoreBounds);await visible('unmaximized');report.maximizeRestorePassed=true;
 await desktop.evaluate(()=>globalThis.__renderSpike.main.minimize());await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.controls.isVisible())).toBe(false);
 await desktop.evaluate(()=>globalThis.__renderSpike.main.restore());await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.controls.isVisible())).toBe(true);await visible('restored');
 if(process.env.AVHUB_RENDER_SOAK_SECONDS){assert.equal(sourceOptions.floatingPoint,true);assert.ok(['Precision-SDR10-3840x2160.mkv','Precision-SDR10-Continuous-3840x2160.mkv','Precision-SDR10-Long-v1-3840x2160.mkv'].includes(path.basename(source)));report.soakAcceptance=await soakAcceptance({desktop,controls,evidence,seconds:Number(process.env.AVHUB_RENDER_SOAK_SECONDS),continuous:/Continuous|Long-v1/.test(path.basename(source)),continuousDuration:path.basename(source).includes('Long-v1')?960:180});}
 if(report.mode==='shared-texture'&&process.env.AVHUB_RENDER_INJECT_EXIT==='1'){
  await desktop.evaluate(()=>process.kill(globalThis.__renderSpike.pid));await expect(controls.getByRole('alert')).toContainText('原生渲染宿主异常');assert.equal(await desktop.evaluate(()=>globalThis.__renderSpike.main.isDestroyed()),false);await expect(controls.getByRole('button',{name:'设置',exact:true})).toBeVisible();await controls.getByRole('button',{name:'设置',exact:true}).click();await expect(controls.getByRole('menu')).toBeVisible();report.injectedProcessExitHandled=true;
 }
 if(report.mode==='shared-texture'&&process.env.AVHUB_RENDER_INJECT_PIPE==='1'){
  await desktop.evaluate(()=>globalThis.__renderSpike.injectPipeFailure());
  await expect(controls.getByRole('alert')).toContainText('Injected native command pipe failure');
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.hostExited())).toBe(true);
  assert.equal(await desktop.evaluate(()=>globalThis.__renderSpike.main.isDestroyed()),false);
  await controls.getByRole('button',{name:'设置',exact:true}).click();await expect(controls.getByRole('menu')).toBeVisible();
  report.injectedCommandPipeFailureHandled=true;
 }
 if(report.mode==='shared-texture'&&process.env.AVHUB_RENDER_TEST_FAILURE_BOUNDARY==='1'){
  await desktop.evaluate(async()=>{globalThis.__holdNextSharedFrame=true;await globalThis.__renderSpike.command('seek',{value:1.12});});
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__heldSharedFrame||0)).toBeGreaterThan(0);
  const before=await desktop.evaluate(()=>({...globalThis.__renderSpike.transferStats}));
  await desktop.evaluate(()=>globalThis.__renderSpike.injectPipeFailure());
  await expect(controls.getByRole('alert')).toContainText('Injected native command pipe failure');
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.hostExited())).toBe(true);
  await desktop.evaluate(()=>globalThis.__releaseHeldSnapshot());
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__releasedHeldSnapshot)).toBe(true);
  const after=await desktop.evaluate(()=>({...globalThis.__renderSpike.transferStats}));assert.deepEqual(after,before,'An in-flight snapshot admitted a frame after fatal failure');
  report.failureBoundary={passed:true,before,after,held:await desktop.evaluate(()=>globalThis.__heldSharedFrame),lastAtHold:await desktop.evaluate(()=>globalThis.__heldLastImportedFrame)};
  assert.ok(report.failureBoundary.held>report.failureBoundary.lastAtHold);
 }
 if(report.mode==='shared-texture'&&process.env.AVHUB_RENDER_INJECT_WEBGPU==='1'){
  assert.equal(sourceOptions.floatingPoint,true);report.deviceLoss=await deviceLossAcceptance(desktop,controls);
  report.expectedInjectedGpuErrors=errors.filter(e=>/device.*(lost|destroy)|destroy.*device/i.test(e));
 }
 if(report.mode==='shared-texture'&&process.env.AVHUB_RENDER_INJECT_RENDER==='1'){
  await desktop.evaluate(()=>globalThis.__renderSpike.command('inject-render-error'));
  await expect(controls.getByRole('alert')).toContainText('Injected render-thread failure');
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.hostExited())).toBe(true);
  assert.equal(await desktop.evaluate(()=>globalThis.__renderSpike.main.isDestroyed()),false);
  report.injectedRenderFailureHandled=true;
 }
 if(report.mode==='shared-texture'&&process.env.AVHUB_RENDER_INJECT_IMPORT==='1'){
  await desktop.evaluate(async()=>{globalThis.__injectImportFailure=true;await globalThis.__renderSpike.command('pause',{value:false});});await expect(controls.getByRole('alert')).toContainText('Injected shared texture import failure');assert.equal(await desktop.evaluate(()=>globalThis.__renderSpike.main.isDestroyed()),false);report.injectedImportFailureHandled=true;
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.hostExited())).toBe(true);report.nativeExitConfirmedBeforeClose=true;
 }
 if(report.mode==='shared-texture'){
  const fault=['AVHUB_RENDER_INJECT_EXIT','AVHUB_RENDER_INJECT_PIPE','AVHUB_RENDER_TEST_FAILURE_BOUNDARY','AVHUB_RENDER_INJECT_WEBGPU','AVHUB_RENDER_INJECT_RENDER','AVHUB_RENDER_INJECT_IMPORT'].some(k=>process.env[k]==='1');
  if(fault)await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.handleStats().live),{timeout:10000}).toBe(0);
  report.handleBeforeClose=await desktop.evaluate(()=>globalThis.__renderSpike.handleStats());
  if(fault){assert.equal(report.handleBeforeClose.created,1);assert.equal(report.handleBeforeClose.closed,1);assert.equal(report.handleBeforeClose.valid,false);assert.equal(await desktop.evaluate(()=>globalThis.__renderSpike.main.isDestroyed()),false);}
 }
 report.embeddedAcceptancePassed=['default-compositor-embedded','shared-texture'].includes(report.mode);
 if(report.mode==='shared-texture'){await expect.poll(()=>desktop.evaluate(()=>{const s=globalThis.__renderSpike.transferStats;return s.imports-s.released;}),{timeout:5000}).toBe(0);report.transferStats=await desktop.evaluate(()=>process.env.AVHUB_RENDER_TEST_CLOSE_BOUNDARY==='1'?{...globalThis.__renderSpike.transferStats}:globalThis.__renderSpike.quiesce());assert.ok(report.transferStats.maxInFlight<=1);assert.equal(report.transferStats.importFailures,report.injectedImportFailureHandled?1:0);}
 }
 const closeStart=performance.now();
 if(process.env.AVHUB_RENDER_TEST_CLOSE_BOUNDARY==='1'){
  await desktop.evaluate(async()=>{globalThis.__holdNextSharedFrame=true;await globalThis.__renderSpike.command('seek',{value:1.12});});
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__heldSharedFrame||0)).toBeGreaterThan(0);
  report.closeBoundaryBefore=await desktop.evaluate(()=>({...globalThis.__renderSpike.transferStats}));
  await desktop.evaluate(()=>{globalThis.__renderSpike.main.close();globalThis.__renderSpike.main.close();globalThis.__releaseHeldSnapshot();});
  await expect.poll(()=>existsSync(path.join(report.runtime.logFolder,'shutdown-evidence.json')),{timeout:10000}).toBe(true);
 }
 await desktop.close();report.closeMs=performance.now()-closeStart;desktop=null;if(report.injectedImportFailureHandled)assert.ok(report.closeMs<4000,'Failed import must not leave an unresolved GPU reference wait');const processCheck=spawnSync('powershell.exe',['-NoProfile','-Command',`if (Get-Process -Id ${hostPid} -ErrorAction SilentlyContinue) { exit 1 }`],{windowsHide:true});assert.equal(processCheck.status,0,'host must exit with Electron');
 if(process.env.AVHUB_RENDER_TEST_CLOSE_BOUNDARY==='1'){report.shutdownEvidence=JSON.parse(readFileSync(path.join(report.runtime.logFolder,'shutdown-evidence.json')));assert.ok(report.shutdownEvidence.heldSharedFrame>report.shutdownEvidence.lastImportedFrameAtHold,'Held state must represent an eligible new frame');assert.equal(report.shutdownEvidence.transferStats.imports,report.closeBoundaryBefore.imports,'A held frame was admitted after close');assert.equal(report.shutdownEvidence.transferStats.imports,report.shutdownEvidence.transferStats.released);assert.equal(report.shutdownEvidence.hostExited,true);assert.equal(report.shutdownEvidence.forcedTermination,false,'Healthy close required forced native termination');assert.equal(report.shutdownEvidence.nativeExitCode,0,'Healthy native shutdown was not clean');}
 if(report.mode==='shared-texture'){report.handleCleanup=JSON.parse(readFileSync(path.join(report.runtime.logFolder,'handle-cleanup.json')));assert.equal(report.handleCleanup.live,0);assert.equal(report.handleCleanup.created,1);assert.equal(report.handleCleanup.closed,1);assert.equal(report.handleCleanup.valid,false);}
 assert.equal(await sourceFingerprint(),report.sourceFingerprint,'Runtime source changed during acceptance');
 assert.equal(hash(),before);assert.deepEqual(errors.filter(e=>!report.deviceLoss?.passed||!/device.*(lost|destroy)|destroy.*device/i.test(e)),[]);report.sourceUnchanged=true;report.cleanExit=true;report.completed=true;
}catch(error){report.error=String(error.stack||error);if(desktop&&precisionFixture){try{const native=await desktop.evaluate(()=>globalThis.__renderSpike.command('precision-row')),page=desktop.windows().find(w=>w.url().endsWith('/index.html')),imported=await page.locator('#native-shared-video').evaluate(c=>JSON.parse(c.dataset.precisionRow||'null'));writeFileSync(path.join(evidence,'failure-precision-rows.json'),JSON.stringify({native,imported}));}catch{}}throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});writeFileSync(path.join(evidence,'acceptance.json'),JSON.stringify(report,null,2));}
