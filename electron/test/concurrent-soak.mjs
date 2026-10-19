// Real Electron bounded soak. Mutations touch ONLY generated owned TEMP samples.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),seconds=Number(process.argv[2]||600);
assert.ok(Number.isInteger(seconds)&&seconds>=60&&seconds<=86400,'Duration must be 60..86400 seconds');
const workspace=ownedTemporaryWorkspace('avhub-concurrent-soak-'),media=path.join(workspace,'media');mkdirSync(media);
const sample=path.join(media,'Owned playback.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t',String(seconds+120),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',sample],{windowsHide:true,timeout:60000}).status,0);
for(let i=0;i<12;i++)copyFileSync(sample,path.join(media,`Owned cover ${i}.mp4`));
const digest=()=>createHash('sha256').update(readFileSync(sample)).digest('hex'),original=digest();
let desktop;const measurements=[],errors=[];let cleanExit=false;
async function closeDesktop(application){let timer;try{await Promise.race([application.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned soak desktop exit timeout')),30000);})]);}finally{clearTimeout(timer);}}
try{
 desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:path.join(workspace,'profile'),AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 const rows=(await api('/api/media?page=1&page_size=48')).items,id=rows.find(row=>row.path===sample).id;
 await page.goto(new URL('/?video='+id,page.url()).href);await expect.poll(()=>page.locator('video').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames),{timeout:30000}).toBeGreaterThan(0);
 await page.locator('video').evaluate(v=>{window.__soak={loads:0,waiting:0,stalled:0};for(const name of ['loadstart','waiting','stalled'])v.addEventListener(name,()=>window.__soak[name==='loadstart'?'loads':name]++);});
 const started=performance.now();let lastFrames=0;
 for(let step=0;performance.now()-started<seconds*1000;step++){
   const pause=step%6===5;await page.locator('video').evaluate((v,pause)=>pause?v.pause():v.play(),pause);
   if(step%6===0){copyFileSync(sample,path.join(media,`Owned discovered ${step}.mp4`));await api('/api/scan','POST');}
   if(step%6===0)for(const row of rows.slice(0,8))await api(`/api/media/${row.id}/thumbnail/retry`,'POST',{});
   await delay(10000);
   const state=await page.locator('video').evaluate(v=>({...window.__soak,time:v.currentTime,paused:v.paused,frames:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames,heap:performance.memory?.usedJSHeapSize||null,source:v.currentSrc}));
   const thumbnails=await api('/api/thumbnails'),scan=await api('/api/scan');
   const memory=await desktop.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,workingSetKB:m.memory.workingSetSize})));
   if(!pause)assert.ok(state.frames>lastFrames,'actual decoded frames must advance');lastFrames=state.frames;
   assert.equal(state.loads,0,'background work must not reload the playback source');assert.equal(thumbnails.failed,0);assert.ok(!thumbnails.error);assert.notEqual(scan.state,'failed');assert.equal(scan.error_count,0);
   measurements.push({elapsedMs:Math.round(performance.now()-started),...state,source:undefined,thumbnails,scan:{state:scan.state,errors:scan.error_count},memory});
   if(step%6===5)console.log(JSON.stringify({elapsedSeconds:Math.round((performance.now()-started)/1000),frames:state.frames,dropped:state.dropped,waiting:state.waiting,published:thumbnails.published,pending:thumbnails.pending}));
 }
 assert.ok(measurements.some(m=>m.thumbnails.yielding),'playing must defer cover generation');
 assert.ok(measurements.some(m=>m.thumbnails.published>measurements[0].thumbnails.published),'pause windows must allow covers to publish');
 assert.equal(digest(),original);assert.deepEqual(errors,[]);
 const health=await api('/api/health');await closeDesktop(desktop);desktop=null;await assert.rejects(()=>fetch(`http://127.0.0.1:${health.port||new URL(page.url()).port}/api/health`,{signal:AbortSignal.timeout(1000)}));cleanExit=true;
}finally{
 try{if(desktop)await closeDesktop(desktop);}finally{
 const report=JSON.stringify({seconds,cleanExit,errors,measurements,limitations:['Generated H.264 MP4; no user media; developer Electron with software GPU flags; bounded soak, not all-day or real-codec acceptance; pause windows intentionally let covers run. Memory is sampled, not proof of leak freedom.']},null,2);
 writeFileSync(path.join(workspace,'soak.json'),report);
 const artifact=path.join(root,'build','concurrent-soak-'+path.basename(workspace));mkdirSync(artifact,{recursive:true});writeFileSync(path.join(artifact,'soak.json'),report,{flag:'wx'});
 console.log('Owned soak report:',path.join(workspace,'soak.json'));
 }
}
