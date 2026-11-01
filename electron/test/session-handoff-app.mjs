// Real source Electron UI, actual native owners and original-file Chromium.
// Owned framecoded H264 only; not HDR/audio/physical color certification.
import {_electron,expect} from '@playwright/test';import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';import path from 'node:path';import {desktopTestSubject} from './desktop-test-subject.mjs';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/session-handoff-app-')),media=path.join(data,'media');mkdirSync(media);
mkdirSync(path.join(data,'screenshots'));
const file=path.join(media,'Framecode.mp4');copyFileSync(path.join(root,'build/libmpv-render-spike/samples/Framecode-v2-640x360.mp4'),file);
const nextFile=path.join(media,'Next.mp4');copyFileSync(file,nextFile);
const identity=()=>({sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),mtime:statSync(file).mtimeMs}),before=identity();
const coordinated=process.env.AVHUB_TEST_SESSION_COORDINATOR!=='0',report={kind:'actual-source-electron-session-handoff',coordinated,before,rows:[],passed:false};let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_APP_HOME:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0',AVHUB_RENDER_RUNTIME_CANDIDATE:'render-replayed-candidate-7wRYRz'},timeout:60000});
 report.subject=await desktopTestSubject(desktop,import.meta.url);page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app})=>{const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{MpvClient}=require(app.getAppPath()+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start;globalThis.__handoffClients=[];MpvClient.prototype.start=function(...args){const row={autoplay:args[8]??true,unpauseCommands:0,client:this};globalThis.__handoffClients.push(row);const command=this.command;this.command=function(input,...rest){if(input[0]==='set_property'&&input[1]==='pause'&&input[2]===false)row.unpauseCommands++;return command.call(this,input,...rest);};return start.apply(this,args);};});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state).toBe('completed');
 const front=()=>desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();});
 const chromeCode=()=>page.locator('.player-shell video').evaluate(v=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const ctx=c.getContext('2d');ctx.drawImage(v,0,0);const bytes=ctx.getImageData(0,32,c.width,1).data;let frame=0;for(let bit=0;bit<16;bit++)if(bytes[Math.floor((bit+.5)*c.width/16)*4]>180)frame+=2**bit;return frame;});
 const pngCode=bytes=>desktop.evaluate(({nativeImage},b64)=>{const image=nativeImage.createFromBuffer(Buffer.from(b64,'base64')),size=image.getSize(),data=image.toBitmap();let frame=0;for(let bit=0;bit<16;bit++)if(data[(32*size.width+Math.floor((bit+.5)*size.width/16))*4+2]>180)frame+=2**bit;return frame;},bytes.toString('base64'));
 const marker=locator=>locator.evaluate(el=>({root:el.dataset.playbackSessionRoot,generation:Number(el.dataset.playbackSessionGeneration),kind:el.dataset.playbackSessionKind}));
 for(const [turn,render]of [false,true,false,true].entries()){
  await api('/api/preferences','PATCH',{values:{playerEngine:'chromium',mpvWindowMode:'independent',nativeRenderEnabled:render,playbackSessionCoordinatorEnabled:coordinated,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
  await page.evaluate(()=>window.avhubDesktop.onRenderState(state=>window.__handoffRender=state));
  await page.getByRole('button',{name:'播放 Framecode',exact:true}).click();await expect.poll(()=>page.locator('.player-shell video').evaluate(v=>v.readyState),{timeout:20000}).toBeGreaterThanOrEqual(2);
  if(coordinated)await expect(page.locator('.player-shell')).toHaveAttribute('data-playback-session-phase','ready',{timeout:20000});
  const chromeOwner=coordinated?await marker(page.locator('.player-shell')):null;
  const frame=[52,104,31,109][turn],position=frame/25;
  await page.locator('.player-shell video').evaluate((v,position)=>{v.pause();v.currentTime=position;},position);await expect.poll(chromeCode).toBe(frame);
  await page.locator('details.playback-diagnostics > summary').click();await page.getByRole('button',{name:'使用 MPV 原画播放',exact:true}).click();
  const region=page.getByLabel('MPV 原生播放区域',{exact:true});await region.scrollIntoViewIfNeeded();
  if(coordinated){await expect(region).toHaveAttribute('data-playback-session-phase','ready',{timeout:30000});await expect(region).toHaveAttribute('data-playback-session-kind',render?'libmpv-d3d11':'mpv-independent');}
  else await expect(region).not.toHaveAttribute('data-playback-session-phase',/./);
  const snapshot=()=>page.evaluate(render=>render?window.avhubDesktop.renderPlayer('snapshot',{session:window.__handoffRender.session,generation:window.__handoffRender.generation}):window.avhubDesktop.nativePlayer('snapshot'),render);
  if(render)await expect.poll(()=>page.locator('.native-render-canvas').getAttribute('data-native-frame'),{timeout:30000}).not.toBeNull();
  else {
   await expect(page.getByText('MPV · 独立窗口播放原文件',{exact:true})).toBeVisible({timeout:30000});
   await expect.poll(async()=>(await snapshot()).phase,{timeout:30000}).toBe('ready');
  }
  const initial=await snapshot();assert.equal(initial.properties.pause,true);assert.ok(Math.abs((render?initial.positionSec:initial.properties['time-pos'])-position)<.1);assert.equal(initial.sourceLoads,1);
  const nativeOwner=coordinated?await marker(region):null;
  if(coordinated){assert.ok(chromeOwner.root);assert.equal(nativeOwner.root,chromeOwner.root);assert.ok(nativeOwner.generation>chromeOwner.generation);}
  await page.waitForTimeout(550);const stable=await snapshot();assert.equal(stable.properties.pause,true);assert.ok(Math.abs((render?stable.positionSec:stable.properties['time-pos'])-position)<.1);
  if(!render){const commands=await desktop.evaluate(()=>globalThis.__handoffClients.map(row=>({autoplay:row.autoplay,unpauseCommands:row.unpauseCommands})));assert.equal(commands.at(-1).autoplay,false);assert.equal(commands.at(-1).unpauseCommands,0);}
  const captures=path.join(data,'screenshots'),previous=new Set(readdirSync(captures,{withFileTypes:false}).filter(name=>name.endsWith('.png')));
  await front();
  if(render){const button=page.getByRole('button',{name:'截图（C）',exact:true});await button.scrollIntoViewIfNeeded();await button.hover({force:true});await button.click();}
  else await page.getByRole('button',{name:'保存截图',exact:true}).click();
  await expect.poll(()=>readdirSync(captures).filter(name=>name.endsWith('.png')&&!previous.has(name)).length,{timeout:15000}).toBe(1);
  const captured=readdirSync(captures).find(name=>name.endsWith('.png')&&!previous.has(name));assert.equal(await pngCode(readFileSync(path.join(captures,captured))),frame);
  await page.getByRole('button',{name:'切换现有播放器',exact:true}).click();await expect.poll(chromeCode,{timeout:20000}).toBe(frame);
  if(coordinated)await expect(page.locator('.player-shell')).toHaveAttribute('data-playback-session-phase','ready');
  const returnedOwner=coordinated?await marker(page.locator('.player-shell')):null;
  if(coordinated){assert.equal(returnedOwner.root,chromeOwner.root);assert.ok(returnedOwner.generation>nativeOwner.generation);}
  const back=await page.locator('.player-shell video').evaluate(v=>({paused:v.paused,position:v.currentTime,source:new URL(v.currentSrc).pathname}));assert.equal(back.paused,true);assert.ok(Math.abs(back.position-position)<.1);assert.match(back.source,/\/media\/\d+\/file$/);
  assert.equal((await api('/api/preferences')).values.playerEngine,'chromium');assert.equal((await page.evaluate(render=>window.avhubDesktop[render?'renderPlayer':'nativePlayer']('status'),render)).active,false);
  report.rows.push({turn,render,frame,nativePosition:render?stable.positionSec:stable.properties['time-pos'],nativePaused:stable.properties.pause,screenshot:captured,returned:back,lineage:{chromeOwner,nativeOwner,returnedOwner}});
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await expect(page.getByRole('button',{name:'播放 Framecode',exact:true})).toBeVisible({timeout:20000});
  await expect.poll(()=>new URL(page.url()).searchParams.get('video')).toBe(null);
  if(coordinated){
   // Different media IDs remount Player while App (and the real root) survives.
   await page.getByRole('button',{name:'播放 Next',exact:true}).click();await expect(page.locator('.player-shell')).toHaveAttribute('data-playback-session-phase','ready');
   const nextOwner=await marker(page.locator('.player-shell'));assert.equal(nextOwner.root,returnedOwner.root);assert.ok(nextOwner.generation>returnedOwner.generation);report.rows.at(-1).nextOwner=nextOwner;
   await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.getByRole('button',{name:'播放 Framecode',exact:true})).toBeVisible();
  }
 }
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',mpvWindowMode:'independent',nativeRenderEnabled:false,playbackSessionCoordinatorEnabled:coordinated}});await page.reload();
 await page.getByRole('button',{name:'播放 Framecode',exact:true}).click();await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await expect(page.getByRole('button',{name:'播放 Framecode',exact:true})).toBeVisible({timeout:20000});
 assert.equal((await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active,false);report.openThenBackClosed=true;
 assert.deepEqual(identity(),before);report.after=identity();report.passed=true;
}catch(error){report.error=String(error.stack??error);if(page){report.body=await page.locator('body').innerText().catch(()=>'<closed>');await page.screenshot({path:path.join(data,'failure.png')}).catch(()=>{});}process.exitCode=1;}
finally{if(desktop)await desktop.close();writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(data,'report.json'),error:report.error}));}
