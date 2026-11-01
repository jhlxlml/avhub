// Real packaged Electron + current physical display topology. No display settings
// changes, fake screens or colorimetric certification. Only owned media/data.
import {_electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {desktopTestSubject} from './desktop-test-subject.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const directory=mkdtempSync(path.join(root,'build/physical-app-'));
const media=path.join(directory,'media');mkdirSync(media);
const hdrDirectory=process.env.AVHUB_TEST_HDR_FIXTURE_DIR;
const hdrReceipt=hdrDirectory?JSON.parse(readFileSync(path.join(hdrDirectory,'fixtures.json'),'utf8')):null;
if(hdrDirectory){assert.match(path.basename(hdrDirectory),/^physical-hdr-fixtures-[a-zA-Z0-9]{6}$/);assert.equal(path.dirname(path.resolve(hdrDirectory)),path.join(root,'build'));assert.equal(hdrReceipt.kind,'owned-synthetic-code-value-HDR-charts');}
const fixtures=hdrReceipt?hdrReceipt.fixtures.map(item=>item.filename):process.env.AVHUB_TEST_HDR_ONLY==='1'?['HDR-PQ10-Color-v2-1024x256.mkv']:['Framecode-v2-1920x1080.mp4','Precision-SDR10-3840x2160.mkv','HDR-PQ10-Color-v2-1024x256.mkv'];
fixtures.forEach(name=>{assert.equal(path.basename(name),name);const source=path.join(hdrDirectory??path.join(root,'build/libmpv-render-spike/samples'),name);if(hdrReceipt)assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'),hdrReceipt.fixtures.find(item=>item.filename===name).sha256);copyFileSync(source,path.join(media,name));});
const sourceRun=process.env.AVHUB_TEST_SOURCE==='1';
const exe=process.env.AVHUB_TEST_PACKAGED_EXE;assert.ok(exe||sourceRun,'Require packaged executable or explicit source Electron');
const coordinated=process.env.AVHUB_TEST_SESSION_COORDINATOR==='1';
const report={kind:sourceRun?'physical-source-display-followup':'physical-packaged-display-followup',directory,coordinated,hdrReceipt,cases:[],limitations:['No colorimeter: physical luminance, gamut and HDR accuracy not certified','Generated fixtures only; no external-machine claim']};
let desktop,page;
try{
 desktop=await _electron.launch({...(sourceRun?{args:[root]}:{executablePath:exe,args:[]}),cwd:directory,env:{...process.env,AVHUB_DATA_DIR:directory,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0',AVHUB_RENDER_RUNTIME_CANDIDATE:sourceRun?'render-replayed-candidate-7wRYRz':'',AVHUB_RENDER_LOCAL_ACCEPTANCE:''},timeout:60000});
 page=await desktop.firstWindow();report.subject=await desktopTestSubject(desktop,import.meta.url);
 assert.equal(report.subject.buildId,sourceRun?JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')).build_id:process.env.AVHUB_TEST_EXPECTED_BUILD_ID??'084031ef4f398db9');
 report.displays=await desktop.evaluate(({screen})=>screen.getAllDisplays());assert.ok(report.displays.length>=2,'Requires physical second screen');
 report.mixedDpi=new Set(report.displays.map(d=>d.scaleFactor)).size>1;
 await desktop.evaluate(({app},directory)=>{const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');const {RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js');const open=RenderHostClient.prototype.open,capture=RenderHostClient.prototype.captureOwnedPng;globalThis.__physicalOpens=0;RenderHostClient.prototype.open=function(...args){globalThis.__physicalOpens++;globalThis.__physicalClient=this;return open.apply(this,args);};RenderHostClient.prototype.captureOwnedPng=async function(file){const result=await capture.call(this,file);require('node:fs').copyFileSync(file,require('node:path').join(directory,'raw-native-capture.png'));return result;};},directory);
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error(await response.text());return response.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,playbackSessionCoordinatorEnabled:coordinated,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>{window.avhubDesktop.onRenderState(state=>window.__physicalState=state);window.__physicalNotices=[];new MutationObserver(()=>{const text=document.querySelector('.native-notice')?.textContent;if(text&&window.__physicalNotices.at(-1)!==text)window.__physicalNotices.push(text);}).observe(document.body,{subtree:true,childList:true,characterData:true});});
 const reveal=async name=>{const button=page.getByRole('region',{name:'原生视频播放器',exact:true}).getByRole('button',{name,exact:true});await expect.poll(async()=>{await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert.ok(box);const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x-5,y);await page.mouse.move(x,y,{steps:2});return page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.getAttribute('aria-label'),{x,y});},{timeout:10000}).toBe(name);return button;};
 const evidence=async()=>({native:await desktop.evaluate(()=>globalThis.__physicalClient.display()),state:await page.evaluate(()=>window.__physicalState),canvas:await page.locator('.native-render-canvas').evaluate(el=>({width:el.width,height:el.height,rect:el.getBoundingClientRect().toJSON(),attributes:{...el.dataset},devicePixelRatio})),window:await desktop.evaluate(({BrowserWindow,screen})=>{const window=BrowserWindow.getAllWindows()[0];return {bounds:window.getBounds(),display:screen.getDisplayMatching(window.getBounds()),opens:globalThis.__physicalOpens};})});
 for(const fixture of fixtures){
  await page.getByRole('button',{name:'播放 '+path.parse(fixture).name,exact:true}).click();
  await expect.poll(()=>page.locator('.native-render-canvas').getAttribute('data-native-frame'),{timeout:30000}).not.toBeNull();
  const sessionRegion=page.getByLabel('MPV 原生播放区域',{exact:true});
  if(coordinated)await expect(sessionRegion).toHaveAttribute('data-playback-session-phase','ready');
  else await expect(sessionRegion).not.toHaveAttribute('data-playback-session-phase',/./);
  await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__physicalState.properties.pause)).toBe(true);const opens=await desktop.evaluate(()=>globalThis.__physicalOpens);
  for(const display of [...report.displays,...report.displays.slice(0,1)]){
   await desktop.evaluate(({BrowserWindow},display)=>{const window=BrowserWindow.getAllWindows()[0];window.unmaximize();const area=display.workArea;window.setBounds({x:area.x+20,y:area.y+20,width:Math.min(1000,area.width-40),height:Math.min(760,area.height-40)});window.show();window.focus();},display);
   await expect.poll(async()=>(await evidence()).window.display.id).toBe(display.id);
   await expect.poll(()=>page.evaluate(()=>devicePixelRatio)).toBe(display.scaleFactor);
   await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate(node=>{node.value='0.4';node.dispatchEvent(new Event('input',{bubbles:true}));});
   await expect.poll(()=>page.evaluate(()=>window.__physicalState.pendingSeek),{timeout:15000}).toBe(null);
   const item={fixture,displayId:display.id,windowed:await evidence()};report.cases.push(item);
   assert.equal(item.windowed.window.opens,opens,'Cross-screen must not reopen source');assert.equal(item.windowed.state.phase,'ready');assert.equal(item.windowed.state.sourceLoads,1);
   assert.equal(item.windowed.native.windowDpi,display.scaleFactor*96);
   assert.equal(item.windowed.canvas.attributes.renderPath,'d3d11-webgpu-rgba16float');
   if(hdrReceipt){
    assert.equal(item.windowed.canvas.width,3840);assert.equal(item.windowed.canvas.height,2160);
    assert.equal(item.windowed.state.properties['avhub-output-transfer'],fixture.includes('-HLG-')?'hlg':'pq');
    // VideoFrame uses "hlg"; FFprobe's name for the same transfer is arib-std-b67.
    assert.equal(item.windowed.canvas.attributes.nativeTransfer,fixture.includes('-HLG-')?'hlg':'pq');
    assert.equal(item.windowed.canvas.attributes.nativePrimaries,'bt2020');
    item.pixelSeeks=[];
    for(const frame of [31,52,109,128,12,102,87,29,136,106,58,139,82,45,110,98,128,63,14,10]){
     const started=performance.now();await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((node,target)=>{node.value=String(target);node.dispatchEvent(new Event('input',{bubbles:true}));},frame/25);
     await expect.poll(async()=>{const bytes=await page.locator('.native-render-canvas').screenshot();return desktop.evaluate(({nativeImage},base64)=>{const image=nativeImage.createFromBuffer(Buffer.from(base64,'base64')),size=image.getSize(),data=image.toBitmap();let code=0;for(let bit=0;bit<16;bit++){const at=(Math.floor(32/2160*size.height)*size.width+Math.floor((bit+.5)*size.width/16))*4;if(data[at+2]>180)code+=2**bit;}return code;},bytes.toString('base64'));},{timeout:15000}).toBe(frame);
     item.pixelSeeks.push({frame,positionSec:frame/25,elapsedIncludingCaptureMs:performance.now()-started});
    }
   }
   const captureDir=path.join(directory,'screenshots');const previous=new Set(existsSync(captureDir)?readdirSync(captureDir):[]);
   const captureStarted=performance.now();await (await reveal('截图（C）')).click();
   await expect.poll(async()=>{const notice=await page.locator('.native-notice').textContent().catch(()=>null);if(notice?.includes('未保存图片'))throw new Error(notice);return existsSync(captureDir)?readdirSync(captureDir).filter(name=>name.endsWith('.png')&&!previous.has(name)).length:0;},{timeout:30000}).toBe(1);
   const captureName=readdirSync(captureDir).find(name=>name.endsWith('.png')&&!previous.has(name));const png=readFileSync(path.join(captureDir,captureName));
   item.screenshot={name:captureName,width:png.readUInt32BE(16),height:png.readUInt32BE(20),bitDepth:png[24],elapsedMs:performance.now()-captureStarted};
   if(fixture!=='Framecode-v2-1920x1080.mp4')assert.equal(item.screenshot.bitDepth,16,'10-bit screenshot must not become 8-bit');
   await (await reveal('视频全屏')).click();await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.getWindowState())).toMatchObject({fullScreen:true});
   item.fullscreen=await evidence();await (await reveal('退出视频全屏')).click();await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.getWindowState())).toMatchObject({fullScreen:false});
   assert.equal(item.fullscreen.window.display.id,display.id);assert.equal(item.fullscreen.native.windowDpi,display.scaleFactor*96);
   await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());
   await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
   await desktop.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.restore();window.focus();});
   await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
   const prior=Number(await page.locator('.native-render-canvas').getAttribute('data-native-frame'));
   await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__physicalState.properties.pause)).toBe(false);
   await expect.poll(()=>page.locator('.native-render-canvas').getAttribute('data-native-frame'),{timeout:10000}).not.toBe(String(prior));
   await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__physicalState.properties.pause)).toBe(true);item.restored=await evidence();
   assert.equal(item.restored.window.opens,opens);assert.equal(item.restored.state.phase,'ready');assert.equal(item.restored.state.sourceLoads,1);
   await page.screenshot({path:path.join(directory,fixture+'-'+display.id+'-'+report.cases.length+'.png')});
   item.passed=true;
  }
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 }
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack??error);if(page){report.body=await page.locator('body').innerText();report.notices=await page.evaluate(()=>window.__physicalNotices);await page.screenshot({path:path.join(directory,'failure.png')});}process.exitCode=1;}
finally{
 if(desktop)await desktop.close();
 const log=existsSync(path.join(directory,'desktop.log'))?readFileSync(path.join(directory,'desktop.log'),'utf8'):'';
 report.cleanup=log.split('\n').filter(line=>line.includes('render-player-closed ')).map(line=>JSON.parse(line.slice(line.indexOf('render-player-closed ')+21)));
 if(report.passed){assert.equal(report.cleanup.length,fixtures.length);report.cleanup.forEach(item=>{assert.equal(item.helperAlive,false);assert.equal(item.sourceLeaseReleased,true);assert.equal(item.transport.imports,item.transport.released);assert.equal(item.transport.leases,item.transport.closedLeases);});}
 writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(directory,'report.json'),error:report.error,displays:report.displays?.map(d=>({id:d.id,scaleFactor:d.scaleFactor,bounds:d.bounds,colorDepth:d.colorDepth}))}));
}


