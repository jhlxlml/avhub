// Natural-media desktop measurement. Original files are read only; cloned
// indexes and all generated state stay in build/. No source paths/titles in
// the report. Timing uses decoded callbacks / completed GPU frame receipts;
// image hashes prove different pictures, not an independent reference frame.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,statSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),index=path.resolve(process.argv[2]??''),id=Number(process.argv[3]);
assert.ok(process.argv[2]&&Number.isSafeInteger(id)&&id>0);
const data=mkdtempSync(path.join(root,'build/render-real-seek-'));
const copy=spawnSync('python',['-c',`import os,sqlite3,json
from pathlib import Path
s=sqlite3.connect(Path(os.environ['REAL_SEEK_INDEX']).as_uri()+'?mode=ro',uri=True)
t=sqlite3.connect(str(Path(os.environ['REAL_SEEK_DATA'])/'library.db'));s.backup(t);s.close()
t.execute('DELETE FROM media WHERE id<>?',(int(os.environ['REAL_SEEK_ID']),))
for name in ('preferences','root_file_permissions'):t.execute('DELETE FROM '+name)
t.execute('UPDATE media SET progress=0,watched=0,custom_cover=NULL');t.commit();t.close()`],{env:{...process.env,REAL_SEEK_INDEX:index,REAL_SEEK_DATA:data,REAL_SEEK_ID:String(id)},windowsHide:true,encoding:'utf8',timeout:30000});
assert.equal(copy.status,0,copy.stderr);
const fractions=[.073,.61,.25,.87,.4,.16,.72,.52,.93,.32,.81,.11,.46,.67,.21,.57,.36,.76,.89,.043];
const report={kind:'real-electron-natural-media-seek',scope:'Paused seeks; decoded video callbacks or completed native GPU receipts. No physical scanout, independent natural-frame reference or cold-disk claim.',build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),runtime:JSON.parse(readFileSync(path.join(root,'build/native-render/runtime.json'),'utf8')),rows:[],completed:false};
const identity=async file=>{const s=statSync(file),hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return {sha256:hash.digest('hex'),size:s.size,mtimeMs:s.mtimeMs};};
let desktop,page,source,before;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 const media=await api(`/api/media/${id}`);source=media.path;assert.ok(path.resolve(source).toLowerCase().startsWith('e:\\downloads\\'),'Only explicitly authorized read-only media');assert.ok(media.duration>30);before=await identity(source);report.source={...before,codec:media.video_codec,width:media.width,height:media.height,duration:media.duration};await api('/api/thumbnails/pause','POST');
 for(const engine of ['chromium','mpv']){
  await api('/api/preferences','PATCH',{values:{playerEngine:engine,nativeRenderEnabled:engine==='mpv',resumeBehavior:'restart',autoNext:false,hoverPreview:false,audio:{volume:0,muted:true}}});await page.reload();
  const row={engine,seeks:[],network:[],sourceRequests:0};report.rows.push(row);const pending=new Set();let playback;
  const observe=response=>{const task=(async()=>{const pathname=new URL(response.url()).pathname,request=response.request();if(request.method()==='POST'&&pathname===`/api/media/${id}/playback`){row.sourceRequests++;playback=await response.json();}if(pathname.startsWith('/media/')){const headers=response.headers();row.network.push({pathname,stage:'response-headers',status:response.status(),timing:request.timing(),serverTiming:headers['server-timing']??null,cache:headers['x-avhub-fragment-cache']??null});}})().catch(error=>row.network.push({error:String(error)}));pending.add(task);void task.finally(()=>pending.delete(task));};page.on('response',observe);
  await page.evaluate(()=>{window.__realNative=null;window.__realStarted=performance.now();window.avhubDesktop.onRenderState(s=>{window.__realNative=s;if(!window.__realFirst&&s.phase==='ready'&&s.presented)window.__realFirst={ms:performance.now()-window.__realStarted,position:s.presented.positionSec};});const attached=new WeakSet();const attach=()=>{for(const video of document.querySelectorAll('video'))if(!attached.has(video)){attached.add(video);video.requestVideoFrameCallback((now,frame)=>{if(!window.__realFirst)window.__realFirst={ms:now-window.__realStarted,position:frame.mediaTime};});}};new MutationObserver(attach).observe(document.body,{childList:true,subtree:true});attach();});
  await page.locator('.card').getByRole('button',{name:/^播放 /}).click();
  await expect.poll(()=>page.evaluate(()=>window.__realFirst),{timeout:30000}).toBeTruthy();row.first=await page.evaluate(()=>window.__realFirst);
  if(engine==='chromium'){
   await expect.poll(()=>playback,{timeout:30000}).toBeTruthy();row.delivery=playback.delivery||'direct';assert.equal(row.delivery,'direct','Do not silently compare another route');await expect.poll(()=>page.locator('video').evaluate(v=>v.paused)).toBe(false);await page.keyboard.press('Space');await expect.poll(()=>page.locator('video').evaluate(v=>v.paused)).toBe(true);
   for(const fraction of fractions){const target=media.duration*fraction;
    const result=await page.evaluate(target=>new Promise((resolve,reject)=>{const v=document.querySelector('video'),slider=document.querySelector('input[aria-label="视频完整进度"]'),start=performance.now();let callback,candidate;const finish=()=>{if(candidate&&!v.seeking&&Math.abs(v.currentTime-target)<.15){clearTimeout(timer);v.removeEventListener('seeked',finish);resolve({...candidate,ms:performance.now()-start});}};const timer=setTimeout(()=>{v.cancelVideoFrameCallback(callback);v.removeEventListener('seeked',finish);reject(new Error('Natural-media target frame timeout'));},15000);v.addEventListener('seeked',finish);const frame=(now,metadata)=>{if(Math.abs(metadata.mediaTime-target)<.1){candidate={target,actual:metadata.mediaTime,decodedMs:now-start};finish();}else callback=v.requestVideoFrameCallback(frame);};callback=v.requestVideoFrameCallback(frame);slider.value=String(target);slider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));}),target);
    const png=await page.locator('video').screenshot();row.seeks.push({...result,imageSha256:createHash('sha256').update(png).digest('hex')});
   }
   row.quality=await page.locator('video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,total:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames}));
  }else{
   row.delivery='libmpv-render-d3d11';await expect.poll(()=>page.evaluate(()=>window.__realNative?.properties.pause)).toBe(false);await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__realNative.properties.pause)).toBe(true);
   for(const fraction of fractions){const target=media.duration*fraction;
    const result=await page.evaluate(target=>new Promise((resolve,reject)=>{const old=window.__realNative.presented,slider=document.querySelector('input[aria-label="播放进度"]'),start=performance.now();let off;const timer=setTimeout(()=>{off?.();reject(new Error('Natural-media native target timeout'));},15000);off=window.avhubDesktop.onRenderState(s=>{if(s.phase==='ready'&&s.pendingSeek===null&&s.presented?.serial>old.serial&&s.presented.seekId>old.seekId&&Math.abs(s.presented.positionSec-target)<.1){clearTimeout(timer);off();resolve({target,actual:s.presented.positionSec,seekId:s.presented.seekId,ms:performance.now()-start});}});slider.value=String(target);slider.dispatchEvent(new Event('input',{bubbles:true}));}),target);
    const png=await page.locator('.native-render-canvas').screenshot();row.seeks.push({...result,imageSha256:createHash('sha256').update(png).digest('hex')});
   }
   const state=await page.evaluate(()=>window.__realNative);row.sourceLoads=state.sourceLoads;row.properties=state.properties;assert.equal(state.sourceLoads,1);assert.deepEqual(state.videoSize,{width:media.width,height:media.height});
  }
  const sorted=row.seeks.map(s=>s.ms).sort((a,b)=>a-b);row.p50=(sorted[9]+sorted[10])/2;row.p95=sorted[18];row.max=sorted[19];row.distinctPictures=new Set(row.seeks.map(s=>s.imageSha256)).size;assert.ok(row.distinctPictures>1);
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);page.off('response',observe);await Promise.all([...pending]);
 }
 assert.deepEqual(await identity(source),before);report.sourceUnchanged=true;report.completed=true;
}catch(error){report.error=String(error.stack||error);if(page)report.state=await page.evaluate(()=>window.__realNative).catch(()=>null);throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({completed:report.completed,report:path.join(data,'report.json'),rows:report.rows.map(r=>({engine:r.engine,delivery:r.delivery,p50:r.p50,p95:r.p95,seeks:r.seeks.length}))}));}
