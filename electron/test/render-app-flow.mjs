import {placeTestMedia,mediaHash} from './media-pool.mjs';
// Actual AVHub Electron/React + application native service + shared GPU texture.
// All media/data are owned fixtures. Pixel proof is compositor capture, not
// physical scanout. Precise seek intents use the real UI's DOM input handler.
import {createRequire} from 'node:module';
import {desktopTestSubject} from './desktop-test-subject.mjs';
import assert from 'node:assert/strict';import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync,readdirSync} from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/render-app-flow-')),media=path.join(data,'media');mkdirSync(media);
const sample=process.argv[2]??'Framecode-v2-640x360.mp4',sizes={'Framecode-v2-640x360.mp4':[640,360,8],'Framecode-v2-3840x2160-hevc.mkv':[3840,2160,8],'Framecode-v3-3840x2160-av1.mkv':[3840,2160,8],'Precision-SDR10-3840x2160.mkv':[3840,2160,10],'Precision-SDR10-2160x3840.mkv':[2160,3840,10]};assert.ok(sizes[sample],'Only owned generated fixtures');const [width,height,depth]=sizes[sample];
const unicode=process.env.AVHUB_TEST_UNICODE_SOURCE==='1',title=unicode?'Framecode 中文 한글 🎬':'Framecode',directory=unicode?path.join(media,'中文目录 한글 🎬'):media;mkdirSync(directory,{recursive:true});
const generated=path.join(root,'build/libmpv-render-spike/samples',sample),source=path.join(directory,title+path.extname(sample));placeTestMedia(generated,source,{ownedGenerated:true});
const identity=()=>({sha256:mediaHash(source),mtime:statSync(source).mtimeMs}),before=identity();
const packagedExe=process.env.AVHUB_TEST_PACKAGED_EXE;
const require=createRequire(import.meta.url),runtimePaths=require('../dist/renderRuntimeLayout.js');
const layout=packagedExe?runtimePaths.resolveRenderRuntime(root,true,path.join(path.dirname(packagedExe),'resources'),undefined,'1'):runtimePaths.renderRuntimeLayout(root,false,'',process.env.AVHUB_RENDER_RUNTIME_CANDIDATE);
const sessionCoordinator=process.env.AVHUB_TEST_SESSION_COORDINATOR==='1';
const report={kind:'real-avhub-electron-render-api',runtime:JSON.parse(readFileSync(layout.manifest,'utf8')),sourceBefore:before,unicodeSource:unicode,sessionCoordinator,pixelSeeks:[]};let desktop,page;
try{
 desktop=await _electron.launch({...(packagedExe?{executablePath:packagedExe,args:[]}:{args:[root]}),cwd:data,env:{...process.env,...(packagedExe?{AVHUB_RENDER_RUNTIME_CANDIDATE:'',AVHUB_RENDER_LOCAL_ACCEPTANCE:process.env.AVHUB_TEST_DESKTOP_RENDER==='1'?'':'1'}:{}),AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();
 if(packagedExe){report.kind='real-packaged-avhub-electron-render-api';report.packaged=await desktop.evaluate(({app})=>({isPackaged:app.isPackaged,appPath:app.getAppPath(),resources:process.resourcesPath,exe:process.execPath}));assert.equal(report.packaged.isPackaged,true);assert.equal(path.resolve(report.packaged.exe).toLowerCase(),path.resolve(packagedExe).toLowerCase());assert.equal(path.resolve(report.packaged.resources).toLowerCase(),path.join(path.dirname(packagedExe),'resources').toLowerCase());}
 report.subject=await desktopTestSubject(desktop,import.meta.url);
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 if(packagedExe||process.env.AVHUB_RENDER_RUNTIME_CANDIDATE)await desktop.evaluate(({app})=>{const base=app.getAppPath(),require=process.getBuiltinModule('node:module').createRequire(base+'/package.json'),{RenderHostClient}=require(base+'/electron/dist/renderHostClient.js'),open=RenderHostClient.prototype.open;RenderHostClient.prototype.open=function(...args){return open.apply(this,args).then(value=>{globalThis.__renderLayoutPid=this.pid;globalThis.__renderFlowClient=this;return value;});};});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',mpvSeekPolicy:'exact',nativeRenderEnabled:true,...(sessionCoordinator?{playbackSessionCoordinatorEnabled:true}:{}),resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__renderFlowState=s));await page.getByRole('button',{name:'播放 '+title,exact:true}).click();
 const canvas=page.locator('.native-render-canvas');await expect(canvas).toBeVisible({timeout:30000});await expect.poll(()=>canvas.getAttribute('data-native-frame'),{timeout:20000}).not.toBeNull();
 const sessionRegion=page.getByLabel('MPV 原生播放区域',{exact:true});
 if(sessionCoordinator){await expect(sessionRegion).toHaveAttribute('data-playback-session-phase','ready');report.sessionGeneration=Number(await sessionRegion.getAttribute('data-playback-session-generation'));assert.ok(Number.isSafeInteger(report.sessionGeneration)&&report.sessionGeneration>0);}
 else await expect(sessionRegion).not.toHaveAttribute('data-playback-session-phase',/./);
 assert.equal(desktop.windows().length,1,'Native render must not open another UI window');
 if(packagedExe||process.env.AVHUB_RENDER_RUNTIME_CANDIDATE){
  report.loadedModules=await desktop.evaluate(async()=>{const {execFile}=process.getBuiltinModule('node:child_process'),pid=globalThis.__renderLayoutPid;if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Missing owned helper PID');const command=`[System.Diagnostics.Process]::GetProcessById(${pid}).Modules | Where-Object { $_.ModuleName -in @('libmpv-2.dll','vulkan-1.dll','libplacebo-387.dll','avcodec-63.dll','libass-9.dll','libshaderc_shared.dll') } | Select-Object ModuleName,FileName | ConvertTo-Json`;return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true,timeout:10000},(error,stdout)=>error?reject(error):resolve(JSON.parse(stdout))));});
  const expected=path.dirname(layout.dll),moduleNames=layout.selfBuiltCandidate?['libmpv-2.dll','libplacebo-387.dll','avcodec-63.dll','libass-9.dll','libshaderc_shared.dll']:['libmpv-2.dll','vulkan-1.dll'];for(const name of moduleNames){const loaded=report.loadedModules.find(m=>m.ModuleName.toLowerCase()===name);assert.ok(loaded);assert.equal(path.resolve(loaded.FileName).toLowerCase(),path.join(expected,name).toLowerCase());}
  report.runtimeCandidate=packagedExe?'packaged-explicit-local-acceptance':process.env.AVHUB_RENDER_RUNTIME_CANDIDATE;
 }

 const reveal=async(buttonName)=>{const region=page.getByRole('region',{name:'原生视频播放器',exact:true}),controls=region.locator('.native-controls'),target=buttonName?region.getByRole('button',{name:buttonName,exact:true}):controls;await expect.poll(async()=>{await target.scrollIntoViewIfNeeded();const rect=await target.boundingBox();assert.ok(rect);const x=rect.x+rect.width/2,y=rect.y+rect.height/2;report.controlReveal=await page.evaluate(({x,y,rect})=>({x,y,rect,viewport:{width:innerWidth,height:innerHeight},insidePlayer:Boolean(document.elementFromPoint(x,y)?.closest('.native-stage'))}),{x,y,rect});await page.mouse.move(x-5,y);if(buttonName)await target.hover({force:true});else await page.mouse.move(x,y,{steps:2});return region.getAttribute('class');},{timeout:5000,intervals:[100,250,500]}).toMatch(/controls-visible/);};
 await reveal();await page.getByRole('button',{name:'暂停',exact:true}).click();await expect(page.getByRole('button',{name:'播放',exact:true})).toBeAttached();
 const timeline=page.getByRole('slider',{name:'播放进度',exact:true});
 async function pixels(){const png=await canvas.screenshot();return desktop.evaluate(({nativeImage},{base64,height})=>{const image=nativeImage.createFromBuffer(Buffer.from(base64,'base64')),size=image.getSize(),data=image.toBitmap();let code=0;const values=[];for(let bit=0;bit<16;bit++){const x=Math.floor((bit+.5)*size.width/16),y=Math.floor(32/height*size.height),at=(y*size.width+x)*4;const rgb=[data[at+2],data[at+1],data[at]];values.push(rgb);if(rgb[0]>180)code+=2**bit;}return {...size,code,values};},{base64:png.toString('base64'),height});}
 for(const frame of [31,52,109,128,10]){
  await reveal();await timeline.evaluate((node,target)=>{node.value=String(target);node.dispatchEvent(new Event('input',{bubbles:true}));},frame/25);
  await expect.poll(async()=>(await pixels()).code,{timeout:15000}).toBe(frame);const proof=await pixels();assert.ok(proof.values.every(([r,g,b])=>Math.abs(r-g)<12&&Math.abs(r-b)<12&&(r<60||r>180)));report.pixelSeeks.push({requestedFrame:frame,proof});
 }
 // Exercise the real renderer adapter/export action without changing OS clipboard.
 if(process.env.AVHUB_TEST_CONTROL_SETTINGS==='1')await page.evaluate(()=>{
  window.__controlEvents=[];const record=value=>{window.__controlEvents.push({at:performance.now(),...value});if(window.__controlEvents.length>128)window.__controlEvents.shift();};
  for(const kind of ['mousemove','mouseout','mouseleave','scroll'])document.addEventListener(kind,event=>{const node=event.target;record({kind,target:node instanceof Element?node.tagName+'.'+node.getAttribute('class'):null,related:event.relatedTarget instanceof Element?event.relatedTarget.tagName+'.'+event.relatedTarget.getAttribute('class'):null,x:event.clientX,y:event.clientY});},true);
  new MutationObserver(()=>record({kind:'stage-class',value:document.querySelector('.native-stage')?.className})).observe(document.querySelector('.native-stage'),{attributes:true,attributeFilter:['class']});
 });
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__renderDiagnosticExport=JSON.parse(text);}}}));
 const settingsButton=page.getByRole('button',{name:'播放设置与信息',exact:true});
 for(let turn=0;turn<3;turn++){
  const bounds=await sessionRegion.boundingBox();assert.ok(bounds);
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await expect(page.getByRole('region',{name:'原生视频播放器',exact:true})).not.toHaveClass(/controls-visible/);
  await reveal('播放设置与信息');await page.waitForTimeout(650);
  await expect(page.getByRole('region',{name:'原生视频播放器',exact:true})).toHaveClass(/controls-visible/);
  await settingsButton.click({timeout:5000});
  if(turn<2)await page.getByRole('button',{name:'关闭播放设置',exact:true}).click();
 }
 if(packagedExe||process.env.AVHUB_RENDER_RUNTIME_CANDIDATE){report.frameNotifications=await desktop.evaluate(()=>typeof globalThis.__renderFlowClient.frameNotificationStats==='function'?globalThis.__renderFlowClient.frameNotificationStats():null);if(process.env.AVHUB_TEST_EXPECT_FRAME_NOTIFICATIONS==='1')assert.ok(report.frameNotifications?.received>0);if(process.env.AVHUB_TEST_EXPECT_FRAME_NOTIFICATIONS==='0')assert.equal(report.frameNotifications?.received,0);}
 report.settingsControl={hoverRetentionMs:650,cycles:3,entry:'actual-control-bar-normal-click'};
 await page.getByRole('button',{name:'复制播放诊断',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__renderDiagnosticExport?.dropCounterScope)).toBe('current-mpv-reading-may-reset-on-seek');
 const diagnostics=await page.evaluate(()=>window.__renderDiagnosticExport);assert.equal(diagnostics.engine,'libmpv-render-d3d11');assert.equal(diagnostics.dropped,await page.evaluate(()=>window.__renderFlowState.properties['frame-drop-count']??null));assert.equal(diagnostics.decoderDropped,await page.evaluate(()=>window.__renderFlowState.properties['decoder-frame-drop-count']??null));report.controlEvents=await page.evaluate(()=>window.__controlEvents??[]);report.dropCounterExport={scope:diagnostics.dropCounterScope,dropped:diagnostics.dropped,decoderDropped:diagnostics.decoderDropped};
 await page.getByRole('button',{name:'关闭播放设置',exact:true}).click();
 await page.evaluate(()=>{window.__captureNotices=[];new MutationObserver(()=>{const text=document.querySelector('.native-notice')?.textContent;if(text&&window.__captureNotices.at(-1)!==text)window.__captureNotices.push(text);}).observe(document.body,{subtree:true,childList:true,characterData:true});});
 await reveal();await page.getByRole('button',{name:'截图（C）',exact:true}).click();await expect.poll(async()=>page.evaluate(()=>window.__captureNotices.some(s=>s.includes('截图已保存：'))),{timeout:30000}).toBe(true);report.screenshotSaved=true;const screenshotDir=path.join(data,'screenshots'),pngFile=readdirSync(screenshotDir).find(n=>n.endsWith('.png'));assert.ok(pngFile);const png=readFileSync(path.join(screenshotDir,pngFile));assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);report.screenshot={width,height,bitDepth:png[24]};if(depth===10)assert.equal(png[24],16,'SDR10 PNG must retain high bit depth');
 await page.keyboard.press('Space');await expect.poll(async()=>(await pixels()).code,{timeout:10000}).toBeGreaterThan(10);await timeline.evaluate(node=>{node.value='4';node.dispatchEvent(new Event('input',{bubbles:true}));});await expect.poll(async()=>{const code=(await pixels()).code;return code>=100&&code<120;},{timeout:10000}).toBe(true);await expect.poll(()=>page.evaluate(()=>window.__renderFlowState.pendingSeek)).toBe(null);await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__renderFlowState.properties.pause)).toBe(true);report.playingSeekAndSpace=true;
 const box=await page.getByRole('region',{name:'原生视频播放器',exact:true}).boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-120);await expect.poll(()=>canvas.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a)).toBeGreaterThan(1);await expect.poll(()=>page.evaluate(()=>window.__renderFlowState.properties['video-zoom'])).toBeGreaterThan(0);await reveal();await page.getByRole('button',{name:'还原缩放',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__renderFlowState.properties['video-zoom'])).toBe(0);await reveal();await page.getByRole('button',{name:'旋转画面',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__renderFlowState.properties['video-rotate'])).toBe(90);report.zoomAndRotation=true;
 await reveal();await page.getByRole('button',{name:'视频全屏',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.getWindowState())).toMatchObject({fullScreen:true});await reveal();await page.getByRole('button',{name:'退出视频全屏',exact:true}).click();
 await reveal();await page.getByRole('button',{name:'纯净播放',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.getWindowState())).toMatchObject({purePlayback:true,alwaysOnTop:true});await reveal('退出纯净播放');await page.getByRole('button',{name:'退出纯净播放',exact:true}).click();
 if(process.env.AVHUB_TEST_SESSION_HANDOFF==='1'){
  assert.equal(depth,8,'This handoff harness uses the owned Chromium-compatible H264 fixture');
  for(let turn=0;turn<3;turn++){await reveal();await page.getByRole('button',{name:'旋转画面',exact:true}).click();}
  await expect.poll(()=>page.evaluate(()=>window.__renderFlowState.properties['video-rotate'])).toBe(0);
  const nativeFrame=(await pixels()).code,nativePosition=await page.evaluate(()=>window.__renderFlowState.positionSec);
  await page.getByRole('button',{name:'切换现有播放器',exact:true}).click();
  const video=page.locator('video');await expect.poll(()=>video.evaluate(v=>v.readyState),{timeout:15000}).toBeGreaterThanOrEqual(2);
  const frame=()=>video.evaluate(v=>{const canvas=document.createElement('canvas');canvas.width=v.videoWidth;canvas.height=v.videoHeight;const context=canvas.getContext('2d');context.drawImage(v,0,0);const row=context.getImageData(0,32,canvas.width,1).data;let code=0;for(let bit=0;bit<16;bit++)if(row[Math.floor((bit+.5)*canvas.width/16)*4]>180)code+=2**bit;return code;});
  await expect.poll(async()=>Math.abs(await frame()-nativeFrame),{timeout:15000}).toBeLessThanOrEqual(1);
  const html5=await video.evaluate(v=>({position:v.currentTime,paused:v.paused,source:new URL(v.currentSrc).pathname,width:v.videoWidth,height:v.videoHeight}));assert.equal(html5.paused,true);assert.ok(Math.abs(html5.position-nativePosition)<.2);assert.ok(/^\/media\/\d+\/file$/.test(html5.source));assert.equal((await api('/api/preferences')).values.playerEngine,'mpv');assert.equal((await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active,false);
  report.controlledHandoff={from:'libmpv-d3d11',to:'chromium-original',nativeFrame,chromiumFrame:await frame(),nativePosition,html5,preferenceUnchanged:true};
 }
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);assert.equal((await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active,false);
 if(process.env.AVHUB_TEST_SHADER_REOPEN==='1'){
  const cache=path.join(data,'native-shaders-v1'),files=readdirSync(cache).filter(name=>/^[a-f0-9]{64}$/i.test(name));assert.ok(files.length>0,'real shader cache must have compiled programs before reopen');
  if(process.env.AVHUB_TEST_SHADER_CORRUPT==='1'){let count=0;for(const name of files){const file=path.join(cache,name),bytes=readFileSync(file),at=bytes.indexOf(Buffer.from('DXBC'));if(at>=0){bytes[at+4]^=1;writeFileSync(file,bytes);count++;}}assert.ok(count>0);report.corruptedOwnedShaderPrograms=count;}
  await page.evaluate(()=>window.__renderFlowState=null);await page.getByRole('button',{name:'播放 '+title,exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__renderFlowState?.phase),{timeout:30000}).toBe('ready');
  await reveal();await page.getByRole('button',{name:'暂停',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__renderFlowState.properties.pause)).toBe(true);
  await timeline.evaluate(node=>{node.value=String(31/25);node.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect.poll(async()=>(await pixels()).code,{timeout:15000}).toBe(31);report.shaderCacheReopen={files:files.length,proof:await pixels()};
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
 }
 assert.deepEqual(identity(),before);assert.deepEqual(errors,[]);report.passed=true;report.sourceAfter=identity();await page.screenshot({path:path.join(data,'library-after.png')});
}catch(error){report.passed=false;report.error=String(error.stack||error);if(page){report.body=await page.locator('body').innerText().catch(()=>'<closed>');report.controlEvents=await page.evaluate(()=>window.__controlEvents??[]).catch(()=>[]);report.notices=await page.evaluate(()=>window.__captureNotices).catch(()=>[]);await page.screenshot({path:path.join(data,'failure.png')}).catch(()=>{});}throw error;}
finally{
 writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));
 if(desktop){
  await desktop.close();
  report.cleanup=readFileSync(path.join(data,'desktop.log'),'utf8').split('\n').filter(s=>s.includes('render-player-closed ')).map(s=>JSON.parse(s.slice(s.indexOf('render-player-closed ')+21)));
  if(report.passed){assert.ok(report.cleanup.length);for(const c of report.cleanup){assert.equal(c.helperAlive,false);assert.equal(c.sourceLeaseReleased,true);if(c.transport){assert.equal(c.transport.imports,c.transport.released);assert.equal(c.transport.leases,c.transport.closedLeases);}}}
  report.cleanupCompleted=true;
 }
 writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(data,'report.json')}));
}
