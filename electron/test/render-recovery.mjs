// Actual Electron recovery with explicitly controlled process/transport/save
// faults. Not performance evidence and not a real-driver failure claim.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,statSync,createReadStream,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {playbackFixture} from './playback-fixtures.mjs';
const root=path.resolve(import.meta.dirname,'../..'),directory=mkdtempSync(path.join(root,'build/render-recovery-'));
const source=playbackFixture('hevc4k'),title=path.parse(source).name;
assert.ok(path.resolve(source).startsWith(path.join(root,'build')+path.sep),'Only owned generated footage');
const identity=async()=>{const info=statSync(source),hash=createHash('sha256');for await(const part of createReadStream(source))hash.update(part);return {size:info.size,mtime:info.mtimeMs,sha256:hash.digest('hex')};};
const before=await identity(),report={kind:'real-Electron-controlled-native-recovery',build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),faults:[],performanceEvidence:false,passed:false};let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:directory,env:{...process.env,AVHUB_DATA_DIR:directory,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js'),open=RenderHostClient.prototype.open;RenderHostClient.prototype.open=async function(...args){const result=await open.apply(this,args);globalThis.__recoveryClient=this;return result;};});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error(await response.text());return response.json();},{url,method,body});
 await api('/api/roots','POST',{path:path.dirname(source)});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await api('/api/thumbnails/pause','POST');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,mpvSeekPolicy:'exact',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__recovery=s));
 await page.getByRole('button',{name:'播放 '+title,exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__recovery?.phase),{timeout:30000}).toBe('ready');
 for(const kind of ['owned-host-exit','dropped-seek-ack']){
  const previous=await page.evaluate(()=>({session:window.__recovery.session,generation:window.__recovery.generation}));
  if(kind==='dropped-seek-ack')await desktop.evaluate(()=>{const c=globalThis.__recoveryClient,control=c.control,accept=c.accept;let dropId=null,bytes=Buffer.alloc(0);c.control=function(action,...args){if(action==='seek'&&dropId===null)dropId=this.sequence+1;return control.call(this,action,...args);};c.accept=function(chunk){bytes=Buffer.concat([bytes,chunk]);let end;while((end=bytes.indexOf(10))>=0){const line=bytes.subarray(0,end+1);bytes=bytes.subarray(end+1);if(JSON.parse(line.toString('utf8')).id!==dropId)accept.call(this,line);}};});
  await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate(slider=>{slider.value='573.4';slider.dispatchEvent(new Event('input',{bubbles:true}));});
  if(kind==='owned-host-exit')assert.equal(await desktop.evaluate(()=>globalThis.__recoveryClient.child.kill()),true);
  await expect.poll(()=>page.evaluate(()=>window.__recovery.phase),{timeout:20000}).toBe('error');
  const failed=await page.evaluate(()=>window.__recovery);assert.ok(failed.error);const cause=await desktop.evaluate(()=>globalThis.__recoveryClient.failure?.message??null);if(kind==='dropped-seek-ack'){assert.match(cause,/原生控制超时：seek/);assert.match(failed.error.message,/跳播命令响应超时/);}
  const row={kind,previous,cause,failedPhase:failed.phase,error:failed.error};report.faults.push(row);
  await page.locator('.native-embedded-caption').getByRole('button',{name:'重试原生播放',exact:true}).click();await expect.poll(()=>page.evaluate(previous=>window.__recovery.session!==previous&&window.__recovery.phase==='ready',previous.session),{timeout:30000}).toBe(true);
  const recovered=await page.evaluate(()=>window.__recovery);assert.ok(recovered.generation>previous.generation);assert.equal(recovered.sourceLoads,1);assert.equal(recovered.pendingSeek,null);assert.ok(recovered.presented.serial>0);row.recovered=true;
 }
 // A failed durable progress save must keep native/source ownership until an
 // explicit second close succeeds. The fault is injected only in this test.
 await desktop.evaluate(({app})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{RenderPlayer}=require(app.getAppPath()+'/electron/dist/renderPlayer.js'),api=RenderPlayer.prototype.api;globalThis.__failClosingSave=true;RenderPlayer.prototype.api=function(route,...args){globalThis.__recoveryService=this;if(globalThis.__failClosingSave&&this.active?.closing&&route.endsWith('/progress'))return Promise.reject(new Error('controlled durable save failure'));return api.call(this,route,...args);};});
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.getByText('播放记录尚未保存，请重试关闭',{exact:true}).first()).toBeVisible();
 assert.equal(await desktop.evaluate(()=>globalThis.__recoveryService.active!==null&&globalThis.__recoveryClient.alive),true,'Failed save must retain the native owner');report.failedSaveRetainsOwnership=true;
 await desktop.evaluate(()=>globalThis.__failClosingSave=false);await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.native-render-canvas')).toHaveCount(0);assert.equal((await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active,false);report.saveRetryClosed=true;
 assert.deepEqual(await identity(),before);report.sourceUnchanged=true;report.passed=true;
}catch(error){report.error=String(error.stack??error);report.body=await page?.locator('body').innerText().catch(()=>null);throw error;}
finally{await desktop?.close();writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(path.join(directory,'report.json'));}
