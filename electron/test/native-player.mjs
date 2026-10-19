// Real Electron + owned MPV process acceptance; synthetic media only.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,statSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {nativeVisualEvidence} from './native-visual-evidence.mjs';
const root=path.resolve(import.meta.dirname,'../..');
mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','native-player-${pause}-'));
const media=path.join(data,'media');mkdirSync(media);
const source=path.join(media,'native ${pause} sample.mkv');
writeFileSync(path.join(media,'native ${pause} sample.srt'),'1\n00:00:00,000 --> 00:00:19,000\nNative subtitle fixture\n');
const made=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-map','0:v','-map','1:a','-map','2:a','-t','20','-c:v','libx264','-g','50','-pix_fmt','yuv420p','-c:a:0','aac','-c:a:1','flac',source],{windowsHide:true,timeout:30000});
assert.equal(made.status,0,String(made.stderr));
const fingerprint=()=>({hash:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs});
const before=fingerprint();let desktop;
try{
  desktop=await _electron.launch({args:[root,'--no-sandbox'],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();
  await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  const status=await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'));assert.equal(status.available,true,'pinned runtime prepared');
  await page.evaluate(async directory=>{await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});await fetch('/api/scan',{method:'POST'});},media);
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).total),{timeout:20000}).toBe(1);
  const id=await page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).items[0].id);
  await assert.rejects(()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('open',{mediaId:'C:/arbitrary.mkv',start:0})));
  // Cookie-authorized renderer cannot reserve/release raw native read leases.
  assert.equal(await page.evaluate(async id=>(await fetch(`/api/media/${id}/native-read`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:'a'.repeat(32)})})).status,id),403);
  const result=await page.evaluate(id=>window.avhubDesktop.nativePlayer('open',{mediaId:id,start:0}),id);
  const overlay=desktop.windows().find(window=>window.url().includes('nativePlayer='));assert.ok(overlay,'AVHub controls overlay');
  const snapshot=()=>overlay.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
  // Do not wait for the first decoded frame before accepting user navigation.
  await overlay.evaluate(session=>window.avhubDesktop.nativePlayer('seek',{session,value:5}),result.session);
  await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:20000}).toBe(null);
  await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:10000}).toBeGreaterThan(4.5);
  const nativeHost=await desktop.evaluate(({BaseWindow,BrowserWindow})=>{const host=BaseWindow.getAllWindows().find(w=>w.getTitle()==='AVHub · 原生播放');return {hasWebContents:'webContents' in host,isBrowserWindow:host instanceof BrowserWindow};});
  assert.deepEqual(nativeHost,{hasWebContents:false,isBrowserWindow:false},'native HWND host must not paint a Chromium surface over MPV');
  await expect.poll(async()=>(await snapshot()).phase,{timeout:20000}).toBe('ready');
  await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:10000}).toBeGreaterThan(.2);
  // Computed CSS transparency is insufficient: Chromium can paint an opaque
  // canvas (notably with root color-scheme:dark) over the native decoder.
  const overlayPixels=await desktop.evaluate(async({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('nativePlayer='));
    const image=await window.webContents.capturePage({x:200,y:120,width:100,height:100});
    const pixels=image.toBitmap();let opaque=0;
    for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==0)opaque++;
    return {pixels:pixels.length/4,opaque};
  });
  assert.ok(overlayPixels.pixels>0,'overlay pixel capture available');
  assert.equal(overlayPixels.opaque,0,`overlay video area must have zero alpha: ${JSON.stringify(overlayPixels)}`);
  const handle=await desktop.evaluate(({BaseWindow})=>{const host=BaseWindow.getAllWindows().find(w=>w.getTitle()==='AVHub · 原生播放');const value=host.getNativeWindowHandle();return (value.length===8?value.readBigUInt64LE():BigInt(value.readUInt32LE())).toString();});
  const inspectWindows=()=>{
    const evidence=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'electron/test/native-window-evidence.ps1'),'-HostHandle',handle],{windowsHide:true,encoding:'utf8',timeout:20000});
    assert.equal(evidence.status,0,evidence.stderr);return JSON.parse(evidence.stdout);
  };
  const windows=inspectWindows();writeFileSync(path.join(data,'native-windows.json'),JSON.stringify(windows,null,2));
  const decoderWindow=windows.children.find(child=>child.className==='mpv');
  assert.ok(decoderWindow?.visible&&decoderWindow.width>100&&decoderWindow.height>100&&decoderWindow.pid!==windows.hostWindow.pid,`visible native decoder HWND required: ${JSON.stringify(windows)}`);
  assert.equal(decoderWindow.previous,'0','MPV must be above the host Intermediate D3D Window, not covered by it');
  assert.equal(await page.evaluate(async()=> (await fetch('/api/native-read/00000000000000000000000000000000/surface',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:1,host_pid:1,decoder_pid:2})})).status),403,'renderer cannot reorder native windows');
  const call=(action,value)=>overlay.evaluate(({action,value,session})=>window.avhubDesktop.nativePlayer(action,{session,value}),{action,value,session:result.session});
  const diagnostics=await call('diagnostics');
  assert.equal(diagnostics.engine,'mpv');
  assert.equal(diagnostics.processMemory.unit,'KiB');
  assert.equal(diagnostics.processMemory.scope,'electron-processes-only');
  assert.ok(diagnostics.processMemory.processes.some(row=>row.role==='main'&&row.workingSetKiB>0));
  assert.ok(diagnostics.processMemory.processes.some(row=>row.role==='controls-renderer'&&row.workingSetKiB>0));
  assert.ok(!JSON.stringify(diagnostics).includes(data),'shared diagnostics exclude local media paths');
  assert.ok(!JSON.stringify(diagnostics).includes('Owned native'),'shared diagnostics exclude media titles');
  await assert.rejects(()=>page.evaluate(session=>window.avhubDesktop.nativePlayer('seek',{session,value:5}),result.session),'main cannot control native command API');
  await assert.rejects(()=>call('command',['run','cmd.exe']),'no arbitrary native commands');
  await call('pause',true);await expect.poll(async()=>(await snapshot()).properties.pause).toBe(true);
  await Promise.all([2,14,6,12].map(value=>call('seek',value)));
  await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:20000}).toBe(null);
  let state=await snapshot();assert.ok(Math.abs(state.properties['time-pos']-12)<.5,JSON.stringify(state));assert.ok(state.lastSeekMs!==null);
  assert.equal(state.properties['video-params'].w,640);assert.equal(state.properties['video-params'].h,360);
  const audio=state.properties['track-list'].filter(track=>track.type==='audio');assert.equal(audio.length,2);
  await call('track',{kind:'audio',id:audio[1].id});await expect.poll(async()=>(await snapshot()).properties.aid).toBe(audio[1].id);
  const subtitles=state.properties['track-list'].filter(track=>track.type==='sub');assert.ok(subtitles.length>0,'same-name sidecar subtitle');
  await call('track',{kind:'sub',id:subtitles[0].id});await expect.poll(async()=>(await snapshot()).properties.sid).toBe(subtitles[0].id);
  await call('sub-delay',.35);
  await call('subtitle-style',{size:34,color:'#ffe38a',background:.35});
  await assert.rejects(()=>call('subtitle-style',{size:999,color:'url(evil)',background:1}));
  const imported=path.join(data,'picked ${pause}.vtt');writeFileSync(imported,'WEBVTT\n\n00:00:00.000 --> 00:00:19.000\nPicked subtitle\n');
  await desktop.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},imported);
  await call('subtitle-import');
  await expect.poll(async()=>(await snapshot()).properties['track-list'].filter(t=>t.type==='sub').length).toBeGreaterThan(subtitles.length);
  // Only the trusted file dialog may supply an external path; caller input is ignored.
  await assert.rejects(()=>page.evaluate(session=>window.avhubDesktop.nativePlayer('subtitle-import',{session,value:'C:/arbitrary.srt'}),result.session));
  // MPV actually decodes a frame into PNG, then the existing screenshot store
  // validates it and publishes to the configured application directory.
  const screenshot=await call('screenshot');assert.equal(screenshot.width,640);assert.equal(screenshot.height,360);assert.ok(readFileSync(screenshot.path).length>1000);
  // Exercise the actual camera button and C key, not only the privileged API.
  const existingCaptures=new Set(readdirSync(screenshot.directory));
  const newCaptures=()=>readdirSync(screenshot.directory).filter(name=>!existingCaptures.has(name)&&name.endsWith('.png'));
  await overlay.mouse.move(250,(await overlay.evaluate(()=>innerHeight))-30);
  await overlay.getByRole('button',{name:'截图（C）',exact:true}).click();
  await expect.poll(()=>newCaptures().length,{timeout:30000}).toBe(1);
  await expect(overlay.getByText(/^截图已保存：/)).toBeVisible();
  const capturedBytes=readFileSync(path.join(screenshot.directory,newCaptures()[0]));
  assert.equal(capturedBytes.readUInt32BE(16),640);assert.equal(capturedBytes.readUInt32BE(20),360);
  await overlay.mouse.move(350,200);await expect(overlay.locator('.native-controls')).toHaveCSS('opacity','0');
  await overlay.keyboard.press('c');await expect.poll(()=>newCaptures().length,{timeout:30000}).toBe(2);
  await expect(overlay.getByRole('button',{name:'截图（C）',exact:true})).toBeEnabled();
  await call('window','pure');state=await snapshot();assert.equal(state.pure,true);assert.equal(state.pinned,true);
  await call('window','maximize');assert.equal((await snapshot()).maximized,true);
  const pureBounds=await desktop.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().find(window=>window.getTitle()==='AVHub · 原生播放').getContentBounds());
  assert.ok(Math.abs(pureBounds.width/pureBounds.height-16/9)<.02,'pure maximize retains video aspect');
  await call('window','maximize');assert.equal((await snapshot()).maximized,false);
  await call('rotate',90);await call('seek',12);
  await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:10000}).toBe(null);
  await call('window','pure');await call('window','pure');
  const rotated=await snapshot();
  const rotatedBounds=await desktop.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().find(w=>w.getTitle()==='AVHub · 原生播放').getContentBounds());
  assert.ok(Math.abs(rotatedBounds.width/rotatedBounds.height-9/16)<.02,`rotated pure re-entry ratio: ${JSON.stringify({rotatedBounds,params:rotated.properties['video-params'],userRotate:rotated.properties['video-rotate']})}`);
  await call('rotate',0);await call('seek',12);await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:10000}).toBe(null);
  await call('window','pure');assert.equal((await snapshot()).pinned,false);
  await call('window','minimize');
  await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('nativePlayer=')).isVisible())).toBe(false);
  await page.evaluate(session=>window.avhubDesktop.nativePlayer('show',session),result.session);
  await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('nativePlayer=')).isVisible())).toBe(true);
  await desktop.evaluate(({BaseWindow})=>{globalThis.__nativeWindowEvents=[];const host=BaseWindow.getAllWindows().find(w=>w.getTitle()==='AVHub · 原生播放');for(const name of ['enter-full-screen','leave-full-screen','resize','move'])host.on(name,()=>{if(globalThis.__nativeWindowEvents.length<100)globalThis.__nativeWindowEvents.push({name,full:host.isFullScreen(),bounds:host.getBounds()});});});
  await call('window','fullscreen');await expect.poll(async()=>(await snapshot()).fullscreen).toBe(true);
  await call('window','fullscreen');await expect.poll(async()=>(await snapshot()).fullscreen).toBe(false);
  await expect.poll(()=>inspectWindows().children.find(child=>child.className==='mpv')?.previous,{timeout:10000}).toBe('0');
  const windowBounds=await desktop.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().filter(w=>w.getTitle()==='AVHub · 原生播放'||w.webContents?.getURL().includes('nativePlayer=')).map(w=>w.getTitle()==='AVHub · 原生播放'?w.getContentBounds():w.getBounds()));
  for(const key of ['x','y','width','height'])assert.ok(Math.abs(windowBounds[0][key]-windowBounds[1][key])<=2,'host and controls align within fractional-DPI rounding');
  const actionInfo=await page.evaluate(async id=>(await(await fetch(`/api/media/${id}/file-actions`)).json()),id);
  assert.equal(actionInfo.rename,false);assert.equal(actionInfo.recycle,false);
  await overlay.mouse.move(250,overlay.viewportSize()?.height-35||650);
  await overlay.getByRole('slider',{name:'播放进度',exact:true}).focus();await overlay.keyboard.press('Space');
  await expect.poll(async()=>(await snapshot()).properties.pause).toBe(false);
  await call('pause',true);
  // Capture the fixture, not another app the user may have brought forward.
  // Pin only this isolated test window and restore the prior state afterwards.
  await call('window','pin');
  await page.evaluate(session=>window.avhubDesktop.nativePlayer('show',session),result.session);
  await overlay.waitForTimeout(150);
  const actualFrameEvidence=await nativeVisualEvidence(desktop,path.join(data,'native-window.png'));
  await call('window','pin');
  if(process.env.AVHUB_REQUIRE_VISIBLE_NATIVE==='1')assert.equal(actualFrameEvidence.status,'pattern-visible',`visible native acceptance: ${JSON.stringify(actualFrameEvidence)}`);
  await overlay.evaluate(session=>{const write=window.avhubDesktop.nativePlayer('speed',{session,value:1.25});const closing=window.avhubDesktop.nativePlayer('close',session);void Promise.all([write,closing]).catch(()=>{});},result.session);
  await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('status')).then(v=>v.active)).toBe(false);
  const saved=await page.evaluate(async id=>(await(await fetch(`/api/media/${id}`)).json()).progress,id);assert.ok(saved>11&&saved<15,`saved native progress ${saved}`);
  const savedStyle=await page.evaluate(async()=>(await(await fetch('/api/preferences')).json()).values.subtitleAppearance);assert.deepEqual(savedStyle,{size:34,color:'#ffe38a',background:.35});
  assert.equal(await page.evaluate(async()=>(await(await fetch('/api/preferences')).json()).values.playbackSpeed),1.25,'accepted speed command survives immediate close');
  const savedTracks=await page.evaluate(async id=>(await(await fetch(`/api/media/${id}/playback-state`)).json()),id);
  assert.equal(savedTracks.audio,audio[1]['ff-index']);assert.equal(savedTracks.delay,.35);assert.ok(savedTracks.subtitle.endsWith('.srt'));
  // Exercise the actual library preference/router, not just main-process IPC.
  await page.evaluate(async()=>{const response=await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{playerEngine:'mpv',resumeBehavior:'restart',audio:{volume:0,muted:true}}})});if(!response.ok)throw new Error('Cannot save test preferences');});
  await page.goto(new URL(`/?video=${id}`,page.url()).href);
  await expect(page.getByText('MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:20000});
  let routed=desktop.windows().find(w=>w.url().includes('nativePlayer='));
  await expect.poll(()=>routed.evaluate(async()=>{const s=await window.avhubDesktop.nativePlayer('snapshot');const t=s.properties['track-list'].find(t=>t.type==='audio'&&t.id===s.properties.aid);return t?.['ff-index'];})).toBe(audio[1]['ff-index']);
  await expect.poll(()=>routed.evaluate(async()=>(await window.avhubDesktop.nativePlayer('snapshot')).properties['sub-delay'])).toBe(.35);
  // Switch to the fixture's AAC track before Chromium. Never enable lossy
  // conversion merely to make a FLAC compatibility test pass.
  await routed.evaluate(async()=>{const s=await window.avhubDesktop.nativePlayer('snapshot');const t=s.properties['track-list'].find(t=>t.type==='audio'&&t.codec==='aac');await window.avhubDesktop.nativePlayer('track',{session:s.session,value:{kind:'audio',id:t.id}});});
  await routed.evaluate(async()=>{const s=await window.avhubDesktop.nativePlayer('snapshot');await window.avhubDesktop.nativePlayer('navigate',{session:s.session,value:'queue'});});
  await expect(page.getByRole('button',{name:'收起待播队列',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'切换现有播放器',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2),{timeout:20000}).toBe(true);
  await page.locator('video').evaluate(v=>v.pause());
  assert.equal((await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active,false);
  // Repeated opens, stale session rejection and renderer crash must release the
  // native lease/windows/listeners; a subsequent open proves no orphan lease.
  const listenersBefore=await desktop.evaluate(({screen})=>screen.listenerCount('display-metrics-changed'));
  for(let cycle=0;cycle<3;cycle++){
    const next=await page.evaluate(id=>window.avhubDesktop.nativePlayer('open',{mediaId:id,start:2}),id);
    await assert.rejects(()=>page.evaluate(session=>window.avhubDesktop.nativePlayer('close',session),result.session));
    if(cycle===2)await desktop.evaluate(({BrowserWindow})=>{const contents=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('nativePlayer=')).webContents;globalThis.__nativeCrashProbe={before:contents.getOSProcessId(),listeners:contents.listenerCount('render-process-gone')};contents.on('render-process-gone',(_event,details)=>{globalThis.__nativeCrashProbe.gone=details;});contents.forcefullyCrashRenderer();setTimeout(()=>{let alive=false;try{process.kill(globalThis.__nativeCrashProbe.before,0);alive=true;}catch{}globalThis.__nativeCrashProbe.after={alive,destroyed:contents.isDestroyed(),crashed:!contents.isDestroyed()&&contents.isCrashed()};},500);});
    else await page.evaluate(session=>window.avhubDesktop.nativePlayer('close',session),next.session);
    await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('status')).then(v=>v.active),{timeout:20000}).toBe(false);
  }
  assert.equal(await desktop.evaluate(({screen})=>screen.listenerCount('display-metrics-changed')),listenersBefore,'no display listener leaks');
  // Quit while an owned native decoder is active, not just after closing it.
  await page.locator('video').evaluate(v=>{v.pause();v.removeAttribute('src');v.load();});
  await page.evaluate(id=>window.avhubDesktop.nativePlayer('open',{mediaId:id,start:3}),id);
  assert.deepEqual(fingerprint(),before,'source bytes and mtime unchanged');
  const crashRecovery=await desktop.evaluate(()=>globalThis.__nativeCrashProbe??null);
  writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({firstFrameMs:state.firstFrameMs,lastSeekMs:state.lastSeekMs,restarts:state.restarts,overlayPixels,nativeDecoderWindow:decoderWindow,actualFrameEvidence,saved,screenshot:{width:screenshot.width,height:screenshot.height},crashRecovery,sourceUnchanged:true},null,2));
  console.log('Native MPV acceptance passed:',data);
}catch(error){
  console.error('Native acceptance failed:',error);
  if(desktop)writeFileSync(path.join(data,'crash-probe.json'),JSON.stringify(await desktop.evaluate(()=>globalThis.__nativeCrashProbe??{}),null,2));
  if(desktop){const main=desktop.windows().find(w=>!w.url().includes('nativePlayer='));if(main)writeFileSync(path.join(data,'native-state-on-failure.json'),JSON.stringify(await main.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot')).catch(e=>({error:String(e)})),null,2));}
  if(desktop)writeFileSync(path.join(data,'windows-on-failure.json'),JSON.stringify(await desktop.evaluate(({BaseWindow})=>({events:globalThis.__nativeWindowEvents,windows:BaseWindow.getAllWindows().map(w=>({title:w.getTitle(),url:w.webContents?.getURL(),bounds:w.getBounds(),fullscreen:w.isFullScreen(),fullscreenable:w.isFullScreenable(),visible:w.isVisible(),minimized:w.isMinimized()}))})),null,2));
  if(desktop){const windows=desktop.windows();writeFileSync(path.join(data,'failure.json'),JSON.stringify(await Promise.all(windows.map(async page=>({url:page.url(),body:await page.locator('body').innerText({timeout:3000}).catch(()=>'<unavailable>')}))),null,2));}
  if(desktop)await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});
  throw error;
}finally{if(desktop)await desktop.close().catch(()=>{});}
