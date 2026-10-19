// Visible Electron application benchmark. All playback actions use real UI;
// snapshot reads measure decoded restart, not ACK or loading-indicator timing.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {nativeProcessMetrics} from './native-owned-process.mjs';
const root=path.resolve(import.meta.dirname,'../..'),index=process.argv[2],ids=process.argv.slice(3).map(Number);
assert.ok(index&&path.isAbsolute(index)&&ids.length&&ids.every(id=>Number.isSafeInteger(id)&&id>0));
mkdirSync(path.join(root,'build'),{recursive:true});const data=mkdtempSync(path.join(root,'build','native-app-performance-'));
const cloned=spawnSync('python',['-c',`import os,sqlite3,json
from pathlib import Path
s=sqlite3.connect(Path(os.environ['PERF_INDEX']).resolve().as_uri()+'?mode=ro',uri=True)
t=sqlite3.connect(str(Path(os.environ['PERF_DATA'])/'library.db'));s.backup(t);s.close()
ids=json.loads(os.environ['PERF_IDS']);t.execute('DELETE FROM media WHERE id NOT IN ('+','.join('?' for _ in ids)+')',ids)
for name in ('preferences','root_file_permissions'):t.execute('DELETE FROM '+name)
t.execute('UPDATE media SET custom_cover=NULL,progress=0,watched=0');t.commit();t.close()`],{env:{...process.env,PERF_INDEX:index,PERF_DATA:data,PERF_IDS:JSON.stringify(ids)},encoding:'utf8',windowsHide:true});assert.equal(cloned.status,0,cloned.stderr);
let desktop;const samples=[];
console.log('Application performance fixture:',data);
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const parentPid=await desktop.evaluate(()=>process.pid);
 // Optional isolated comparison of the old MPV command transport only. This
 // changes no production file and never relaxes exact positioning/quality.
 if(process.env.AVHUB_PERF_COMMAND==='legacy')await desktop.evaluate((_,root)=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json');
  const {MpvClient}=require(root+'/electron/dist/mpvClient.js'),command=MpvClient.prototype.command;
  MpvClient.prototype.command=function(c,timeout){return command.call(this,c[0]==='set_property'&&c[1]==='time-pos'?['seek',c[2],'absolute+exact']:c,timeout);};
 },root);
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await api('/api/thumbnails/pause','POST');await page.reload();
 for(const id of ids){
  const media=await api(`/api/media/${id}`),before=statSync(media.path);assert.ok(media.duration>40);
  for(let cycle=0;cycle<3;cycle++){
   const opened=performance.now();await page.getByRole('button',{name:`播放 ${media.title}`,exact:true}).click();
   await expect(page.getByText('MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:30000});
   await expect.poll(()=>desktop.windows().some(w=>w.url().includes('nativePlayer=')),{timeout:30000,intervals:[20]}).toBe(true);
   const overlay=desktop.windows().find(w=>w.url().includes('nativePlayer=')),snapshot=()=>overlay.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
   await expect.poll(async()=>{const s=await snapshot();return s.phase==='ready'&&Number(s.properties['time-pos'])>.05;},{timeout:30000,intervals:[20]}).toBe(true);
   const initial=await snapshot(),openToFrameMs=performance.now()-opened;
   const reveal=async()=>{await overlay.bringToFront();await overlay.mouse.move(200,100);await overlay.mouse.move(100,(await overlay.evaluate(()=>innerHeight))-30);};
   await reveal();await overlay.getByRole('button',{name:'暂停',exact:true}).click();await expect.poll(async()=>(await snapshot()).properties.pause).toBe(true);
   const counters=()=>process.env.AVHUB_PERF_IO==='1'?nativeProcessMetrics(parentPid)[0]:null;
   const ioBefore=counters();
   const slider=overlay.getByRole('slider',{name:'播放进度',exact:true});await slider.evaluate(el=>el.addEventListener('input',()=>window.__lastPerfTarget=Number(el.value)));
   const timings=[];
   for(const fraction of [.35,.6,.2]){
    await reveal();const box=await slider.boundingBox();await slider.click({position:{x:box.width*fraction,y:box.height/2}});
    const target=await overlay.evaluate(()=>window.__lastPerfTarget);
    await expect.poll(async()=>{const s=await snapshot();return s.pendingSeek===null&&Math.abs(Number(s.properties['time-pos'])-target)<.5;},{timeout:30000,intervals:[20]}).toBe(true);
    const s=await snapshot();timings.push({kind:'click',target,actual:s.properties['time-pos'],ms:s.lastSeekTotalMs});
   }
   // Real key events, 40 ms apart: final target must not wait for obsolete frames.
   const at=Number((await snapshot()).properties['time-pos']),burstStarted=performance.now();
   for(let n=0;n<3;n++){await overlay.keyboard.press('ArrowRight');if(n<2)await new Promise(r=>setTimeout(r,40));}
   await expect.poll(async()=>{const s=await snapshot();return s.pendingSeek===null&&Math.abs(Number(s.properties['time-pos'])-(at+15))<.5;},{timeout:30000,intervals:[20]}).toBe(true);
   const s=await snapshot();timings.push({kind:'burst',target:at+15,actual:s.properties['time-pos'],ms:s.lastSeekTotalMs,firstKeyToFrameMs:performance.now()-burstStarted});
   const ioAfter=counters();
   // Also exercise playback in progress, including reversal, then prove the
   // clock continues instead of declaring a command ACK successful.
   await reveal();await overlay.getByRole('button',{name:'播放',exact:true}).click();
   await expect.poll(async()=>(await snapshot()).properties.pause).toBe(false);
   const playingStart=Number((await snapshot()).properties['time-pos']);
   for(const key of ['ArrowRight','ArrowRight','ArrowLeft']){await overlay.keyboard.press(key);await new Promise(r=>setTimeout(r,40));}
   await expect.poll(async()=>{const s=await snapshot(),p=Number(s.properties['time-pos']);return s.pendingSeek===null&&p>playingStart+4.5&&p<playingStart+6;},{timeout:30000,intervals:[20]}).toBe(true);
   const playing=await snapshot();timings.push({kind:'playing-reversal',actual:playing.properties['time-pos'],ms:playing.lastSeekTotalMs});
   await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:5000,intervals:[20]}).toBeGreaterThan(Number(playing.properties['time-pos'])+.3);
   assert.equal(s.sourceLoads,1);assert.equal(s.properties['video-params'].w,media.width);assert.equal(s.properties['video-params'].h,media.height);
   samples.push({id,cycle,codec:s.properties['video-codec'],hwdec:s.properties['hwdec-current'],width:media.width,height:media.height,openToFrameMs,firstFrameMs:initial.firstFrameMs,startup:initial.startupTimings,sourceLoads:s.sourceLoads,bufferingEvents:s.bufferingEvents,corrections:s.seekCorrections,io:ioBefore&&ioAfter?{scope:'owned-mpv-process counters; includes cache hits, not physical disk throughput',readBytes:Number(ioAfter.ReadTransferCount)-Number(ioBefore.ReadTransferCount),writeBytes:Number(ioAfter.WriteTransferCount)-Number(ioBefore.WriteTransferCount)}:'not-sampled',timings});
   await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(ids.length);
   const after=statSync(media.path);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);
  }
 }
 writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({command:process.env.AVHUB_PERF_COMMAND==='legacy'?'legacy-seek-transport-only':'production',scope:'visible-electron-ui; decoded-time validation; not photon latency or cold-disk benchmark',samples},null,2));console.log('Application performance passed:',data);
}catch(error){writeFileSync(path.join(data,'failure.json'),JSON.stringify({error:String(error),samples},null,2));if(desktop)await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});}
