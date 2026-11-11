import {placeTestMedia} from './media-pool.mjs';
// Real Electron startup phase timings. No stage is skipped or acknowledged early.
import assert from 'node:assert/strict';import {_electron,expect} from '@playwright/test';
import {playbackFixture} from './playback-fixtures.mjs';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const data=mkdtempSync(path.join(root,'build/render-startup-profile-')),media=path.join(data,'media');mkdirSync(media);
const source=playbackFixture('basic');placeTestMedia(source,path.join(media,'Real'+path.extname(source)));
const iterations=Number(process.env.AVHUB_STARTUP_ITERATIONS??3);assert.ok(Number.isInteger(iterations)&&iterations>=3&&iterations<=30);
const shaderCache=process.env.AVHUB_TEST_SHADER_CACHE==='1'?path.join(data,'shader-cache'):null;if(shaderCache)mkdirSync(shaderCache);
const unownedCache=process.env.AVHUB_TEST_UNOWNED_SHADER_CACHE==='1';if(unownedCache){mkdirSync(path.join(data,'native-shaders-v1'));writeFileSync(path.join(data,'native-shaders-v1/keep.txt'),'user-owned');}
const report={shaderCache,unownedCache,iterations,kind:'real-Electron-startup',rows:[],passed:false};let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app},shaderCache)=>{
  const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js'),{RenderTextureBridge}=require(app.getAppPath()+'/electron/dist/renderTexture.js');globalThis.__startupTimings=[];
  const framed=new WeakSet(),presented=new WeakSet();
  for(const method of ['open','display','control','setSubtitleStyle','snapshot','frame']){const original=RenderHostClient.prototype[method];RenderHostClient.prototype[method]=async function(...args){const began=performance.now();if(method==='open'){globalThis.__startupClient=this;if(shaderCache)args[0]={...args[0],shaderCache};}const result=await original.apply(this,args);if(method!=='frame'||result.waiting&&!framed.has(this)){if(method==='frame')framed.add(this);globalThis.__startupTimings.push({method:method==='control'?'control:'+args[0]:method,atMs:began-globalThis.__startupBegin,ms:performance.now()-began,...(method==='open'?{phases:this.startupTimings}:{})});}return result;};}
  const present=RenderTextureBridge.prototype.present;RenderTextureBridge.prototype.present=async function(...args){const began=performance.now(),first=!presented.has(this);presented.add(this);const result=await present.apply(this,args);if(first)globalThis.__startupTimings.push({method:'first-present',atMs:began-globalThis.__startupBegin,ms:performance.now()-began,gpuAtMs:result.gpuAt-globalThis.__startupBegin});return result;};

 },shaderCache);
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/thumbnails/pause','POST');await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__startupProfile=s));
 for(let i=0;i<iterations;i++){
  await page.evaluate(()=>window.__startupProfile=null);await desktop.evaluate(()=>{globalThis.__startupTimings=[];globalThis.__startupBegin=performance.now();});
  const began=performance.now();await page.getByRole('button',{name:'播放 Real',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__startupProfile?.firstFrameMs),{timeout:30000,intervals:[10,20,40]}).toBeGreaterThan(0);
  const state=await page.evaluate(()=>window.__startupProfile);report.rows.push({iteration:i,observedMs:performance.now()-began,firstFrameMs:state.firstFrameMs,sourceLoads:state.sourceLoads,nativeTrace:state.properties?.['avhub-native-seek-trace']??null,timings:await desktop.evaluate(()=>globalThis.__startupTimings),resources:await desktop.evaluate(async({app})=>({electron:app.getAppMetrics(),native:await globalThis.__startupClient.resources()}))});
  assert.ok(report.rows.at(-1).timings.every(t=>t.method!=='display'),'Playback must not enqueue display-driver enumeration before play or later seeks');
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
  await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active).toBe(false);
  report.rows.at(-1).afterClose=await desktop.evaluate(({app,BrowserWindow})=>({windows:BrowserWindow.getAllWindows().length,electron:app.getAppMetrics()}));assert.equal(report.rows.at(-1).afterClose.windows,1);
 }
 // Cancel during open to check early GPU preparation is retired with its surface.
 await page.getByRole('button',{name:'播放 Real',exact:true}).click();
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await expect(page.locator('.card')).toHaveCount(1);
 await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active,{timeout:30000}).toBe(false);
 await expect(page.locator('.native-render-canvas')).toHaveCount(0);
 await page.evaluate(()=>window.__startupProfile=null);
 await page.getByRole('button',{name:'播放 Real',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__startupProfile?.firstFrameMs),{timeout:30000}).toBeGreaterThan(0);
 assert.equal(await page.evaluate(()=>window.__startupProfile.sourceLoads),1);
 // The read-only native probe is retained for explicit acceptance requests;
 // it must not be injected into normal playback above.
 report.explicitDisplay=await desktop.evaluate(()=>globalThis.__startupClient.display());assert.ok(Array.isArray(report.explicitDisplay.outputs));
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
 report.cancelAndReopen=true;
 report.closes=readFileSync(path.join(data,'desktop.log'),'utf8').split('\n').filter(line=>line.includes(' render-player-closed ')).map(line=>JSON.parse(line.split(' render-player-closed ')[1]));
 assert.ok(report.closes.length>=iterations+1);
 for(const closed of report.closes){assert.equal(closed.helperAlive,false);assert.equal(closed.sourceLeaseReleased,true);assert.equal(closed.clock.requests,closed.clock.releases);if(closed.transport){assert.equal(closed.transport.imports,closed.transport.released);assert.equal(closed.transport.imports,closed.transport.gpuCompletions);assert.equal(closed.transport.leases,closed.transport.closedLeases);}}
 if(unownedCache){assert.deepEqual(readdirSync(path.join(data,'native-shaders-v1')),['keep.txt']);assert.equal(readFileSync(path.join(data,'native-shaders-v1/keep.txt'),'utf8'),'user-owned');report.cacheFallbackPassed=true;}
 report.passed=true;
}catch(error){report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);throw error;}
finally{try{await desktop?.close();}finally{writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}}
