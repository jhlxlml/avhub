// Real, visible Electron with normal window policy. Generated sources only.
// CDP is attached: this is a controlled comparison, not a no-inspector benchmark.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
import observation from './frame-observation.cjs';
const {observePlayback,summarizeFrameTrace}=observation;
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-frame-probe-'),media=path.join(workspace,'media');mkdirSync(media);
const captureDecoder=process.argv.includes('--capture-decoder');
const artifact=path.join(root,'build','frame-probe-'+path.basename(workspace));mkdirSync(artifact,{recursive:true});
const identities=new Map();
for(const fps of [12,60]){
 const file=path.join(media,`Owned ${fps} fps.mp4`);
 assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i',`testsrc2=s=640x360:r=${fps}`,'-t',captureDecoder?'30':'18','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',file],{windowsHide:true,timeout:30000}).status,0);
 identities.set(file,createHash('sha256').update(readFileSync(file)).digest('hex'));
}
const report={build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),passed:false,sourceUnchanged:false,runs:[],errors:[],limitations:[
 'Visible normal Electron, Playwright/CDP attached; no GPU/sandbox/timer disabling flags.',
 'Generated H.264 SDR 640x360 at 12/60 fps; not 4K/HDR, real-media or deferred problem-video acceptance.',
 'Startup counts are retained. Bins use wall time since play(), not an assumed ready/steady boundary.',
]};
const persist=()=>writeFileSync(path.join(artifact,'frames.json'),JSON.stringify(report,null,2));
let desktop,page;
async function collect(fps,preview,variant='app'){
 const video=page.locator('.player-shell video');await expect.poll(()=>video.evaluate(v=>v.readyState>=2&&!v.paused),{timeout:30000}).toBe(true);
 await page.waitForTimeout(12000);
 const trace=await page.evaluate(()=>{const t=window.__frameProbe;t.stop();const{stop,...data}=t;return data;});
 const {bins,unexpectedReloads}=summarizeFrameTrace(trace);
 report.runs.push({fps,preview,variant,bins,unexpectedReloads,trace});persist();console.log(JSON.stringify({fps,preview,variant,bins}));
 assert.ok(trace.frames.length>0);assert.ok(trace.samples.at(-1).total>fps*8);assert.ok(trace.samples.at(-1).time>10);assert.equal(unexpectedReloads,0);
}
try{
 desktop=await _electron.launch({args:[root],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:path.join(workspace,'profile'),AVHUB_APP_HOME:workspace,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow({timeout:50000});page.on('pageerror',error=>report.errors.push(error.message));
 report.windowPolicy=await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();return{backgroundThrottling:w.webContents.getBackgroundThrottling(),sandbox:w.webContents.getLastWebPreferences().sandbox};});
 assert.deepEqual(report.windowPolicy,{backgroundThrottling:true,sandbox:true});
 // Keep production's work-area-fitted window. A 1440x900 DIP override extends
 // offscreen at 175% DPI and is not a representative presentation comparison.
 report.windowPlacement=await desktop.evaluate(({BrowserWindow,screen})=>{
  const bounds=BrowserWindow.getAllWindows()[0].getBounds(),work=screen.getDisplayMatching(bounds).workArea;
  return{bounds,workArea:work,withinWorkArea:bounds.x>=work.x&&bounds.y>=work.y&&bounds.x+bounds.width<=work.x+work.width&&bounds.y+bounds.height<=work.y+work.height};
 });
 assert.equal(report.windowPlacement.withinWorkArea,true);
 report.graphics=await desktop.evaluate(({app,screen})=>({features:app.getGPUFeatureStatus(),displays:screen.getAllDisplays().map(d=>({scale:d.scaleFactor,frequency:d.displayFrequency,size:d.size}))}));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/preferences','PATCH',{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await expect.poll(async()=>(await api('/api/thumbnails')).pending,{timeout:30000}).toBe(0);
 await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 // Observe before source assignment/play. No DOM, quality or source mutations.
 await page.evaluate(observePlayback);
 for(const preview of [false,true])for(const fps of [12,60]){
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('checkbox',{name:'封面悬停预览',exact:true}).setChecked(preview);await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const card=page.locator('.card').filter({has:page.getByRole('button',{name:`播放 Owned ${fps} fps`,exact:true})});
  if(preview){await card.locator('.cover').hover();await expect.poll(()=>page.locator('video.hover-preview').evaluateAll(vs=>vs.some(v=>v.getVideoPlaybackQuality().totalVideoFrames>0)),{timeout:15000}).toBe(true);}
  await card.locator('.open-video').click();
  await collect(fps,preview);
  if(captureDecoder&&fps===60&&!preview){
   // A separate explicit diagnostic AFTER the frame observation stops. The
   // 30s fixture leaves enough playing time for the ordinary 8s export.
   const saved=path.join(workspace,'decoder-capture.json');
   await desktop.evaluate(({dialog},saved)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});},saved);
   await page.locator('.playback-diagnostics summary').click();await page.getByRole('button',{name:'采集并导出播放诊断（8 秒）',exact:true}).click();
   await expect(page.getByText('播放诊断已保存',{exact:true})).toBeVisible({timeout:20000});
   report.decoderCapture=JSON.parse(readFileSync(saved,'utf8'));persist();
   console.log(JSON.stringify({decoder:report.decoderCapture.decoder,playback:report.decoderCapture.playback}));
  }
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.player-shell')).toHaveCount(0);
 }
 const items=(await api('/api/media?page=1')).items;
 // Same origin, delivery, window and decoder; only this test-owned document
 // lacks React, transforms, filters and application controls.
 await page.route('**/__frame-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#000}video{width:100vw;height:100vh;object-fit:contain}</style><div class="player-shell"><video muted playsinline></video></div>'}));
 for(const fps of [12,60]){
  await page.goto(new URL('/__frame-probe',page.url()).href);await page.evaluate(observePlayback);
  const item=items.find(item=>item.title===`Owned ${fps} fps`);assert.ok(item);
  await page.locator('video').evaluate((v,id)=>{v.src=`/media/${id}/file`;return v.play();},item.id);
  await collect(fps,false,'minimal-document');
 }
 assert.deepEqual(report.errors,[]);await desktop.close();desktop=null;report.passed=true;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:path.join(artifact,'failure.png')}).catch(()=>{});throw error;}
finally{if(desktop)await desktop.close().catch(error=>report.errors.push(String(error)));report.sourceUnchanged=[...identities].every(([file,hash])=>createHash('sha256').update(readFileSync(file)).digest('hex')===hash);persist();console.log('Frame probe report:',path.join(artifact,'frames.json'));}
