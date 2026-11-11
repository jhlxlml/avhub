import {placeTestMedia} from './media-pool.mjs';
// Real Electron/native transport, controlled WebGPU initialization rejection.
// This proves error cleanup/retry, not real-driver failure or startup speed.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {playbackFixture} from './playback-fixtures.mjs';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/render-gpu-init-failure-')),media=path.join(data,'media');mkdirSync(media);placeTestMedia(playbackFixture('basic'),path.join(media,'Gpu.mp4'));
const report={kind:'controlled-WebGPU-init-failure-real-Electron',performanceEvidence:false,passed:false};let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__gpuFailure=s));
 const cdp=await desktop.context().newCDPSession(page),contexts=[];cdp.on('Runtime.executionContextCreated',({context})=>contexts.push(context));await cdp.send('Runtime.enable');const contextId=contexts.find(context=>context.name==='Electron Isolated Context')?.id;assert.ok(contextId);
 const evaluate=async expression=>{const result=await cdp.send('Runtime.evaluate',{contextId,expression,returnByValue:true});assert.equal(result.exceptionDetails,undefined);return result.result.value;};
 await evaluate(`globalThis.__gpuCleanup={destroyed:0,unconfigured:0};globalThis.__gpuOriginalPipeline=GPUDevice.prototype.createRenderPipelineAsync;const destroy=GPUDevice.prototype.destroy,unconfigure=GPUCanvasContext.prototype.unconfigure;GPUDevice.prototype.destroy=function(){globalThis.__gpuCleanup.destroyed++;return destroy.call(this)};GPUCanvasContext.prototype.unconfigure=function(){globalThis.__gpuCleanup.unconfigured++;return unconfigure.call(this)};GPUDevice.prototype.createRenderPipelineAsync=function(){return Promise.reject(new Error('controlled pipeline initialization rejection'))};`);
 await page.getByRole('button',{name:'播放 Gpu',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__gpuFailure?.phase),{timeout:30000}).toBe('error');
 const failed=await page.evaluate(()=>window.__gpuFailure);assert.match(failed.error.message,/GPU 提交或释放失败/);assert.equal(failed.firstFrameMs,null);assert.equal(failed.transport.gpuCompletions,0);report.failed={phase:failed.phase,firstFrameMs:failed.firstFrameMs,transport:failed.transport};
 await expect.poll(()=>evaluate('globalThis.__gpuCleanup.destroyed')).toBe(1);assert.equal(await evaluate('globalThis.__gpuCleanup.unconfigured'),1);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active).toBe(false);await expect(page.locator('.native-render-canvas')).toHaveCount(0);
 await evaluate('GPUDevice.prototype.createRenderPipelineAsync=globalThis.__gpuOriginalPipeline');await page.evaluate(()=>window.__gpuFailure=null);
 await page.getByRole('button',{name:'播放 Gpu',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__gpuFailure?.transport?.gpuCompletions??0),{timeout:30000}).toBeGreaterThan(2);await expect.poll(()=>page.evaluate(()=>window.__gpuFailure?.positionSec)).toBeGreaterThan(.1);report.recovered=true;
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active).toBe(false);report.cleanup=await evaluate('globalThis.__gpuCleanup');assert.equal(report.cleanup.destroyed,2);assert.equal(report.cleanup.unconfigured,2);
 report.closes=readFileSync(path.join(data,'desktop.log'),'utf8').split('\n').filter(line=>line.includes(' render-player-closed ')).map(line=>JSON.parse(line.split(' render-player-closed ')[1]));assert.equal(report.closes.length,2);
 for(const closed of report.closes){assert.equal(closed.helperAlive,false);assert.equal(closed.sourceLeaseReleased,true);assert.equal(closed.transport.imports,closed.transport.released);assert.equal(closed.transport.leases,closed.transport.closedLeases);}
 report.outputFailures=readFileSync(path.join(data,'desktop.log'),'utf8').split('\n').filter(line=>line.includes(' render-output-failure ')).map(line=>JSON.parse(line.split(' render-output-failure ')[1]));assert.ok(report.outputFailures.some(f=>f.stage==='gpu'&&f.kind==='gpu-presentation'));
 report.passed=true;
}catch(error){report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);throw error;}
finally{await desktop?.close();writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}
