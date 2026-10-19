// Actual Electron/MPV lifecycle; deterministic AO-error event injection.
// Synthetic video-only sample avoids requiring CI to have a sound device.
// This proves classification and retry, NOT physical WASAPI/audio fidelity.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','native-audio-recovery-')),media=path.join(data,'media');mkdirSync(media);
const source=path.join(media,'Recovery.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','30','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true,timeout:30000}).status,0);
const identity=()=>({hash:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs});const before=identity();let desktop;
console.log('Audio recovery fixture:',data);
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});
 await desktop.evaluate((_,root)=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json');const {MpvClient}=require(root+'/electron/dist/mpvClient.js');
  const originalStart=MpvClient.prototype.start,originalMessage=MpvClient.prototype.message;
  globalThis.__audioSessions=[];
  MpvClient.prototype.start=function(...args){globalThis.__audioClient=this;globalThis.__audioSessions.push({session:this.session,extras:args[4]});return originalStart.apply(this,args);};
  MpvClient.prototype.message=function(value){
   const result=originalMessage.call(this,value);
   if(globalThis.__audioFailOnLoad&&value.event==='file-loaded'){
    globalThis.__audioFailOnLoad=false;originalMessage.call(this,{event:'end-file',reason:'error',file_error:'audio output initialization failed'});
   }
   return result;
  };
 },root);
 const snapshot=()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
 const results=[];
 for(const mode of ['embedded','independent']){
  await api('/api/preferences','PATCH',{values:{mpvWindowMode:mode}});await page.reload();
  await desktop.evaluate(()=>{globalThis.__audioFailOnLoad=true;});
  await page.getByRole('button',{name:'播放 Recovery',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('音频输出设备初始化失败',{timeout:15000});
  await expect(page.getByRole('alert')).not.toContainText('Error invoking');
  const failed=await desktop.evaluate(()=>globalThis.__audioClient.snapshot);
  assert.equal(failed.failureCode,'audio-output');assert.equal(failed.firstFrameMs,null);assert.equal(failed.readyMs,null);
  await page.getByRole('button',{name:'重新播放',exact:true}).click();
  const caption=mode==='independent'?'MPV · 独立窗口播放原文件':'MPV · 原文件直接播放';
  await expect(page.getByText(caption,{exact:true})).toBeVisible({timeout:30000});
  await expect.poll(async()=>{const s=await snapshot();return s.phase==='ready'&&Number(s.properties['time-pos'])>.1;},{timeout:30000}).toBe(true);
  const reopened=await snapshot();assert.notEqual(reopened.session,failed.session);assert.equal(reopened.sourceLoads,1);assert.ok(reopened.readyMs>=reopened.firstFrameMs);
  // Also fail an attached surface: retry must stop its actual owned process,
  // not merely clear a renderer error or reuse its old decoded frame.
  await desktop.evaluate(()=>globalThis.__audioClient.message({event:'end-file',reason:'error',file_error:'audio output initialization failed'}));
  await expect(page.getByRole('button',{name:'重试原生播放',exact:true})).toBeVisible({timeout:10000});
  if(mode==='embedded'){
   const overlay=desktop.windows().find(p=>p.url().includes('nativePlayer='));assert.ok(overlay);
   await overlay.getByRole('button',{name:'重试原生播放',exact:true}).click();
  }else await page.getByRole('button',{name:'重试原生播放',exact:true}).click();
  await expect(page.getByText(caption,{exact:true})).toBeVisible({timeout:30000});
  await expect.poll(async()=>{const s=await snapshot();return s.phase==='ready'&&s.session!==reopened.session&&Number(s.properties['time-pos'])>.1;},{timeout:30000}).toBe(true);
  const current=await snapshot();assert.equal(current.sourceLoads,1);assert.equal(current.properties['video-params'].w,640);
  assert.equal(await page.locator('video').count(),0,'no automatic Chromium fallback');
  assert.equal(await desktop.evaluate(()=>globalThis.__audioSessions.every(s=>!s.extras.some(v=>/^--(?:ao|audio-device|audio)=/.test(v)||v==='--aid=no'))),true,'production retries do not force null audio or an alternate output');
  const clock=Number(current.properties['time-pos']);await expect.poll(async()=>Number((await snapshot()).properties['time-pos'])).toBeGreaterThan(clock+.2);
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
  assert.equal((await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active,false);
  results.push({mode,classifiedAudioFailure:true,noFalseFirstFrame:true,explicitInitialRetry:true,explicitAttachedRetry:true,sourceLoads:1,clockContinues:true,noSilentAudioFallback:true});
 }
 assert.deepEqual(identity(),before);await desktop.close();desktop=null;
 writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({scope:'real Electron UI + actual MPV processes; deterministic structured AO event injection on synthetic video-only media, not physical audio-device recovery',results,sourceUnchanged:true,cleanExit:true},null,2));
 console.log('Audio failure UI recovery passed:',data);
}catch(error){if(desktop){writeFileSync(path.join(data,'failure.json'),JSON.stringify({error:String(error),state:await desktop.evaluate(()=>globalThis.__audioClient?.snapshot).catch(()=>null),windows:await Promise.all(desktop.windows().map(async p=>({url:p.url(),body:await p.locator('body').innerText().catch(()=>'<closed>')})))},null,2));await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});}throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});}
