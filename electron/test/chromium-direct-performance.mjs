// Explicit read-only real Electron diagnostic, not MPV or a browser product test.
// TEMP profile only. Production flags/security/decoder selection remain unchanged.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,statSync,statfsSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const option=(key,fallback)=>process.argv.find(value=>value.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const index=option('index',undefined),id=Number(option('id','0')),seconds=Number(option('seconds','20')),at=Number(option('at','0'));
const lossless=process.argv.includes('--lossless');
assert.ok(index&&path.isAbsolute(index),'Explicit authorized SQLite index required');
assert.ok(Number.isSafeInteger(id)&&id>0);
assert.ok(Number.isInteger(seconds)&&seconds>=15&&seconds<=60);
assert.ok(Number.isFinite(at)&&at>=0);
const workspace=ownedTemporaryWorkspace('avhub-chromium-direct-'),profile=path.join(workspace,'profile');mkdirSync(profile);
const clone=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',`
import os,sqlite3,json
from pathlib import Path
source=Path(os.environ['AVHUB_DIAGNOSTIC_INDEX']).resolve(strict=True)
target=Path(os.environ['AVHUB_DIAGNOSTIC_PROFILE']).resolve(strict=True)
src=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)
src.row_factory=sqlite3.Row
row=src.execute('SELECT * FROM media WHERE id=?',(int(os.environ['AVHUB_DIAGNOSTIC_ID']),)).fetchone()
assert row
item=dict(row);media=Path(item['path']).resolve(strict=True)
assert media.is_relative_to(Path('E:/downloads').resolve()) and media.suffix.lower()=='.mp4'
dst=sqlite3.connect(target/'library.db');src.backup(dst);src.close()
dst.execute('DELETE FROM media WHERE id<>?',(item['id'],))
tables={r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
for table in ('thumbnail_jobs','file_operations','recycle_actions','source_changes','media_subtitle_links','scan_checkpoint','root_file_permissions'):
 if table in tables:dst.execute('DELETE FROM '+table)
dst.execute('INSERT OR REPLACE INTO thumbnail_control(id,paused) VALUES(1,1)')
dst.execute('UPDATE media SET progress=0,watched=0,missing=0,thumbnail=NULL,custom_cover=NULL')
dst.execute('DELETE FROM preferences')
for key,value in dict(playerEngine='chromium',playbackSpeed=1,resumeBehavior='restart',hoverPreview=False,nativePrepare=False,audio=dict(volume=0,muted=True),autoplay=dict(enabled=False,mode='sequential',scope='series')).items():
 dst.execute('INSERT INTO preferences(key,value,updated_at) VALUES(?,?,0)',(key,json.dumps(value)))
dst.commit();dst.close()
print(json.dumps({'path':str(media),'id':item['id'],'duration':item['duration'],'codec':item['video_codec'],'width':item['width'],'height':item['height']}))
`],{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000,env:{...process.env,PYTHONUTF8:'1',AVHUB_DIAGNOSTIC_INDEX:index,AVHUB_DIAGNOSTIC_PROFILE:profile,AVHUB_DIAGNOSTIC_ID:String(id)}});
assert.equal(clone.status,0,clone.stderr);const fixture=JSON.parse(clone.stdout);
assert.ok(at+seconds+5<fixture.duration,'Diagnostic segment must fit inside the source');
const identity=()=>{const s=statSync(fixture.path,{bigint:true});return{size:String(s.size),mtimeNs:String(s.mtimeNs)};},before=identity();
let control=null,segmentAt=at;
if(process.argv.includes('--stream-copy-control')){
 const disk=statfsSync(workspace);assert.ok(disk.bavail*disk.bsize>512*1024**2,'Control requires at least 512 MiB free space');
 const target=path.join(workspace,'owned-stream-copy-control.mp4'),capacity=64*1024**2;
 const begun=performance.now();
 const result=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-nostdin','-ss',String(at),'-i',fixture.path,'-t','35','-map','0','-c','copy','-map_metadata','0','-movflags','+faststart','-fs',String(capacity),target],{windowsHide:true,encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stderr);assert.ok(statSync(target).size<capacity-1024**2,'Control exceeded its capacity margin');
 const probed=spawnSync(path.join(root,'bin/ffprobe.exe'),['-v','error','-show_entries','format=duration:stream=index,codec_name,codec_type,width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries','-of','json',target],{windowsHide:true,encoding:'utf8',timeout:15000});
 assert.equal(probed.status,0,probed.stderr);const metadata=JSON.parse(probed.stdout);
 assert.ok(Number(metadata.format.duration)>seconds+5);segmentAt=0;
 const update=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',`import sqlite3,os;from pathlib import Path
p=Path(os.environ['AVHUB_CONTROL']);s=p.stat();d=sqlite3.connect(Path(os.environ['AVHUB_PROFILE'])/'library.db')
d.execute("UPDATE media SET path=?,name='owned-control.mp4',title='无损交织对照',duration=?,size=?,modified=?,source_identity=NULL,file_state='normal'",(str(p),float(os.environ['AVHUB_DURATION']),s.st_size,s.st_mtime));d.commit();d.close()`],{windowsHide:true,encoding:'utf8',timeout:15000,env:{...process.env,AVHUB_CONTROL:target,AVHUB_PROFILE:profile,AVHUB_DURATION:metadata.format.duration}});
 assert.equal(update.status,0,update.stderr);
 control={streamCopy:true,seconds:Number(metadata.format.duration),bytes:statSync(target).size,generationMs:performance.now()-begun,streams:metadata.streams,capacityBytes:capacity,scope:'Owned bounded 35-second control only, not a production full-file cache or exact frame comparison'};
}
const probe=spawnSync(path.join(root,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,profile,level,pix_fmt,width,height,r_frame_rate,avg_frame_rate,bit_rate:format=duration,size,bit_rate','-of','json',fixture.path],{windowsHide:true,encoding:'utf8',timeout:30000});
assert.equal(probe.status,0,probe.stderr);
const report={completed:false,sourceUnchanged:false,cleanExit:false,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),source:JSON.parse(probe.stdout),control,lossless,segmentStart:at,stages:[],seeks:[],attempts:[],byteRanges:[],fragments:[],limitations:[
 'Single local real MP4, not the remote computer or reported file.',
 'Visible hardware-enabled Electron; no disable-GPU, in-process-GPU or no-sandbox switches.',
 'Playwright/CDP used for diagnostics; not a no-inspector memory acceptance or cold-disk benchmark.',
 'Muted browser output; physical sound/lip-sync and HDR appearance are not accepted.',
 'The flattened-composition stage uses a temporary CSS override only; not a production fix.'
]};
let desktop,page,exit=null;
const reportPath=path.join(workspace,'performance.json');
const flush=()=>writeFileSync(reportPath,JSON.stringify(report,null,2));
try{
 const env={...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:workspace,AVHUB_SMOKE_TEST:'0',AVHUB_HEADLESS_TEST:'0'};
 delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 desktop=await _electron.launch({args:[root],cwd:workspace,env,timeout:60000});
 desktop.process().once('exit',(code,signal)=>{exit={code,signal};});
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();});
 report.decoderCapture=await desktop.evaluate(async({BrowserWindow})=>{
  const wc=BrowserWindow.getAllWindows()[0].webContents;
  try{
   wc.debugger.attach('1.3');globalThis.__avhubDirectMedia={properties:{},errors:[]};
   const listener=(_,method,params)=>{
    if(method==='Media.playerPropertiesChanged')for(const p of params.properties??[]){
     if(/decoder|platform|codec|video_track|resolution|frame_rate/i.test(p.name))globalThis.__avhubDirectMedia.properties[p.name]=p.value;
    }
    if(method==='Media.playerErrorsRaised')for(const e of params.errors??[])globalThis.__avhubDirectMedia.errors.push({errorType:e.errorType,code:e.code});
   };globalThis.__avhubDirectListener=listener;wc.debugger.on('message',listener);
   await wc.debugger.sendCommand('Media.enable');return{attached:true};
  }catch(error){return{attached:false,error:String(error.message)};}
 });
 page.on('response',async response=>{
  if(/\/media\/hls\/[a-f0-9]+\/segment_\d+\.ts/.test(response.url()))report.fragments.push({status:response.status(),bytes:Number(response.headers()['content-length']??0)});
  if(response.url().endsWith(`/media/${id}/file`)){
   const range=response.request().headers().range;
   if(range)report.byteRanges.push({requested:range,status:response.status(),received:response.headers()['content-range']??null});
  }
  if(response.request().method()==='POST'&&response.url().endsWith(`/api/media/${id}/playback`))try{
   const s=await response.json();report.attempts.push({mode:s.mode,prepared:s.prepared===true,delivery:s.delivery??null});
  }catch{}
 });
 await page.goto(new URL(`/?video=${id}`,page.url()).href);
 await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2&&!v.paused&&v.videoWidth>0&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:60000}).toBe(true);
 const revealControls=async()=>{
  const bar=page.locator('.player-controls');await bar.scrollIntoViewIfNeeded();const box=await bar.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+4,box.y+4);await page.mouse.move(box.x+box.width/2,box.y+box.height-6);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
 };
 if(lossless){
  await revealControls();await page.getByRole('button',{name:'画质',exact:true}).click();const begun=performance.now();
  await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('lossless');
  await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/本次无损封装.*索引按需封装/,{timeout:60000});
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=3&&!v.paused&&v.videoWidth>0&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:60000}).toBe(true);
  report.losslessReadyMs=performance.now()-begun;flush();
 }
 await page.evaluate(()=>{
  const v=document.querySelector('video');globalThis.__avhubDirectObservation={events:[],frames:[],longTasks:0,longTaskMs:0};
  for(const name of ['waiting','stalled','seeking','seeked','loadstart','emptied','ratechange'])v.addEventListener(name,()=>globalThis.__avhubDirectObservation.events.push({name,at:performance.now(),time:v.currentTime}));
  new PerformanceObserver(list=>{for(const e of list.getEntries()){globalThis.__avhubDirectObservation.longTasks++;globalThis.__avhubDirectObservation.longTaskMs+=e.duration;}}).observe({type:'longtask'});
  const frame=(now,data)=>{globalThis.__avhubDirectObservation.frames.push({at:now,time:data.mediaTime,presented:data.presentedFrames,processing:data.processingDuration??null});if(globalThis.__avhubDirectObservation.frames.length>50000)globalThis.__avhubDirectObservation.frames.shift();v.requestVideoFrameCallback(frame);};
  v.requestVideoFrameCallback(frame);
 });
 const snapshot=()=>page.locator('video').evaluate(v=>{const q=v.getVideoPlaybackQuality(),o=globalThis.__avhubDirectObservation;let ahead=0;
  for(let n=0;n<v.buffered.length;n++)if(v.currentTime>=v.buffered.start(n)&&v.currentTime<=v.buffered.end(n))ahead=v.buffered.end(n)-v.currentTime;
  return{at:performance.now(),time:v.currentTime,paused:v.paused,rate:v.playbackRate,ready:v.readyState,ahead,total:q.totalVideoFrames,dropped:q.droppedVideoFrames,width:v.videoWidth,height:v.videoHeight,error:v.error?.code??null,visible:document.visibilityState==='visible',events:o.events.length,frames:o.frames.length,longTasks:o.longTasks,longTaskMs:o.longTaskMs,controlsHidden:document.querySelector('.video-wrap').classList.contains('controls-hidden')};
 });
 await delay(4000);
 for(const mode of process.argv.includes('--export-only')?[]:process.argv.includes('--baseline-only')?['normal-hidden','normal-recheck']:['normal-hidden','normal-controls','flat-composition','normal-recheck']){
  await page.locator('video').evaluate((v,target)=>{v.currentTime=target;},segmentAt);
  await expect.poll(()=>page.locator('video').evaluate((v,target)=>!v.seeking&&v.readyState>=3&&Math.abs(v.currentTime-target)<3,segmentAt),{timeout:30000}).toBe(true);
  await delay(3000);
  let override;
  if(mode==='normal-controls'){
   const bar=page.locator('.player-controls');await bar.scrollIntoViewIfNeeded();
   const box=await bar.boundingBox();assert.ok(box);
   await page.mouse.move(box.x+4,box.y+4);await page.mouse.move(box.x+box.width/2,box.y+box.height-6);
   await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  }
  else{
   await page.locator('video').hover({position:{x:50,y:50}});await page.mouse.move(2,2);await delay(800);
   if(mode==='flat-composition')override=await page.addStyleTag({content:'.video-wrap{border-radius:0!important;box-shadow:none!important}.video-canvas{will-change:auto!important;transform:none!important}.video-wrap video{left:0!important;top:0!important;transform:none!important}'});
  }
  const first=await snapshot(),originalRangeStart=report.byteRanges.length,fragmentStart=report.fragments.length,observations=[];await desktop.evaluate(({app})=>app.getAppMetrics());
  for(let i=0;i<seconds;i++){
   await delay(1000);observations.push({...await snapshot(),desktop:await desktop.evaluate(({app,BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0];return{focused:w.isFocused(),visible:w.isVisible(),refreshRate:screen.getDisplayMatching(w.getBounds()).displayFrequency,processes:app.getAppMetrics().map(p=>({type:p.type,cpu:p.cpu.percentCPUUsage,workingSetKiB:p.memory.workingSetSize}))};})});
  }
  const last=observations.at(-1),wall=(last.at-first.at)/1000;
  const frames=await page.evaluate(({from,to})=>globalThis.__avhubDirectObservation.frames.filter(f=>f.at>=from&&f.at<=to),{from:first.at,to:last.at});
  const sorted=frames.slice(1).map((f,i)=>f.at-frames[i].at).sort((a,b)=>a-b);
  const events=await page.evaluate(start=>globalThis.__avhubDirectObservation.events.slice(start),first.events);
  const processing=frames.map(f=>f.processing).filter(n=>typeof n==='number'&&n>=0).sort((a,b)=>a-b);
  const result={mode,wallSeconds:wall,clockSeconds:last.time-first.time,clockRatio:(last.time-first.time)/wall,totalFrames:last.total-first.total,droppedFrames:last.dropped-first.dropped,presentedCallbacks:frames.length,frameGapMs:{median:sorted[Math.floor(sorted.length/2)]??null,p95:sorted[Math.ceil(sorted.length*.95)-1]??null,max:sorted.at(-1)??null},decodeProcessingMs:{median:processing.length?processing[Math.floor(processing.length/2)]*1000:null,p95:processing.length?processing[Math.ceil(processing.length*.95)-1]*1000:null},events,longTasks:last.longTasks-first.longTasks,longTaskMs:last.longTaskMs-first.longTaskMs,observations};
  report.stages.push(result);flush();console.log(JSON.stringify({mode,clockRatio:result.clockRatio,frames:result.totalFrames,dropped:result.droppedFrames,callbacks:frames.length,events:events.map(e=>e.name)}));
  result.delivery={originalRanges:report.byteRanges.length-originalRangeStart,fragments:report.fragments.slice(fragmentStart)};
  assert.ok(observations.every(o=>o.visible&&o.rate===1&&!o.paused&&!o.error),'Visible 1x playback must be maintained');
  if(override)await override.evaluate(node=>node.remove());
 }
 report.decoder=await desktop.evaluate(()=>globalThis.__avhubDirectMedia??null);
 if(process.argv.includes('--seek')){
  for(const action of ['ArrowRight','ArrowLeft','l','j',.25,.8]){
   await revealControls();const first=await snapshot();let target=first.time;
   if(typeof action==='number'){
    const slider=page.getByRole('slider',{name:'视频完整进度'}),box=await slider.boundingBox();assert.ok(box);
    // Native range thumbs reserve half their width at both ends. Read the
    // application's committed value after a real click, not a guessed target.
    await slider.click({position:{x:box.width*action,y:box.height/2}});
    target=Number(await slider.inputValue());
   }else{target+=action==='ArrowRight'?5:action==='ArrowLeft'?-5:action==='l'?10:-10;await page.keyboard.press(action);}
   await expect.poll(()=>page.locator('video').evaluate((v,target)=>!v.seeking&&v.readyState>=3&&Math.abs(v.currentTime-target)<2,target),{timeout:30000}).toBe(true);
   const frame=await page.locator('video').evaluate(v=>new Promise(resolve=>v.requestVideoFrameCallback((now,data)=>resolve({at:now,time:data.mediaTime,presented:data.presentedFrames}))));
   const last=await snapshot();report.seeks.push({action,target,actual:frame.time,frameMs:frame.at-first.at,events:await page.evaluate(start=>globalThis.__avhubDirectObservation.events.slice(start),first.events)});flush();
   assert.ok(Math.abs(frame.time-target)<2,'Actual newly presented seek frame must match the target');
   assert.equal(last.rate,1);assert.equal(last.paused,false);await delay(1500);
  }
 }
 if(process.argv.includes('--export')){
  const target=path.join(workspace,'playback-diagnostic-export.json');
  await desktop.evaluate(({BrowserWindow,dialog},target)=>{
   const wc=BrowserWindow.getAllWindows()[0].webContents;
   if(globalThis.__avhubDirectListener)wc.debugger.removeListener('message',globalThis.__avhubDirectListener);
   if(wc.debugger.isAttached())wc.debugger.detach();
   dialog.showSaveDialog=async()=>({canceled:false,filePath:target});
  },target);
  await page.locator('.playback-diagnostics summary').click();
  await page.getByRole('button',{name:'采集并导出播放诊断（8 秒）',exact:true}).click();
  await expect(page.getByText('播放诊断已保存',{exact:true})).toBeVisible({timeout:25000});
  const captured=JSON.parse(readFileSync(target,'utf8'));
  assert.equal(captured.engine,'chromium');assert.equal(captured.decoder.status,'identified');assert.equal(captured.playback.mode,lossless?'remux':'direct');
  assert.equal(captured.playback.resolution.width,fixture.width);assert.equal(captured.playback.rate,1);
  assert.ok(!JSON.stringify(captured).includes(fixture.path));assert.ok(!JSON.stringify(captured).includes('127.0.0.1'));
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.debugger.isAttached()),false);
  assert.equal(await page.evaluate(()=>Object.keys(window).filter(key=>key.startsWith('__avhubPlaybackDiagnostic_')).length),0);
  report.manualExport=captured;
 }
 assert.ok(report.attempts[0].mode==='direct'&&!report.attempts[0].prepared,'Default must remain original direct playback');
 if(lossless)assert.ok(report.attempts.length===2&&report.attempts[1].delivery==='indexed-remux','One explicit lossless switch; no seek rebuilds');
 else assert.equal(report.attempts.length,1,'No automatic direct source replacement');
 report.completed=true;
}catch(error){report.error=String(error.stack??error);throw error;}
finally{
 if(desktop){
  report.decoder=await desktop.evaluate(()=>globalThis.__avhubDirectMedia??null).catch(()=>null);
  report.gpuAfterPlayback=await desktop.evaluate(async({app})=>({features:app.getGPUFeatureStatus(),complete:await app.getGPUInfo('complete')})).catch(error=>({error:String(error.message)}));
  const stopped=desktop.waitForEvent('close',{timeout:30000}).then(()=>true,()=>false);
  await desktop.evaluate(({app})=>{setTimeout(()=>app.quit(),0);}).catch(()=>{});
  report.cleanExit=await stopped;
  if(!report.cleanExit)await desktop.close().catch(()=>{});
 }
 report.exit=exit;report.sourceUnchanged=JSON.stringify(before)===JSON.stringify(identity());flush();
 console.log(JSON.stringify({report:reportPath,completed:report.completed,sourceUnchanged:report.sourceUnchanged,cleanExit:report.cleanExit}));
}
assert.equal(report.sourceUnchanged,true);assert.equal(report.cleanExit,true);
