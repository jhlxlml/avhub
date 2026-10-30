// Read-only real Electron application + owned MPV comparison, not standalone MPV.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(import.meta.dirname,'../..'),source=process.argv[2];
const number=(name,fallback)=>Number(process.argv.find(v=>v.startsWith(`--${name}=`))?.split('=')[1]??fallback);
const at=number('at',1860),seconds=number('seconds',45),software=process.argv.includes('--software-decode-control');
const handoff=process.argv.includes('--engine-handoff');
assert.ok(source&&path.isAbsolute(source)&&path.resolve(source).toLowerCase().startsWith('e:\\downloads\\'));
assert.ok(Number.isFinite(at)&&at>=0&&Number.isInteger(seconds)&&seconds>=15&&seconds<=600);
const folder=mkdtempSync(path.join(root,'build','native-segment-')),profile=path.join(folder,'profile');
const identity=()=>{const s=statSync(source,{bigint:true});return {bytes:String(s.size),mtimeNs:String(s.mtimeNs)};},before=identity();
const seed=spawnSync(process.env.AVHUB_PYTHON||'python',[path.join(root,'electron/test/seed-original-probe.py'),source,profile],{cwd:root,windowsHide:true,encoding:'utf8',timeout:45000});
assert.equal(seed.status,0,seed.stderr||seed.stdout);
const metadata=JSON.parse(seed.stdout.trim().split(/\r?\n/).at(-1));
const config=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',`import sqlite3,json,sys
from pathlib import Path
d=sqlite3.connect(Path(sys.argv[1])/'library.db');p=Path(sys.argv[2])
d.execute("UPDATE media SET progress=?,modified=?,name='authorized-source.mp4',title='只读解码路径对照'",(float(sys.argv[3]),p.stat().st_mtime))
handoff=sys.argv[4]=='1'
for k,v in dict(playerEngine='chromium' if handoff else 'mpv',mpvWindowMode='independent',resumeBehavior='restart' if handoff else 'resume',hoverPreview=False,privacyMode=False,autoNext=False,audio=dict(volume=0,muted=True)).items():
 d.execute('INSERT OR REPLACE INTO preferences(key,value,updated_at) VALUES(?,?,0)',(k,json.dumps(v)))
