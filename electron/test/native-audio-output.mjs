// Real Electron + real MPV audio-output probe. A missing endpoint is reported
// as an environment limitation, never a successful audio-playback acceptance.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','native-audio-output-')),media=path.join(data,'media');mkdirSync(media);
const source=path.join(media,'Audio output probe.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','30','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source],{windowsHide:true,timeout:30000}).status,0);
const identity=()=>({sha256:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs});
const before=identity(),results=[];let desktop;
console.log('Real audio-output fixture:',data);
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});
 await desktop.evaluate((_,root)=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json'),{MpvClient}=require(root+'/electron/dist/mpvClient.js'),{NativePlayer}=require(root+'/electron/dist/nativePlayer.js');
  const start=MpvClient.prototype.start,command=MpvClient.prototype.command;
  const invoke=NativePlayer.prototype.invoke;globalThis.__audioProbeIntents=[];
  NativePlayer.prototype.invoke=function(event,action,input){
   const record={action,at:performance.now()};globalThis.__audioProbeIntents.push(record);
   return invoke.call(this,event,action,input).then(result=>{record.done=true;return result;},error=>{record.error=String(error.message);throw error;});
  };
  globalThis.__audioProbeCommands=[];
  MpvClient.prototype.start=function(...args){globalThis.__audioProbe=this;globalThis.__audioProbeCommands.push({kind:'start',session:this.session,extra:args[4]});return start.apply(this,args);};
  MpvClient.prototype.command=function(value,...rest){
   if(['audio-device','audio-device-list','ao','aid'].includes(value[1])||value[0]==='observe_property'&&value[2]==='audio-device-list')globalThis.__audioProbeCommands.push({session:this.session,command:value});
   return command.call(this,value,...rest);
  };
 },root);
 const snapshot=()=>desktop.evaluate(()=>globalThis.__audioProbe?.snapshot??null);
 for(const mode of ['embedded','independent']){
  await api('/api/preferences','PATCH',{values:{mpvWindowMode:mode}});await page.reload();
  await page.evaluate(()=>{window.__probeClicks=[];document.addEventListener('click',event=>window.__probeClicks.push(event.target?.closest('button')?.textContent),true);});
  await page.getByRole('button',{name:'播放 Audio output probe',exact:true}).click();
  await expect.poll(async()=>(await snapshot())?.phase,{timeout:15000}).toMatch(/^(ready|error)$/);
  let s=await snapshot();
  if(s.phase==='error'){
   assert.equal(s.failureCode,'audio-output');
   await expect.poll(async()=>(await snapshot()).audioOutput?.state,{timeout:5000}).toMatch(/^(available|unavailable)$/);
   s=await snapshot();assert.equal(s.readyMs,null);assert.equal(s.sourceLoads,1);
   await expect(page.getByRole('alert')).toContainText(s.audioOutput.state==='unavailable'?'当前会话未检测到可用的声音输出设备':'已检测到声音输出设备');
   const retry=page.getByRole('button',{name:/^(重新播放|重试原生播放)$/});await retry.click();
   await expect.poll(async()=>(await snapshot()).session,{timeout:15000}).not.toBe(s.session);
   await expect.poll(async()=>(await snapshot()).phase,{timeout:15000}).toMatch(/^(ready|error)$/);
   const retried=await snapshot();assert.equal(retried.sourceLoads,1);
   if(retried.phase==='error'){
    // Decoder events precede the renderer attaching the new session. Wait for
    // the actual user-visible outcome, not just the first internal error.
    await expect(page.getByRole('alert')).toContainText('音频输出设备初始化失败');
    await expect(page.getByRole('button',{name:/^(重新播放|重试原生播放)$/})).toBeVisible();
   }
   results.push({mode,classification:'audio-output-failure',availability:s.audioOutput,explicitRetryNewSession:retried.session!==s.session,retryPhase:retried.phase,physicalAudioAccepted:false});
  }else{
   assert.ok(s.readyMs>=s.firstFrameMs);assert.ok(s.properties['current-ao']&&s.properties['current-ao']!=='null');
   assert.ok(s.properties['track-list'].some(t=>t.type==='audio'&&t.selected));
   const clock=Number(s.properties['time-pos']);await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:10000}).toBeGreaterThan(clock+.3);
   results.push({mode,classification:'selected-output-running',output:s.properties['current-ao'],readyMs:s.readyMs,clockContinues:true,physicalAudioAccepted:false});
  }
  assert.equal(await page.locator('video').count(),0,'never fall back to Chromium');
  await page.bringToFront();await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
 }
 const commands=await desktop.evaluate(()=>globalThis.__audioProbeCommands);
 assert.equal(commands.some(c=>c.command?.[0]==='set_property'&&['audio-device','ao','aid'].includes(c.command[1])),false,'no system-device selection or disabled track');
 for(const c of commands.filter(c=>c.kind==='start'))assert.equal(c.extra.some(v=>/^--(?:ao|audio-device|audio)=/.test(v)||v==='--aid=no'),false);
 assert.deepEqual(identity(),before);await desktop.close();desktop=null;
 writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({scope:'real Electron UI and actual MPV, synthetic H264/AAC media with selected audio; muted user preference, NOT disabled/null output; no fault injection, no system changes, not a hearing/fidelity test',results,sourceUnchanged:true,cleanExit:true},null,2));
 console.log('Audio-output probe completed (see per-mode limitations):',data);
}catch(error){
 if(desktop){
  writeFileSync(path.join(data,'failure.json'),JSON.stringify({error:String(error),state:await desktop.evaluate(()=>globalThis.__audioProbe?.snapshot).catch(()=>null),intents:await desktop.evaluate(()=>globalThis.__audioProbeIntents).catch(()=>null),results,windows:await Promise.all(desktop.windows().map(async p=>({url:p.url(),body:await p.locator('body').innerText().catch(()=>'<closed>'),clicks:await p.evaluate(()=>window.__probeClicks).catch(()=>null)})))},null,2));await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});
 }throw error;
}finally{if(desktop)await desktop.close().catch(()=>{});}
