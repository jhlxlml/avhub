// Actual Electron, synthetic SDR fixtures, decoded-frame callbacks. No physical
// display latency or OS disk-cache eviction claim. Same files reused across stages.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,existsSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),stage=process.argv[2]||'m0';assert.match(stage,/^m[01](-legacy)?$/);
const fixture=path.join(root,'build/playback-refactor-fixtures'),media=path.join(fixture,'media');mkdirSync(media,{recursive:true});
const ffmpeg=path.join(root,'bin/ffmpeg.exe'),original=path.join(media,'Direct.mp4');
const generate=args=>{const result=spawnSync(ffmpeg,['-v','error',...args],{windowsHide:true,timeout:30000});assert.equal(result.status,0,String(result.stderr));};
if(!existsSync(original))generate(['-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','24','-c:v','libx264','-preset','ultrafast','-g','50','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',original]);
for(const name of ['Indexed.ts','Remux.mkv'])if(!existsSync(path.join(media,name)))generate(['-i',original,'-map','0:v:0','-c','copy',path.join(media,name)]);
const files=['Direct.mp4','Indexed.ts','Remux.mkv'].map(n=>path.join(media,n));
const identity=()=>files.map(f=>({name:path.basename(f),bytes:statSync(f).size,sha256:createHash('sha256').update(readFileSync(f)).digest('hex')})),before=identity();
const data=mkdtempSync(path.join(root,'build','playback-refactor-'+stage+'-'));
const report={stage,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),source:before,samples:[],completed:false,limitations:['Synthetic SDR H264 only; no private media.','First/reopened application sessions, OS disk cache uncontrolled.','requestVideoFrameCallback submission is not a physical display timing.','Paused random seeks, 20 per format. No 15-minute stability or released-build comparison.']};let app;
console.log('Refactor benchmark:',data);
try{
 const env={...process.env,AVHUB_DATA_DIR:data,AVHUB_APP_HOME:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 app=await _electron.launch({args:[root],cwd:data,env,timeout:60000});const page=await app.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 report.hardware=await app.evaluate(async({app,screen})=>({gpu:await app.getGPUInfo('basic'),features:app.getGPUFeatureStatus(),displays:screen.getAllDisplays().map(d=>({scale:d.scaleFactor,bounds:d.bounds,frequency:d.displayFrequency}))}));
 const api=(route,method='GET',body)=>page.evaluate(async({route,method,body})=>{const response=await fetch(route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error(await response.text());return response.json();},{route,method,body});
 await api('/api/preferences','PATCH',{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,hoverPreview:false,audio:{volume:0,muted:true},...(stage==='m0'?{}:{playbackControllerEnabled:stage==='m1'})}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST',{});await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await api('/api/thumbnails/pause','POST');await page.reload();
 const items=(await api('/api/media?page=1&page_size=48')).items;
 for(const name of ['Direct','Indexed','Remux']){
  const item=items.find(m=>path.parse(m.filename||m.path).name===name||m.title===name);assert.ok(item,name);const responses=[];
  if(name==='Remux')await page.route(`**/api/media/${item.id}/playback`,route=>route.continue({postData:JSON.stringify({...route.request().postDataJSON(),prefer_original:false,skip_direct:true,indexed_remux:true})}));
  const observe=async r=>{if(r.request().method()==='POST'&&r.url().endsWith(`/api/media/${item.id}/playback`))responses.push(await r.json());};page.on('response',observe);
  const times=[];
  for(let round=0;round<2;round++){
   await page.evaluate(()=>{window.__refactorStart=performance.now();window.__refactorFirst=null;const observer=new MutationObserver(()=>{const v=document.querySelector('video');if(v){observer.disconnect();v.requestVideoFrameCallback((now,metadata)=>{window.__refactorFirst={ms:now-window.__refactorStart,time:metadata.mediaTime,width:metadata.width,height:metadata.height};});}});observer.observe(document.body,{subtree:true,childList:true});});
   await page.getByRole('button',{name:'播放 '+item.title,exact:true}).click();
   await expect.poll(()=>page.evaluate(()=>window.__refactorFirst),{timeout:30000}).not.toBe(null);times.push(await page.evaluate(()=>window.__refactorFirst));
   await page.locator('video').evaluate(v=>v.pause());
   if(round===0)await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  }
  const seeks=[];let seed=173,previous=0;
  for(let i=0;i<20;i++){
   seed=(seed*16807)%2147483647;let target=1+(seed%2100)/100;if(Math.abs(target-previous)<1)target=1+(target+8)%21;previous=target;
   const result=await page.evaluate(({target,offset})=>new Promise((resolve,reject)=>{
    const video=document.querySelector('video'),slider=document.querySelector('input[aria-label="视频完整进度"]'),started=performance.now();let callback;
    const timer=setTimeout(()=>{video.cancelVideoFrameCallback(callback);reject(new Error('Decoded seek timeout '+JSON.stringify({target,current:video.currentTime,offset,seeking:video.seeking,paused:video.paused})));},15000);
    const frame=(now,metadata)=>{if(Math.abs(metadata.mediaTime+offset-target)<.55){clearTimeout(timer);resolve({ms:now-started,target,actual:metadata.mediaTime+offset,frames:metadata.presentedFrames});}else callback=video.requestVideoFrameCallback(frame);};
    callback=video.requestVideoFrameCallback(frame);slider.value=String(target);slider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
   }),{target,offset:responses.at(-1)?.offset||0});seeks.push(result);
  }
  const sorted=seeks.map(s=>s.ms).sort((a,b)=>a-b);report.samples.push({name,mode:responses.at(-1)?.mode,delivery:responses.at(-1)?.delivery||'direct',firstSessions:times,seeks,p50:sorted[9],p95:sorted[18],sourceRequests:responses.length});
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();page.off('response',observe);if(name==='Remux')await page.unroute(`**/api/media/${item.id}/playback`);
 }
 report.hardwareAfterPlayback=await app.evaluate(async({app})=>({gpu:await app.getGPUInfo('complete'),features:app.getGPUFeatureStatus()}));
 await app.close();app=null;assert.deepEqual(identity(),before);report.sourceUnchanged=true;report.cleanExit=true;report.completed=true;
}catch(error){report.error=String(error.stack??error);throw error;}
finally{writeFileSync(path.join(data,'benchmark.json'),JSON.stringify(report,null,2));if(app)await app.close().catch(()=>{});}
