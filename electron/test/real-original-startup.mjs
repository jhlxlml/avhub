// Real Electron app; one user-authorized source, read-only. No scan of its directory.
import {_electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),source=process.argv[2];
if(!source)throw new Error('Supply the authorized read-only source');
const folder=mkdtempSync(path.join(root,'build','original-startup-')),profile=path.join(folder,'profile');
const fingerprint=()=>({hash:createHash('sha256').update(readFileSync(source)).digest('hex'),size:statSync(source).size,mtime:statSync(source).mtimeMs});
const before=fingerprint(),seed=spawnSync(process.env.AVHUB_PYTHON||'python',[path.join(root,'electron/test/seed-original-probe.py'),source,profile],{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000});
if(seed.status!==0)throw new Error(seed.stderr||seed.stdout);
const report={build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),metadata:JSON.parse(seed.stdout.trim().split(/\r?\n/).at(-1)),cases:[],errors:[]};
let desktop;
try{
 desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:folder,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();const origin=new URL(page.url()).origin;
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 for(const audio of [null,report.metadata.audio[0]?.index]){
  if(audio===undefined)continue;
  const state=await api('/api/media/1/playback-state');await api('/api/media/1/playback-state','PATCH',{source:state.source,changes:{audio}});
  const attempts=[];const observe=async response=>{if(response.url().endsWith('/api/media/1/playback')&&response.request().method()==='POST')try{attempts.push({request:response.request().postDataJSON(),status:response.status(),body:await response.json()});}catch{}};
  page.on('response',observe);await page.goto(origin+'/?video=1');
  await expect.poll(()=>page.evaluate(()=>{const v=document.querySelector('video');return document.querySelector('.video-wrap')?.dataset.phase==='error'||!!(v&&v.getVideoPlaybackQuality().totalVideoFrames>0&&v.currentTime>.1);}),{timeout:55000}).toBe(true);
  const observed=await page.evaluate(()=>{const v=document.querySelector('video'),q=v?.getVideoPlaybackQuality();return{phase:document.querySelector('.video-wrap')?.dataset.phase,error:document.querySelector('.resume[role="alert"]')?.textContent,video:v?{time:v.currentTime,src:v.currentSrc,ready:v.readyState,width:v.videoWidth,height:v.videoHeight,frames:{total:q.totalVideoFrames,dropped:q.droppedVideoFrames},error:v.error?{code:v.error.code,message:v.error.message}:null}:null};});
  const entry={audio,attempts,observed,seeks:[]};report.cases.push(entry);
  if(process.argv.includes('--expect-original')){
   assert.equal(observed.phase,'ready');assert.ok(observed.video.frames.total>0);assert.equal(observed.video.width,report.metadata.width);assert.equal(observed.video.height,report.metadata.height);
   for(const target of [15,35])entry.seeks.push(await page.evaluate(target=>new Promise((resolve,reject)=>{
    const v=document.querySelector('video');let callback;
    const timer=setTimeout(()=>{v.cancelVideoFrameCallback(callback);reject(new Error('No actual target frame'));},15000);
    const observe=(_now,frame)=>{if(frame.mediaTime>=target-.1&&frame.mediaTime<target+2){clearTimeout(timer);resolve({target,mediaTime:frame.mediaTime,presentedFrames:frame.presentedFrames,source:v.currentSrc,width:v.videoWidth,height:v.videoHeight});}else callback=v.requestVideoFrameCallback(observe);};
    callback=v.requestVideoFrameCallback(observe);v.currentTime=target;void v.play().catch(error=>{clearTimeout(timer);v.cancelVideoFrameCallback(callback);reject(error);});
   }),target));
   assert.equal(attempts.length,1);assert.equal(attempts[0].status,200);assert.equal(attempts[0].body.mode,'direct');assert.equal(attempts[0].request.audio_track_index,undefined);
   assert.notEqual(attempts[0].request.allow_video_transcode,true);assert.notEqual(attempts[0].request.allow_audio_transcode,true);
   for(const seek of entry.seeks)assert.equal(seek.source,observed.video.src);
   assert.equal((await api('/api/media/1/playback-state')).audio,audio);
  }
  await page.screenshot({path:path.join(folder,`audio-${audio}.png`)});page.off('response',observe);
  console.log(JSON.stringify({audio,...observed}));
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 }
}finally{
 if(desktop){const closed=desktop.waitForEvent('close',{timeout:20000});await desktop.evaluate(({app})=>app.quit());await closed;}
 report.sourceUnchanged=JSON.stringify(before)===JSON.stringify(fingerprint());writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log('Report:',folder);assert.equal(report.sourceUnchanged,true);
}
