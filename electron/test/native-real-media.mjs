// Explicit opt-in, read-only originals. Writes only to this owned build clone.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const index=process.argv[2],ids=process.argv.slice(3).map(Number);
assert.ok(index&&path.isAbsolute(index)&&ids.length&&ids.every(Number.isSafeInteger),'Provide authorized index and explicit media IDs');
mkdirSync(path.join(root,'build'),{recursive:true});const data=mkdtempSync(path.join(root,'build','mpv-real-'));
const cloned=spawnSync('python',['-c',`import os,sqlite3,json
from pathlib import Path
source=sqlite3.connect(Path(os.environ['AVHUB_NATIVE_INDEX']).resolve().as_uri()+'?mode=ro',uri=True)
target=sqlite3.connect(str(Path(os.environ['AVHUB_NATIVE_CLONE'])/'library.db'));source.backup(target);source.close()
ids=json.loads(os.environ['AVHUB_NATIVE_IDS']);placeholders=','.join('?' for _ in ids)
target.execute('DELETE FROM media WHERE id NOT IN ('+placeholders+')',ids)
tables={row[0] for row in target.execute('SELECT name FROM sqlite_master')}
for table in ('preferences','root_file_permissions'):
 if table in tables:target.execute('DELETE FROM '+table)
target.execute('UPDATE media SET custom_cover=NULL,progress=0,watched=0')
target.commit();target.close()`],{env:{...process.env,AVHUB_NATIVE_INDEX:index,AVHUB_NATIVE_CLONE:data,AVHUB_NATIVE_IDS:JSON.stringify(ids)},encoding:'utf8',windowsHide:true});
assert.equal(cloned.status,0,cloned.stderr);
let desktop;const samples=[];
try{
  desktop=await _electron.launch({args:[root,'--no-sandbox'],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  await page.evaluate(async()=>{await fetch('/api/thumbnails/pause',{method:'POST'});});
  await page.evaluate(async()=>{await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{audio:{volume:0,muted:true},resumeBehavior:'restart'}})});});
  for(const id of ids){
    const media=await page.evaluate(async id=>(await(await fetch(`/api/media/${id}`)).json()),id);
    const original=statSync(media.path);
    const result=await page.evaluate(id=>window.avhubDesktop.nativePlayer('open',{mediaId:id,start:0}),id);
    const overlay=desktop.windows().find(p=>p.url().includes(`nativePlayer=${result.session}`));assert.ok(overlay);
    const state=()=>overlay.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
    await expect.poll(async()=>(await state()).phase,{timeout:30000}).toBe('ready');
    const command=(action,value)=>overlay.evaluate(({session,action,value})=>window.avhubDesktop.nativePlayer(action,{session,value}),{session:result.session,action,value});
    await command('pause',true);const startup=await state();
    const points=[5,10,5,Math.min(media.duration*.7,400),Math.min(media.duration*.7,400)-10,Math.min(media.duration*.7,400)+5];
    const seeks=[];
    for(const target of points){
      await command('seek',target);
      await expect.poll(async()=>(await state()).pendingSeek,{timeout:30000}).toBe(null);
      const snapshot=await state();assert.ok(Math.abs(Number(snapshot.properties['time-pos'])-target)<.5,JSON.stringify({id,target,actual:snapshot.properties['time-pos'],phase:snapshot.phase,error:snapshot.error,pending:snapshot.pendingSeek}));
      seeks.push({target,actual:snapshot.properties['time-pos'],restartMs:snapshot.lastSeekMs,totalIntentMs:snapshot.lastSeekTotalMs,bufferingEvents:snapshot.bufferingEvents,sourceLoads:snapshot.sourceLoads});
    }
    const screenshot=await command('screenshot');assert.equal(screenshot.width,media.width);assert.equal(screenshot.height,media.height);
    const ending=await state();
    assert.equal(ending.sourceLoads,1,'seeks must not reopen the original');
    await page.evaluate(session=>window.avhubDesktop.nativePlayer('close',session),result.session);
    const after=statSync(media.path);assert.equal(after.size,original.size);assert.equal(after.mtimeMs,original.mtimeMs);
    const chromium=[];
    if(process.env.AVHUB_COMPARE_CHROMIUM==='1'){
      await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows()[0];main.show();main.focus();});
      await page.goto(new URL(`/?video=${id}`,page.url()).href);
      await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('visible');
      await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2),{timeout:45000}).toBe(true);
      await page.locator('video').evaluate(v=>v.pause());
      for(const target of points){
        chromium.push(await page.locator('video').evaluate((v,target)=>new Promise(resolve=>{
          const started=performance.now(),source=v.currentSrc;let frame;
          const done=result=>{clearTimeout(timer);if(frame)v.cancelVideoFrameCallback(frame);resolve({...result,sourceReloaded:source!==v.currentSrc});};
          const timer=setTimeout(()=>done({target,timeout:true,actual:v.currentTime}),15000);
          const observe=(_now,metadata)=>{if(!v.seeking&&Math.abs(metadata.mediaTime-target)<.5)done({target,actual:metadata.mediaTime,frameMs:performance.now()-started});else frame=v.requestVideoFrameCallback(observe);};
          frame=v.requestVideoFrameCallback(observe);v.currentTime=target;
        }),target));
      }
    }
    samples.push({id,codec:media.video_codec,width:media.width,height:media.height,duration:media.duration,startupMs:startup.firstFrameMs,hwdec:ending.properties['hwdec-current'],decodedPixelFormat:ending.properties['video-params']?.pixelformat,seeks,chromium,screenshot:{width:screenshot.width,height:screenshot.height},sourceSizeAndMtimeUnchanged:true});
  }
  await desktop.close();desktop=null;
  const result={samples,limitations:['Read-only indexed originals; screenshots and index clone remain in owned build directory.','MPV playback-restart plus actual time and full-resolution decoded PNG; not a display latency/HDR correctness or comparative Chromium benchmark.','Native window pixel visibility, mixed-DPI and overlay ordering need interactive desktop acceptance.']};
  writeFileSync(path.join(data,'native-real.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));console.log('Read-only native report:',data);
}catch(error){console.error(error);if(desktop)await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});}
