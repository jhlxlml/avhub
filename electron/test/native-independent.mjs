// Real Electron library + owned MPV window; native input.conf is exercised by
// MPV keypress injection. This is not physical OS keyboard/mouse acceptance.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,statSync,writeFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','native-independent-')),media=path.join(data,'media'),captures=path.join(data,'screenshots');mkdirSync(media);mkdirSync(captures);
const sources=['A.mp4','B.mp4'].map(name=>path.join(media,name));
for(const source of sources)assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','24','-c:v','libx264','-g','50','-pix_fmt','yuv420p',source],{windowsHide:true,timeout:30000}).status,0);
const identity=()=>sources.map(file=>({hash:createHash('sha256').update(readFileSync(file)).digest('hex'),mtime:statSync(file).mtimeMs})),before=identity();let desktop;
console.log('Independent fixture:',data);
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 // Test-only main-process observation, never a production renderer command API.
 await desktop.evaluate((_,root)=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json');
  const {MpvClient}=require(root+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start;
  MpvClient.prototype.start=function(...args){globalThis.__independentTestClient=this;return start.apply(this,args);};
  const {IndependentPlayer}=require(root+'/electron/dist/independentPlayer.js'),open=IndependentPlayer.prototype.open;
  globalThis.__independentActivities=[];globalThis.__independentReleases=[];
  IndependentPlayer.prototype.open=function(...args){
   if(!this.__testWrapped){this.__testWrapped=true;const api=this.deps.api;this.deps.api=async(route,method,body)=>{
    if(route==='/api/playback/activity')globalThis.__independentActivities.push({present:body.present,playing:body.playing,preparing:body.preparing,paused:this.active?.client.snapshot.properties.pause===true});
    if(route.startsWith('/api/native-read/')&&method==='DELETE'){const child=this.active?.client.child;globalThis.__independentReleases.push({stopped:this.active?.stopped,exited:Boolean(child&&(child.exitCode!==null||child.signalCode!==null))});}
    if(globalThis.__independentSaveFault&&route.endsWith('/progress'))throw new Error('test progress store unavailable');
    return api(route,method,body);
   };}
   return open.apply(this,args);
  };
 },root);
 const command=c=>desktop.evaluate(async(_,c)=>globalThis.__independentTestClient.command(c),c);
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 assert.equal(await page.evaluate(async()=>(await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{mpvWindowMode:'bad'}})})).status),422);
 await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 await page.getByLabel('默认播放引擎',{exact:true}).selectOption('mpv');
 await page.getByLabel('MPV 播放窗口',{exact:true}).selectOption('independent');
 await expect.poll(async()=>(await api('/api/preferences')).values.mpvWindowMode).toBe('independent');
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',mpvWindowMode:'independent',resumeBehavior:'restart',autoNext:true,queueScope:'directory',queueMode:'sequential',audio:{volume:0,muted:true},screenshots:{directory:captures,shortcut:'C'}}});
 await page.reload();const started=performance.now();await page.getByRole('button',{name:'播放 A',exact:true}).click();
 await expect(page.getByText('MPV · 独立窗口播放原文件',{exact:true})).toBeVisible({timeout:30000});
 const snapshot=()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
 await expect.poll(async()=>{const s=await snapshot();return s.phase==='ready'&&Number(s.properties['time-pos'])>.05;},{timeout:30000}).toBe(true);
 const first=await snapshot(),openToDecodedMs=performance.now()-started;
 assert.equal(first.presentation,'independent');assert.equal(first.properties['video-params'].w,640);
 assert.ok((await page.getByLabel('MPV 原生播放区域',{exact:true}).boundingBox()).height<400,'compact independent status, no unused video canvas');
 assert.equal(await desktop.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().length),1,'no Electron host or controls overlay');
 assert.equal(await command(['get_property','osc']),false);
 assert.equal(await command(['get_property','user-data/avhub-ui/version']),1);
 assert.equal(await command(['get_property','border']),false);
 assert.equal(await command(['get_property','input-default-bindings']),false);
 assert.equal(await command(['get_property','drag-and-drop']),false);
 await command(['keypress','SPACE']);await expect.poll(async()=>(await snapshot()).properties.pause).toBe(true);
 const at=Number((await snapshot()).properties['time-pos']),restart=(await snapshot()).restarts,seekStarted=performance.now();
 await command(['keypress','RIGHT']);
 await expect.poll(async()=>{const s=await snapshot();return s.restarts>restart&&Math.abs(Number(s.properties['time-pos'])-at-5)<.3;},{timeout:15000,intervals:[20]}).toBe(true);
 const relativeSeekMs=performance.now()-seekStarted;
 await expect.poll(async()=>(await snapshot()).pendingSeek).toBe(null);
 const tracked=await snapshot();assert.equal(tracked.seeks,first.seeks+1);assert.equal(tracked.seekMode,null);assert.ok(tracked.lastSeekMs!==null);assert.ok(Math.abs(tracked.lastSeekTarget-at-5)<.03);assert.ok(Math.abs(tracked.lastSeekPosition-tracked.lastSeekTarget)<.3);
 assert.equal(await desktop.evaluate(()=>globalThis.__independentActivities.some(v=>v.preparing&&v.playing&&v.paused)),true,'paused native seek receives bounded background-read priority');
 await command(['keypress','LEFT']);await expect.poll(async()=>Math.abs(Number((await snapshot()).properties['time-pos'])-at),{timeout:15000}).toBeLessThan(.3);
 await expect.poll(async()=>(await snapshot()).seekMode).toBe(null);
 const rapidAt=Number((await snapshot()).properties['time-pos']);
 await command(['keypress','RIGHT']);await command(['keypress','RIGHT']);
 await expect.poll(async()=>{const s=await snapshot();return s.seekMode===null&&Math.abs(Number(s.properties['time-pos'])-rapidAt-10)<.3;},{timeout:15000}).toBe(true);
 await command(['keypress','LEFT']);await command(['keypress','LEFT']);
 await expect.poll(async()=>{const s=await snapshot();return s.seekMode===null&&Math.abs(Number(s.properties['time-pos'])-at)<.3;},{timeout:15000}).toBe(true);
 // Exercise the production Lua hit-testing via native MPV mouse events, not
 // arbitrary renderer actions. Physical pointer acceptance is separate.
 const layout=()=>command(['get_property','user-data/avhub-ui/layout']);
 const point=async(id,fraction=.5)=>{const ui=await layout(),b=ui.buttons.find(b=>b.id===id);assert.ok(b,id);return {x:Math.round((b.x+b.w*fraction)*ui.scale),y:Math.round((b.y+b.h/2)*ui.scale)};};
 const move=async id=>{const p=await point(id);await command(['mouse',p.x,p.y]);await expect.poll(async()=>(await layout()).visible).toBe(true);return p;};
 const click=async id=>{const p=await move(id);await command(['mouse',p.x,p.y,0,'single']);};
 await click('pin');await expect.poll(()=>command(['get_property','ontop'])).toBe(true);await click('pin');await expect.poll(()=>command(['get_property','ontop'])).toBe(false);
 await click('settings');await expect.poll(async()=>(await layout()).panel).toBe(true);
 await click('speed');await expect.poll(async()=>(await snapshot()).properties.speed).toBe(1.25);
 await click('delay-up');await expect.poll(async()=>(await snapshot()).properties['sub-delay']).toBe(.25);
 await click('delay-down');await expect.poll(async()=>(await snapshot()).properties['sub-delay']).toBe(0);
 await command(['keypress','ESC']);await expect.poll(async()=>(await layout()).panel).toBe(false);await command(['set_property','speed',1]);
 // Scrubbing previews until release, then commits exactly one decoded seek.
 let p=await move('timeline');const prior=await snapshot();await command(['keydown','MBTN_LEFT']);
 p=await point('timeline',.5);await command(['mouse',p.x,p.y]);await expect.poll(async()=>(await layout()).dragging).toBe('timeline');
 assert.equal((await snapshot()).restarts,prior.restarts);await command(['keyup','MBTN_LEFT']);
 await expect.poll(async()=>{const s=await snapshot();return s.restarts>prior.restarts&&Math.abs(Number(s.properties['time-pos'])-12)<.3;},{timeout:10000}).toBe(true);
 assert.equal((await snapshot()).restarts,prior.restarts+1);
 const normalDims=await command(['get_property','osd-dimensions']);
 await click('fullscreen');await expect.poll(()=>command(['get_property','fullscreen'])).toBe(true);await command(['keypress','ESC']);await expect.poll(()=>command(['get_property','fullscreen'])).toBe(false);
 await expect.poll(async()=>{const d=await command(['get_property','osd-dimensions']),u=await layout();return [d.w,d.h,Math.round(u.width*u.scale),Math.round(u.height*u.scale)];}).toEqual([normalDims.w,normalDims.h,normalDims.w,normalDims.h]);
 // Hover stays visible even paused; leaving controls hides without a key
 // press revealing it again. No permanent background UI frame timer.
 await move('play');await new Promise(r=>setTimeout(r,650));assert.equal((await layout()).visible,true);
 const dims=await command(['get_property','osd-dimensions']);await command(['mouse',Math.round(dims.w/2),Math.round(dims.h/2)]);
 await expect.poll(async()=>(await layout()).visible).toBe(false);
 await command(['keypress','RIGHT']);await expect.poll(async()=>{const s=await snapshot();return s.seekMode===null&&s.pendingSeek===null&&s.properties.seeking!==true&&Number(s.properties['time-pos'])>16.5;},{timeout:10000}).toBe(true);
 assert.equal((await layout()).visible,false);
 // Native screenshot binding must publish to the configured application folder.
 await command(['keypress','c']);await expect.poll(()=>readdirSync(captures).filter(v=>v.endsWith('.png')).length,{timeout:15000}).toBe(1);
 const screenshot=readFileSync(path.join(captures,readdirSync(captures)[0]));assert.equal(screenshot.readUInt32BE(16),640);assert.equal(screenshot.readUInt32BE(20),360);
 await expect.poll(async()=>(await layout()).toast,{timeout:5000}).toBe(false);
 await command(['keypress','f']);await expect.poll(()=>command(['get_property','fullscreen'])).toBe(true);await command(['keypress','ESC']);await expect.poll(()=>command(['get_property','fullscreen'])).toBe(false);
 await page.getByRole('button',{name:'恢复播放窗口',exact:true}).click();
 await assert.rejects(()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('command',{session:'x',value:['run','cmd']})));
 // Changes to preferences never redirect an active session into another mode.
 await api('/api/preferences','PATCH',{values:{mpvWindowMode:'embedded'}});assert.equal((await snapshot()).presentation,'independent');
 await api('/api/preferences','PATCH',{values:{mpvWindowMode:'independent'}});
 await page.evaluate(session=>window.avhubDesktop.nativePlayer('flush',session),first.session);
 assert.ok((await api(`/api/media/${first.mediaId}`)).progress>0);
 await command(['keypress','SPACE']);await expect.poll(async()=>(await snapshot()).properties.pause).toBe(false);
 const playing=Number((await snapshot()).properties['time-pos']);await command(['keypress','RIGHT']);
 await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:15000}).toBeGreaterThan(playing+5.3);
 // Real native near-end seek followed by natural completion in < 1 second.
 // It must not be swallowed by a blanket recent-seek EOF suppression window.
 await command(['script-message-to','avhub_ui','seek-relative',String(23.3-Number((await snapshot()).properties['time-pos']))]);
 await expect(page.locator('.player-top')).toContainText('B',{timeout:20000});
 await expect(page.getByText('MPV · 独立窗口播放原文件',{exact:true})).toBeVisible({timeout:20000});
 await expect.poll(async()=>{const s=await snapshot();return s.phase==='ready'&&s.sourceLoads===1&&Number(s.properties['time-pos'])>.05;},{timeout:20000}).toBe(true);
 const second=await snapshot();assert.notEqual(second.session,first.session);assert.equal(second.sourceLoads,1);
 await desktop.evaluate(()=>{globalThis.__independentSaveFault=true;});
 await command(['keypress','q']);
 await expect(page.getByRole('heading',{name:'播放窗口已关闭',exact:true})).toBeVisible({timeout:15000});
 await expect(page.getByRole('button',{name:'重试保存并关闭',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'恢复播放窗口',exact:true})).toHaveCount(0);
 assert.equal((await snapshot()).stopped,true);assert.equal((await snapshot()).recovery,'save');
 assert.equal(await desktop.evaluate(()=>globalThis.__independentReleases.length>0&&globalThis.__independentReleases.every(v=>v.stopped&&v.exited)),true,'never release a live decoder fence; phase alone is not OS exit evidence');
 await desktop.evaluate(()=>{globalThis.__independentSaveFault=false;});
 await page.getByRole('button',{name:'重试保存并关闭',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'原生播放已关闭'})).toBeVisible({timeout:15000});
 await expect(page.getByRole('alert')).toHaveCount(0);
 assert.equal((await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active,false);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 assert.equal(readdirSync(path.join(data,'native-inputs')).length,0);assert.deepEqual(identity(),before);
 await page.getByRole('button',{name:'播放 A',exact:true}).click();await expect(page.getByText('MPV · 独立窗口播放原文件',{exact:true})).toBeVisible({timeout:30000});
 await expect.poll(async()=>{const s=await snapshot();return s.phase==='ready'&&Number(s.properties['time-pos'])>.05;},{timeout:15000}).toBe(true);
 await desktop.evaluate(()=>{globalThis.__independentSaveFault=true;});await command(['keypress','q']);
 await page.getByRole('button',{name:'放弃未保存进度',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'放弃未保存的播放记录？',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await snapshot()).recovery,'save');
 await page.getByRole('button',{name:'放弃未保存进度',exact:true}).click();
 await page.getByRole('button',{name:'放弃并关闭',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'原生播放已关闭'})).toBeVisible({timeout:15000});
 await desktop.evaluate(()=>{globalThis.__independentSaveFault=false;});
 await page.getByRole('button',{name:'重新播放',exact:true}).click();
 await expect(page.getByText('MPV · 独立窗口播放原文件',{exact:true})).toBeVisible({timeout:30000});
 await desktop.close();desktop=null;assert.equal(readdirSync(path.join(data,'native-inputs')).length,0);assert.deepEqual(identity(),before);
 writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({scope:'real Electron library; native keypress/mouse command injection; synthetic 640x360 H264; injected progress-write fault; not physical input or compositor validation',openToDecodedMs,relativeSeekMs,nativeSeek:{target:tracked.lastSeekTarget,position:tracked.lastSeekPosition,completionMs:tracked.lastSeekMs,pausedIoPriority:true},nativeUi:{pin:true,settings:true,speed:true,delay:true,fullscreen:true,scrubOneCommit:true,hoverAndKeyboardHiding:true},noElectronVideoWindows:true,sourceLoads:1,originalResolution:true,configuredScreenshot:true,naturalAutoplayAfterNearEndSeek:true,closedSaveFailureRecovery:true,confirmedDiscard:true,nativeQuitCleanup:true,applicationQuitCleanup:true,sourceUnchanged:true},null,2));
 console.log('Independent application flow passed:',data);
}catch(error){if(desktop){writeFileSync(path.join(data,'failure.json'),JSON.stringify({error:String(error),snapshot:await desktop.evaluate(()=>globalThis.__independentTestClient?.snapshot).catch(()=>null),windows:await Promise.all(desktop.windows().map(async p=>({url:p.url(),body:await p.locator('body').innerText().catch(()=>'<closed>')})))},null,2));await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});}throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});}
