// Read-only user recording regression in actual Electron. The library indexes
// an isolated copy, never the source supplied by the user. No color tags added.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),original=path.join(root,'屏幕录制 2026-10-29 090659.mp4');
const identity=()=>({sha256:createHash('sha256').update(readFileSync(original)).digest('hex'),mtime:statSync(original).mtimeMs});
const before=identity(),data=mkdtempSync(path.join(root,'build/render-untagged-recording-')),media=path.join(data,'media');mkdirSync(media);copyFileSync(original,path.join(media,'Recording.mp4'));
const report={kind:'real-electron-user-untagged-recording',sourceBefore:before,passed:false};let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_RENDER_RUNTIME_CANDIDATE:process.env.AVHUB_RENDER_RUNTIME_CANDIDATE,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__untaggedState=s));
 await page.getByRole('button',{name:'播放 Recording',exact:true}).click();
 const canvas=page.locator('.native-render-canvas');await expect(canvas).toBeVisible({timeout:30000});
 const state=()=>page.evaluate(()=>window.__untaggedState);
 await expect.poll(async()=>(await state())?.status,{timeout:30000}).toBe('playing');
 report.first=await state();assert.equal(report.first.properties['avhub-source-color'],'源色彩标记不完整 · MPV 自动解释');
 assert.deepEqual(report.first.videoSize,{width:2510,height:1302});assert.equal(report.first.error,undefined);
 assert.equal(await page.locator('video').count(),0,'must stay on mpv instead of HTML video fallback');
 await expect.poll(async()=>(await state()).presented.serial,{timeout:10000}).toBeGreaterThan(report.first.presented.serial+5);
 const firstPixels=createHash('sha256').update(await canvas.screenshot()).digest('hex');
 await page.keyboard.press('Space');await expect.poll(async()=>(await state()).properties.pause).toBe(true);
 const timeline=page.getByRole('slider',{name:'播放进度',exact:true});await timeline.evaluate(n=>{n.value='10';n.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect.poll(async()=>{const s=await state();return s.pendingSeek===null&&Math.abs(s.presented.positionSec-10)<.1;},{timeout:10000}).toBe(true);
 report.afterSeek=await state();assert.equal(report.afterSeek.sourceLoads,1);assert.equal(report.afterSeek.restarts,0);
 const seekPixels=createHash('sha256').update(await canvas.screenshot()).digest('hex');assert.notEqual(firstPixels,seekPixels);report.compositorPixelsChanged=true;
 await page.keyboard.press('Space');await expect.poll(async()=>(await state()).positionSec).toBeGreaterThan(10.2);
 report.afterResume=await state();await page.screenshot({path:path.join(data,'mpv-playing.png')});
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).toMatchObject({active:false});
 report.sourceAfter=identity();assert.deepEqual(report.sourceAfter,before);report.passed=true;
}catch(error){report.error=String(error.stack||error);if(page)report.body=await page.locator('body').innerText().catch(()=>'<closed>');throw error;}
finally{writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));if(desktop)await desktop.close();report.cleanupCompleted=true;writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(data,'report.json')}));}