d.commit();d.close()`,profile,source,String(at),handoff?'1':'0'],{windowsHide:true,encoding:'utf8',timeout:15000,env:{...process.env,PYTHONUTF8:'1'}});
assert.equal(config.status,0,config.stderr);
const report={build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),completed:false,cleanExit:false,sourceUnchanged:false,softwareDecodeControl:software,handoff,attempts:[],at,seconds,samples:[],errors:[],limitations:[
 'Real Electron opens its production independent MPV player; test-only main hook reads bounded properties and logs. Not a standalone player or physical display capture.',
 'Muted real audio output; numeric A/V sync is measured, not human lip-sync acceptance.',
 'MPV counters and estimated decoder FPS have different meanings from Chromium frame counters; never interpret estimated-vf-fps as physical presentation FPS.',
 'Source identity uses size/mtimeNs; not full-file hashing. Software decode override exists only inside this diagnostic process.',
]};
const file=path.join(folder,'segment.json'),save=()=>writeFileSync(file,JSON.stringify(report,null,2));save();console.log('Native segment report:',file);
let desktop,page;
try{
 const env={...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:folder,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'};
 delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 desktop=await _electron.launch({args:[root],cwd:folder,env,timeout:60000});page=await desktop.firstWindow();
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate((_,{root,software})=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json');
  const {MpvClient}=require(root+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start,message=MpvClient.prototype.message;
  globalThis.__segmentLogs=[];
  MpvClient.prototype.start=function(...args){globalThis.__segmentClient=this;if(software)args[4]=[...(args[4]??[]),'--hwdec=no'];return start.apply(this,args);};
  MpvClient.prototype.message=function(value){if(value.event==='log-message'&&globalThis.__segmentLogs.length<96)globalThis.__segmentLogs.push({prefix:value.prefix,level:value.level,text:String(value.text??'').slice(0,800)});return message.call(this,value);};
 },{root,software});
 if(handoff)page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/media/1/playback'))report.attempts.push(r.postDataJSON());});
 await page.goto(new URL('/?video=1',page.url()).href);
 if(handoff){
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2&&!v.paused&&v.currentTime>.1)).toBe(true);
  // Test-only positioning to the authorized interval, not seek-latency acceptance.
  await page.locator('video').evaluate((v,target)=>{v.currentTime=target;},at);
  await expect.poll(()=>page.locator('video').evaluate((v,target)=>v.readyState>=2&&!v.seeking&&v.currentTime>=target&&v.currentTime<target+3,at),{timeout:30000}).toBe(true);
  report.handoffStart=await page.locator('video').evaluate(v=>({time:v.currentTime,sourceOriginal:v.currentSrc.endsWith('/media/1/file')}));
  assert.equal(report.handoffStart.sourceOriginal,true);
  await page.locator('.playback-diagnostics summary').click();await page.getByRole('button',{name:'使用 MPV 原画播放',exact:true}).click();
 }
 const snapshot=()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
 await expect.poll(async()=>{const s=await snapshot().catch(()=>null);return s?.phase==='ready'&&Number(s.properties['time-pos'])>=at;},{timeout:45000}).toBe(true);
 const read=()=>desktop.evaluate(async()=>{
  const c=globalThis.__segmentClient,values={};
  for(const key of ['video-frame-info/estimated-smpte-timecode','frame-drop-count','decoder-frame-drop-count','vo-delayed-frame-count','avsync','estimated-vf-fps','hwdec-current','video-params','speed','pause','window-minimized','current-ao','video-sync']){
   try{values[key]=await c.command(['get_property',key]);}catch{values[key]=null;}
  }
  return {at:performance.now(),...values,state:structuredClone(c.snapshot)};
 });
 await desktop.evaluate(async()=>globalThis.__segmentClient.command(['request_log_messages','warn']));
 await delay(2000);const first=await read();report.first=first;
 assert.ok(Math.abs(Number(first.state.properties['time-pos'])-at)<5);
 if(software)assert.equal(first['hwdec-current'],'no');
 for(let n=0;n<seconds;n++){
  await delay(1000);const s=await read();report.samples.push(s);
  assert.equal(s.state.phase,'ready');assert.equal(s.pause,false);assert.equal(s.speed,1);assert.equal(s['window-minimized'],false);
  assert.equal(s.state.sourceLoads,1);assert.equal(s['video-params'].w,metadata.width);assert.equal(s['video-params'].h,metadata.height);
  if(n%10===9)save();
 }
 const last=report.samples.at(-1),numericDelta=key=>Number.isFinite(first[key])&&Number.isFinite(last[key])?last[key]-first[key]:null;
 const frameTimecodeKey='video-frame-info/estimated-smpte-timecode';
 report.summary={mediaSeconds:Number(last.state.properties['time-pos'])-Number(first.state.properties['time-pos']),wallSeconds:(last.at-first.at)/1000,frameTimecodeStart:first[frameTimecodeKey],frameTimecodeEnd:last[frameTimecodeKey],dropped:numericDelta('frame-drop-count'),decoderDropped:numericDelta('decoder-frame-drop-count'),voDelayed:numericDelta('vo-delayed-frame-count'),bufferingEvents:last.state.bufferingEvents-first.state.bufferingEvents,hwdec:last['hwdec-current'],sourceLoads:last.state.sourceLoads,avSyncRange:report.samples.map(s=>s.avsync).filter(Number.isFinite)};
 assert.ok(report.summary.mediaSeconds>seconds*.9,'Actual media clock must advance');
 assert.equal(typeof first[frameTimecodeKey],'string','Current-frame timecode must be available');
 assert.equal(typeof last[frameTimecodeKey],'string');assert.notEqual(last[frameTimecodeKey],first[frameTimecodeKey],'Current-frame timecode must change; not physical scanout proof');
 if(handoff){
  await page.getByRole('button',{name:'切换现有播放器',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v,target)=>v.readyState>=2&&!v.paused&&v.getVideoPlaybackQuality().totalVideoFrames>0&&v.currentTime>=target-1&&v.currentTime<target+5,Number(last.state.properties['time-pos'])),{timeout:30000}).toBe(true);
  report.handoffBack=await page.locator('video').evaluate(v=>({time:v.currentTime,sourceOriginal:v.currentSrc.endsWith('/media/1/file'),width:v.videoWidth,height:v.videoHeight}));
  report.preferences=await page.evaluate(async()=>(await(await fetch('/api/preferences')).json()).values);
  assert.equal(report.handoffBack.sourceOriginal,true);assert.equal(report.handoffBack.width,metadata.width);assert.equal(report.handoffBack.height,metadata.height);
  assert.equal(report.preferences.playerEngine,'chromium');assert.equal(report.preferences.resumeBehavior,'restart');
  assert.equal(report.attempts.length,2);assert.ok(report.attempts[1].start>=Number(last.state.properties['time-pos'])-1);
  assert.ok(report.attempts.every(r=>r.prefer_original&&!r.force_transcode&&!r.allow_video_transcode&&!r.allow_audio_transcode));
 }
 report.completed=true;console.log(JSON.stringify(report.summary));
}catch(error){report.errors.push(String(error.stack??error));process.exitCode=1;}
finally{
 if(desktop){
  report.logs=await desktop.evaluate(()=>globalThis.__segmentLogs).catch(()=>[]);
  const stopped=desktop.waitForEvent('close',{timeout:30000}).then(()=>true,()=>false);
  await desktop.evaluate(({app})=>{setTimeout(()=>app.quit(),0);}).catch(()=>{});report.cleanExit=await stopped;
  if(!report.cleanExit)await desktop.close().catch(()=>{});
 }
 report.sourceUnchanged=JSON.stringify(before)===JSON.stringify(identity());save();
 console.log(JSON.stringify({report:file,completed:report.completed,cleanExit:report.cleanExit,sourceUnchanged:report.sourceUnchanged,errors:report.errors}));
}
assert.equal(report.sourceUnchanged,true);assert.equal(report.completed,true);assert.equal(report.cleanExit,true);
