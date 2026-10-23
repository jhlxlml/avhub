// Real Electron, normal GPU/sandbox, owned media. Resource diagnosis, not FPS benchmark.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,copyFileSync,readFileSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),folder=ownedTemporaryWorkspace('avhub-privacy-memory-');
const media=path.join(folder,'media');mkdirSync(media);
const source=path.join(media,'Owned 000.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12','-t','5','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',source],{windowsHide:true,timeout:30000}).status,0);
for(let i=1;i<96;i++)copyFileSync(source,path.join(media,`Owned ${String(i).padStart(3,'0')}.mp4`));
const identity=()=>({sha:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs}),before=identity();
const report={build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),completed:false,errors:[],samples:[],limitations:['Generated 320x180 SDR media, 96 covers, normal GPU with attached diagnostic transport; not real 4K/HDR or isolated FPS acceptance.','Forced collection is labelled diagnostic only; do not interpret it as natural working-set recovery.','Brief concurrent backend/renderer regression may add CPU/I/O load.']};
let desktop,page,cdp;
const persist=()=>writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify(report,null,2));
async function sample(label){
 const dom=await cdp.send('Memory.getDOMCounters'),metrics=await cdp.send('Performance.getMetrics');
 const heap=Object.fromEntries(metrics.metrics.filter(m=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','JSEventListeners'].includes(m.name)).map(m=>[m.name,m.value]));
 const processes=await desktop.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,workingSetKiB:m.memory.workingSetSize})));
 const mediaNodes=await page.locator('video').count();const value={label,dom,heap,processes,mediaNodes};report.samples.push(value);persist();return value;
}
try{
 desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:path.join(folder,'profile'),AVHUB_APP_HOME:folder,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
 await api('/api/preferences','PATCH',{values:{hoverPreview:true,playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:60000}).toBe('completed');
 await expect.poll(async()=>{const t=await api('/api/thumbnails');return t.pending===0&&t.current===null;},{timeout:60000}).toBe(true);
 await page.reload();await expect(page.locator('.card')).toHaveCount(48);
 const image=page.locator('.card [data-private-media]').first();await expect(image).toHaveClass(/thumbnail-ready/);
 await page.getByRole('button',{name:'开启隐私模式',exact:true}).click();await expect(image).toHaveCSS('filter','blur(22px)');
 await expect.poll(async()=>(await api('/api/preferences')).values.privacyMode).toBe(true);
 await page.evaluate(()=>localStorage.removeItem('avhub.privacyMode'));await page.reload();await expect(page.getByRole('button',{name:'关闭隐私模式',exact:true})).toBeVisible();await expect(image).toHaveCSS('filter','blur(22px)');
 await page.locator('.card .open-video').first().click();const video=page.locator('.player-shell video');
 await expect.poll(()=>video.evaluate(v=>v.readyState>=2&&!v.paused&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:30000}).toBe(true);
 await expect(video).toHaveCSS('filter','none');const frames=await video.evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames);await delay(400);assert.ok(await video.evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames)>frames);
 await video.evaluate(v=>v.pause());await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.player-shell')).toHaveCount(0);
 await page.getByRole('button',{name:'关闭隐私模式',exact:true}).click();await expect(image).toHaveCSS('filter','none');
 report.privacy={persistedWithoutLocalCache:true,activeVideoUnfiltered:true,decodedFramesAdvanced:true};
 // Disable preview for the allocation comparison, not to obtain a passing soak.
 // The prior concurrent soak retains its preview/drop measurements unchanged.
 await api('/api/preferences','PATCH',{values:{hoverPreview:false}});await page.reload();
 cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 await sample('initial');
 for(let cycle=0;cycle<24;cycle++){
  await page.mouse.move(0,0);await page.locator('.card .open-video').first().click();
  await expect.poll(()=>video.evaluate(v=>v.readyState>=2&&!v.paused&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:15000}).toBe(true);
  await delay(200);await video.evaluate(v=>v.pause());await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.player-shell')).toHaveCount(0);
  await page.getByRole('button',{name:cycle%2?'上一页':'下一页',exact:true}).click();await expect(page.locator('.card')).toHaveCount(48);
  if([3,7,15,23].includes(cycle)){await sample(`cycle-${cycle+1}`);console.log('Resource cycle',cycle+1);}
 }
 await delay(15000);await sample('natural-idle-15s');
 await cdp.send('HeapProfiler.collectGarbage');const collected=await sample('forced-gc-diagnostic');
 assert.equal(collected.mediaNodes,0);assert.deepEqual(identity(),before);assert.deepEqual(report.errors,[]);
 report.databaseTiming=(await api('/api/diagnostics')).database_timing;
 report.completed=true;report.sourceUnchanged=true;
}catch(error){report.failure=String(error);if(page)await page.screenshot({path:path.join(folder,'failure.png')}).catch(()=>{});throw error;}
finally{
 if(cdp)await cdp.detach().catch(()=>{});if(desktop)await desktop.close();persist();
 const artifacts=path.join(root,'build',path.basename(folder));mkdirSync(artifacts,{recursive:true});
 copyFileSync(path.join(folder,'acceptance.json'),path.join(artifacts,'acceptance.json'));
 if(existsSync(path.join(folder,'failure.png')))copyFileSync(path.join(folder,'failure.png'),path.join(artifacts,'failure.png'));
 console.log('Privacy/resource evidence:',folder);
}
