// Real Electron/native/GPU path; deliberately delay the actual release callback.
// This certifies bounded failure/protection/recovery, not faster rendering.
import {placeTestMedia} from './media-pool.mjs';
import {playbackFixture} from './playback-fixtures.mjs';
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/render-release-timeout-')),media=path.join(data,'media');mkdirSync(media);placeTestMedia(playbackFixture('basic'),path.join(media,'Release.mp4'));
const report={kind:'controlled-release-callback-delay-real-Electron',performanceEvidence:false,passed:false};let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__releaseState=s));
 await desktop.evaluate(({app})=>{
  const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{sharedTexture}=require('electron'),{RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js');
  const original=sharedTexture.importSharedTexture,ack=RenderHostClient.prototype.acknowledge;globalThis.__releaseProbe={callbacks:[],acks:0,restore:()=>{sharedTexture.importSharedTexture=original;RenderHostClient.prototype.acknowledge=ack;}};
  sharedTexture.importSharedTexture=function(options){return original.call(this,{...options,allReferencesReleased:()=>globalThis.__releaseProbe.callbacks.push(options.allReferencesReleased)});};
  RenderHostClient.prototype.acknowledge=function(...args){globalThis.__releaseProbe.acks++;return ack.apply(this,args);};
 });
 const began=Date.now();await page.getByRole('button',{name:'播放 Release',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__releaseState?.phase),{timeout:15000}).toBe('error');report.errorElapsedMs=Date.now()-began;
 const failed=await page.evaluate(()=>window.__releaseState);assert.match(failed.error.message,/纹理引用释放超时/);assert.equal(failed.firstFrameMs,null);assert.equal(failed.transport.gpuCompletions,1);assert.equal(failed.transport.imports,1);assert.equal(failed.transport.released,0);assert.equal(failed.transport.closedLeases,0);report.failure={error:failed.error,transport:failed.transport};
 assert.equal(await desktop.evaluate(()=>globalThis.__releaseProbe.acks),0,'No native surface reuse before actual reference release');assert.ok(report.errorElapsedMs>=5000&&report.errorElapsedMs<15000);
 await desktop.evaluate(()=>{const p=globalThis.__releaseProbe;p.restore();for(const callback of p.callbacks)callback();p.callbacks=[];});
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active,{timeout:15000}).toBe(false);
 await page.getByRole('button',{name:'播放 Release',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__releaseState?.phase),{timeout:15000}).toBe('ready');await expect.poll(()=>page.evaluate(()=>window.__releaseState?.transport.gpuCompletions??0)).toBeGreaterThan(3);report.recovered=true;
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active).toBe(false);
 const log=readFileSync(path.join(data,'desktop.log'),'utf8');report.closes=log.split('\n').filter(line=>line.includes(' render-player-closed ')).map(line=>JSON.parse(line.split(' render-player-closed ')[1]));assert.equal(report.closes.length,2);
 for(const c of report.closes){assert.equal(c.helperAlive,false);assert.equal(c.sourceLeaseReleased,true);assert.equal(c.transport.imports,c.transport.released);assert.equal(c.transport.leases,c.transport.closedLeases);}
 assert.ok(log.includes('"kind":"texture-release-timeout"'));report.passed=true;
}catch(error){report.error=String(error.stack??error);throw error;}
finally{await desktop?.close();writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}
