// Actual Electron, normal GPU/sandbox. Only owned generated media/cache files.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,writeFileSync,readFileSync,statSync,copyFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),folder=ownedTemporaryWorkspace('avhub-storage-concurrency-');
const media=path.join(folder,'media'),profile=path.join(folder,'profile');mkdirSync(media);
const source=path.join(media,'Owned playback.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','60','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',source],{windowsHide:true,timeout:30000}).status,0);
const identity=()=>({sha256:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs});
const before=identity(),report={build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),completed:false,errors:[],samples:[],limitations:['Generated SDR H.264 on one local disk; not physical HDR, real 4K or an all-day performance benchmark.','Slow-I/O control-lock availability is separately covered by deterministic backend barriers.']};
let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:folder,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v;},{url,method,body});
 await api('/api/preferences','PATCH',{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await expect.poll(async()=>{const t=await api('/api/thumbnails');return t.pending===0&&t.current===null;},{timeout:30000}).toBe(true);
 const id=(await api('/api/media?page=1&page_size=48')).items[0].id;
 const baseline=await api('/api/storage');assert.equal(baseline.cleanup.files,0);
 const thumbs=path.join(profile,'thumbnails');
 for(let n=100000;n<102000;n++)writeFileSync(path.join(thumbs,`${n}.jpg`),Buffer.from('owned orphan cache'));
 await page.goto(new URL(`/?video=${id}`,page.url()).href);
 const video=page.locator('.player-shell video');
 await expect.poll(()=>video.evaluate(v=>!v.paused&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:30000}).toBe(true);
 await video.evaluate(v=>{window.__storageLoads=0;v.addEventListener('loadstart',()=>window.__storageLoads++);});
 for(let cycle=0;cycle<12;cycle++){
   const start=performance.now(),frames=await video.evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);
   const preview=await api('/api/storage');
   let cleaned=null,rangeRead=null;
   const range=()=>video.evaluate(async v=>{const began=performance.now();const r=await fetch(v.currentSrc,{headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(5000)});const bytes=(await r.arrayBuffer()).byteLength;return{status:r.status,bytes,elapsedMs:Math.round(performance.now()-began)};});
   if(cycle===4){
     const result=await Promise.all([api('/api/storage/cleanup','POST',{token:preview.cleanup.token}),range()]);
     cleaned=result[0];rangeRead=result[1];assert.equal(cleaned.removed,2000);assert.equal(rangeRead.status,206);assert.equal(rangeRead.bytes,1024);
   }else{rangeRead=await range();assert.equal(rangeRead.status,206);assert.equal(rangeRead.bytes,1024);}
   await expect.poll(()=>video.evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(frames);
   const state=await video.evaluate(v=>({time:v.currentTime,frames:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames,loads:window.__storageLoads}));
   assert.equal(state.loads,0);report.samples.push({cycle,elapsedMs:Math.round(performance.now()-start),...state,cleaned,rangeRead});
   await api(`/api/media/${id}/progress`,'PUT',{progress:state.time});
 }
 report.databaseTiming=(await api('/api/diagnostics')).database_timing;
 const saves=report.databaseTiming.save_trace.operations;
 assert.ok(saves.length>=12);
 for(const save of saves){
   assert.equal(save.transaction_outcome,'committed');
   assert.ok(save.queued_at_monotonic_ms<=save.commit_started_at_monotonic_ms);
   assert.ok(save.commit_started_at_monotonic_ms<=save.commit_finished_at_monotonic_ms);
 }
 assert.deepEqual(identity(),before);assert.deepEqual(report.errors,[]);report.sourceUnchanged=true;
 await desktop.close();desktop=null;report.cleanExit=true;report.completed=true;
}catch(error){report.failure=String(error);if(page)await page.screenshot({path:path.join(folder,'failure.png')}).catch(()=>{});throw error;}
finally{
 if(desktop)await desktop.close();writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify(report,null,2));
 const artifact=path.join(root,'build','electron-storage-concurrency-'+path.basename(folder));mkdirSync(artifact,{recursive:true});
 copyFileSync(path.join(folder,'acceptance.json'),path.join(artifact,'acceptance.json'));
 if(existsSync(path.join(folder,'failure.png')))copyFileSync(path.join(folder,'failure.png'),path.join(artifact,'failure.png'));
 console.log('Storage/playback acceptance:',folder);
}
