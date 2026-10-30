// Real Electron engine lifecycle acceptance. Only application-owned synthetic
// SDR media; injected runtime/decoder faults are explicit, not hardware failures.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {candidateRuntime} from './native-candidate-input.mjs';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build','native-engine-')),media=path.join(data,'media');mkdirSync(media);
const candidate=candidateRuntime(root,process.env.AVHUB_TEST_MPV_CANDIDATE);
const source=path.join(media,'Engine.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','30','-c:v','libx264','-g','50','-pix_fmt','yuv420p',source],{windowsHide:true,timeout:30000}).status,0);
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash(),report={completed:false,modes:[],sourceUnchanged:false,cleanExit:false};let app;
report.runtime=candidate?{...candidate,executable:undefined,scope:'Test-only verified candidate override; installed runtime and packaged layout unchanged'}:{scope:'Installed development runtime'};
console.log('Native engine fixture:',data);
try{
 const env={...process.env,AVHUB_APP_HOME:data,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 app=await _electron.launch({args:[root],cwd:data,env,timeout:60000});const page=await app.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await app.evaluate((_,{root,candidate})=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json'),{MpvClient}=require(root+'/electron/dist/mpvClient.js'),{NativeRuntime}=require(root+'/electron/dist/nativeRuntime.js');
  const start=MpvClient.prototype.start,check=NativeRuntime.prototype.check;globalThis.starts=[];
  MpvClient.prototype.start=function(...args){if(candidate)args[0]=candidate.executable;globalThis.client=this;globalThis.starts.push(args[3]);return start.apply(this,args);};
  NativeRuntime.prototype.check=function(){return globalThis.blockRuntime?Promise.resolve({available:false,runtimeState:'invalid',reason:'验收注入：运行库校验失败',distributionReady:false}):check.apply(this);};
 },{root,candidate});
 const api=(route,method='GET',body)=>page.evaluate(async({route,method,body})=>{const r=await fetch(route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{route,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST',{});await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 const command=c=>app.evaluate(async(_,c)=>globalThis.client.command(c),c),snapshot=()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
 const runtime=await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'));assert.equal(runtime.available,true);assert.equal(runtime.runtimeState,'ready');assert.equal(runtime.distributionReady,false);
 await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'MPV 运行库已验证'})).toBeVisible();
 await page.getByLabel('默认播放引擎',{exact:true}).selectOption('mpv');await expect(page.getByLabel('MPV 播放窗口',{exact:true})).toHaveValue('independent');
 assert.equal((await api('/api/preferences')).values.mpvWindowMode,'independent');
 await page.getByRole('dialog',{name:'媒体库设置',exact:true}).screenshot({path:path.join(data,'native-settings.png')});
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 for(const mode of ['independent','embedded']){
  await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',mpvWindowMode:mode,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
  const count=await app.evaluate(()=>globalThis.starts.length);await app.evaluate(()=>{globalThis.blockRuntime=true;});
  await page.getByRole('button',{name:'播放 Engine',exact:true}).click();await expect(page.getByRole('alert')).toContainText('运行库校验失败');
  assert.equal(await app.evaluate(()=>globalThis.starts.length),count,'invalid runtime never starts a decoder');
  await app.evaluate(()=>{globalThis.blockRuntime=false;});await page.getByRole('button',{name:'重新播放',exact:true}).click();
  await expect(page.locator('.native-embedded-caption')).toContainText('MPV');await expect.poll(async()=>{try{const s=await snapshot();return s.phase==='ready'&&s.properties['time-pos']>.05;}catch{return false;}},{timeout:30000}).toBe(true);
  await command(['set_property','pause',true]);await command(['seek',8,'absolute+exact']);
  await expect.poll(async()=>{const s=await snapshot();return s.properties.seeking!==true&&Math.abs(Number(s.properties['time-pos'])-8)<.1;},{timeout:15000}).toBe(true);
  await app.evaluate(()=>globalThis.client.fail('验收注入：解码器故障'));
  await expect(page.getByRole('button',{name:'重试原生播放',exact:true})).toBeVisible();await page.getByRole('button',{name:'重试原生播放',exact:true}).click();
  await expect.poll(()=>app.evaluate(()=>globalThis.starts.length),{timeout:30000}).toBe(count+2);
  await expect.poll(async()=>{try{const s=await snapshot();return s.phase==='ready'&&Number(s.properties['time-pos'])>=7.9;}catch{return false;}},{timeout:30000}).toBe(true);
  const retried=await snapshot(),start=await app.evaluate(()=>globalThis.starts.at(-1));assert.ok(Math.abs(start-8)<.1,`retry start ${start}`);assert.equal(retried.properties['video-params'].w,640);
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.player-shell')).toHaveCount(0);
  assert.equal((await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active,false);
  assert.equal((await api('/api/preferences')).values.playerEngine,'mpv');report.modes.push({mode,runtimeGate:true,retryStart:start,decodedPosition:retried.properties['time-pos'],originalResolution:true,closed:true});
 }
 await app.close();app=null;report.cleanExit=true;report.sourceUnchanged=hash()===before;assert.equal(report.sourceUnchanged,true);report.completed=true;
 console.log('Native engine acceptance passed:',data);
}catch(error){report.error=String(error.stack??error);throw error;}
finally{writeFileSync(path.join(data,'acceptance.json'),JSON.stringify(report,null,2));if(app)await app.close().catch(()=>{});}
