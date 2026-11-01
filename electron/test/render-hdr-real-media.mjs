// Actual Electron HDR rendering evidence. Original user media stays read-only.
// Captured pixels are not a colorimetric or physical HDR-output certificate.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
import {desktopTestSubject} from './desktop-test-subject.mjs';
const pipelineTiming=createRequire(import.meta.url)('./render-api/pipeline-timing.cjs');
const root=path.resolve(import.meta.dirname,'../..');
const packagedExe=process.env.AVHUB_TEST_PACKAGED_EXE,collectTiming=['1','methods'].includes(process.env.AVHUB_HDR_TIMINGS),collectResources=process.env.AVHUB_HDR_RESOURCES==='1';
assert.ok(!packagedExe||path.isAbsolute(packagedExe),'Packaged HDR acceptance requires an explicit absolute executable');
const source=process.argv[2]??'E:/downloads/The World in HDR in 4K (ULTRA HD).mkv';
const seconds=Number(process.env.AVHUB_HDR_REPRO_SECONDS??15);assert.ok(Number.isInteger(seconds)&&seconds>=15&&seconds<=1200);
const identity=()=>({sha256:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs});
const before=identity(),folder=mkdtempSync(path.join(root,'build/hdr-real-media-')),media=path.join(folder,'media');mkdirSync(media);copyFileSync(source,path.join(media,'HDR.mkv'));
const report={scope:'actual Electron compositor evidence, not physical HDR certification',source,before,phase:process.env.AVHUB_HDR_REPRO_PHASE??'diagnostic',captures:[],captureCompleted:false};let desktop,page;
let layoutSession,layoutContext;
try{
 desktop=await _electron.launch({...(packagedExe?{executablePath:packagedExe,args:[]}:{args:[root]}),cwd:folder,env:{...process.env,AVHUB_DATA_DIR:folder,AVHUB_RENDER_RUNTIME_CANDIDATE:packagedExe?'':'render-replayed-candidate-7wRYRz',AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();report.subject=await desktopTestSubject(desktop,import.meta.url);
 assert.equal(report.subject.kind,packagedExe?'packaged-desktop':'source-desktop');
 report.timingObserverEnabled=collectTiming;
 report.gpuInfo=await desktop.evaluate(({app})=>app.getGPUInfo('complete'));
 if(collectTiming)await desktop.evaluate(pipelineTiming,{eventLoop:process.env.AVHUB_HDR_TIMINGS!=='methods'});
 if(collectResources)await desktop.evaluate(({app})=>{const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js'),snapshot=RenderHostClient.prototype.snapshot;RenderHostClient.prototype.snapshot=function(){globalThis.__hdrResourceClient=this;return snapshot.call(this);};});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 if(process.env.AVHUB_HDR_LAYOUT_COUNT==='1'){
  layoutSession=await desktop.context().newCDPSession(page);const contexts=[];layoutSession.on('Runtime.executionContextCreated',({context})=>contexts.push(context));await layoutSession.send('Runtime.enable');
  layoutContext=contexts.find(context=>context.name==='Electron Isolated Context')?.id;assert.ok(layoutContext,'Real preload isolated world must be available for layout-call observation');
  await layoutSession.send('Runtime.evaluate',{contextId:layoutContext,expression:'globalThis.__hdrLayoutCalls=0;globalThis.__hdrOriginalLayout=GPURenderPipeline.prototype.getBindGroupLayout;GPURenderPipeline.prototype.getBindGroupLayout=function(...args){globalThis.__hdrLayoutCalls++;return globalThis.__hdrOriginalLayout.apply(this,args)}'});
 }
 await page.evaluate(()=>{window.__hdrTransitions=[];window.avhubDesktop.onRenderState(state=>{const previous=window.__hdrState;window.__hdrState=state;if(!previous||previous.properties.pause!==state.properties.pause||previous.playIntent!==state.playIntent||previous.clock?.active!==state.clock?.active||previous.properties['frame-drop-count']!==state.properties['frame-drop-count']||previous.properties['decoder-frame-drop-count']!==state.properties['decoder-frame-drop-count']){window.__hdrTransitions.push({atMs:performance.now(),position:state.positionSec,pause:state.properties.pause,intent:state.playIntent,clock:state.clock,decoderDrops:state.properties['decoder-frame-drop-count'],outputDrops:state.properties['frame-drop-count'],serial:state.presented?.serial});if(window.__hdrTransitions.length>128)window.__hdrTransitions.shift();}});});await page.getByRole('button',{name:'播放 HDR',exact:true}).click();
 const canvas=page.locator('.native-render-canvas');await expect(canvas).toBeVisible({timeout:30000});await expect.poll(()=>canvas.getAttribute('data-native-frame'),{timeout:20000}).not.toBeNull();
 await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__hdrState.properties.pause)).toBe(true);
 report.displays=await desktop.evaluate(({screen})=>screen.getAllDisplays());
 for(const display of report.displays){
  await desktop.evaluate(({BrowserWindow},d)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setBounds({x:d.workArea.x+20,y:d.workArea.y+20,width:Math.min(1100,d.workArea.width-40),height:Math.min(850,d.workArea.height-40)});w.show();w.focus();},display);
  await expect.poll(()=>page.evaluate(()=>devicePixelRatio)).toBe(display.scaleFactor);
  await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect.poll(()=>page.evaluate(()=>window.__hdrState.pendingSeek),{timeout:20000}).toBe(null);
  await page.waitForTimeout(300);
  const file=path.join(folder,'display-'+display.id+'.png');await page.screenshot({path:file});
  report.captures.push({displayId:display.id,file,state:await page.evaluate(()=>window.__hdrState),canvas:await canvas.evaluate(el=>({...el.dataset})),displays:display});
 }
 const start=await page.evaluate(()=>window.__hdrState);report.beforeResume=start;report.measurementBeginAtMs=await page.evaluate(()=>performance.now());await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__hdrState.properties.pause)).toBe(false);report.afterResume=await page.evaluate(()=>window.__hdrState);
 if(collectResources)report.resourcesBefore=await desktop.evaluate(async({app})=>({electron:app.getAppMetrics(),native:await globalThis.__hdrResourceClient.resources()}));
 if(collectTiming)await desktop.evaluate(()=>globalThis.__startPipelineTiming());
 const began=performance.now();let previous=start,advanced=0,nextSeek=60000;report.playbackSamples=[];report.plannedSeeks=[];
 while(performance.now()-began<seconds*1000){
  await page.waitForTimeout(Math.min(5000,Math.max(1,seconds*1000-(performance.now()-began))));
  const current=await page.evaluate(()=>window.__hdrState),elapsedMs=performance.now()-began;
  assert.equal(current.phase,'ready');assert.equal(current.properties.pause,false);assert.equal(current.sourceLoads,1);
  assert.ok(current.positionSec>previous.positionSec,'Media clock stopped advancing');assert.ok(current.presented.serial>previous.presented.serial,'GPU presentation stopped advancing');
  const visibility=await page.evaluate(()=>({state:document.visibilityState,focused:document.hasFocus()}));
  const windowState=await desktop.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];return {visible:window.isVisible(),minimized:window.isMinimized(),focused:window.isFocused()};});
  advanced+=current.positionSec-previous.positionSec;report.playbackSamples.push({elapsedMs,position:current.positionSec,serial:current.presented.serial,transport:current.transport,clock:current.clock,visibility,windowState,decoderDrops:current.properties['decoder-frame-drop-count'],outputDrops:current.properties['frame-drop-count']});previous=current;
  if(collectResources)report.playbackSamples.at(-1).resources=await desktop.evaluate(async({app})=>({electron:app.getAppMetrics(),native:await globalThis.__hdrResourceClient.resources()}));
  if(elapsedMs>=nextSeek&&elapsedMs<seconds*1000-5000){
   const seekBegan=performance.now();await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
   await expect.poll(async()=>{const s=await page.evaluate(()=>window.__hdrState);return s.pendingSeek===null&&s.positionSec<10;},{timeout:20000}).toBe(true);
   previous=await page.evaluate(()=>window.__hdrState);assert.ok(Math.abs(previous.positionSec-5)<2);report.plannedSeeks.push({elapsedMs,completedMs:performance.now()-seekBegan,position:previous.positionSec,presented:previous.presented});nextSeek+=60000;
   console.log(JSON.stringify({seconds:Math.round(elapsedMs/1000),plannedSeek:report.plannedSeeks.at(-1),sourceLoads:previous.sourceLoads}));
  }
 }
 const end=await page.evaluate(()=>window.__hdrState);
 report.transitions=await page.evaluate(()=>window.__hdrTransitions);
 if(layoutSession){report.layoutCalls=(await layoutSession.send('Runtime.evaluate',{contextId:layoutContext,expression:'globalThis.__hdrLayoutCalls',returnByValue:true})).result.value;assert.ok(Number.isSafeInteger(report.layoutCalls)&&report.layoutCalls>=3);}
 if(collectResources)report.resourcesAfter=await desktop.evaluate(async({app})=>({electron:app.getAppMetrics(),native:await globalThis.__hdrResourceClient.resources()}));
 if(collectTiming)report.pipelineTiming=await desktop.evaluate(()=>globalThis.__stopPipelineTiming());
 report.playback={seconds,elapsedMs:performance.now()-began,positionAdvance:advanced,presentedSerialAdvance:end.presented.serial-start.presented.serial,sourceLoads:end.sourceLoads,decoderDrops:end.properties['decoder-frame-drop-count']-start.properties['decoder-frame-drop-count'],outputDrops:end.properties['frame-drop-count']-start.properties['frame-drop-count']};
 // libmpv counters can reset on seek. Retain every observed nonzero value,
 // rather than letting a later seek make an earlier failure appear as zero.
 const measured=report.transitions.filter(state=>state.atMs>=report.measurementBeginAtMs);
 report.playback.observedDecoderDropMaximum=Math.max(start.properties['decoder-frame-drop-count'],...report.playbackSamples.map(state=>state.decoderDrops),...measured.map(state=>state.decoderDrops),end.properties['decoder-frame-drop-count']);
 report.playback.observedOutputDropMaximum=Math.max(start.properties['frame-drop-count'],...report.playbackSamples.map(state=>state.outputDrops),...measured.map(state=>state.outputDrops),end.properties['frame-drop-count']);
 assert.equal(report.playback.observedDecoderDropMaximum,0);assert.equal(report.playback.observedOutputDropMaximum,0);
 assert.ok(report.playback.positionAdvance>seconds*.8);assert.ok(report.playback.presentedSerialAdvance>seconds*6);assert.equal(end.sourceLoads,1);assert.equal(report.playback.decoderDrops,0);assert.equal(report.playback.outputDrops,0);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).toMatchObject({active:false});
 report.after=identity();assert.deepEqual(report.after,before);report.captureCompleted=true;
}catch(error){report.error=String(error.stack??error);throw error;}
finally{if(desktop)await desktop.close();writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({captureCompleted:report.captureCompleted,report:path.join(folder,'report.json')}));}
