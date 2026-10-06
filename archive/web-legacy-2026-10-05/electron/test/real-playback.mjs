// Hardware-enabled validation; --visible --baseline measures steady 1x playback.
import { _electron, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync,readFileSync,writeFileSync,statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const option=name=>{const i=process.argv.indexOf(name);if(i<0)throw new Error(`${name} required`);return process.argv[i+1];};
const seconds=Number(process.argv.includes('--seconds')?option('--seconds'):180);
const visible=process.argv.includes('--visible'),baseline=process.argv.includes('--baseline');
if(!Number.isFinite(seconds)||seconds<30||seconds>3600)throw new Error('seconds must be 30..3600 per sample');
const folder=path.join(root,'build',`real-desktop-${Date.now()}`);mkdirSync(folder);
const data=path.join(folder,'data');
const prepared=spawnSync(process.env.AVHUB_PYTHON||'python',['scripts/prepare-real-desktop.py','--source',option('--source'),'--index',option('--index'),'--output',data],{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000});
if(prepared.status!==0)throw new Error(prepared.stderr);
const samples=JSON.parse(readFileSync(path.join(data,'samples-private.json'),'utf8'));
const selected=process.argv.includes('--id')?samples.filter(sample=>sample.id===Number(option('--id'))):samples;
if(!selected.length)throw new Error('No matching authorized sample');
const report={samples:[],secondsPerSample:seconds,visible,baseline,limitations:[visible?'Visible native window; not a subjective/HDR display inspection.':'Hidden native Electron window; not a visible display/HDR visual inspection.',
  'Test-only --in-process-gpu and --no-sandbox switches; production window security settings unchanged.',
  'No subjective sharpness/color or acoustic lip-sync verification. Source size/mtime, not full-file hashes.','No NAS outage or hour-scale certification.']};
let desktop;let exit=null;let logs='';
try{
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--no-sandbox','--autoplay-policy=no-user-gesture-required'],cwd:folder,
    env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:visible?'0':'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  desktop.process().on('exit',(code,signal)=>{exit={code,signal};});
  desktop.process().stderr?.on('data',chunk=>{logs=(logs+chunk).slice(-32000);});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置'}).waitFor();
  report.gpu=await desktop.evaluate(({app})=>app.getGPUFeatureStatus());
  report.build=await page.evaluate(async()=>{const value=await(await fetch('/api/health')).json();return{build_id:value.build_id,version:value.version,api_protocol:value.api_protocol};});
  for(const sample of selected){
    const duration=Math.min(seconds,Math.max(2,sample.duration-2));
    const result={...Object.fromEntries(Object.entries(sample).filter(([key])=>!['path','before'].includes(key))),status:'running',observations:[],attempts:[]};
    report.samples.push(result);
    result.testSeconds=duration;
    const observer=async response=>{if(response.request().method()==='POST'&&response.url().endsWith(`/api/media/${sample.id}/playback`)){
      try{const value=await response.json();result.attempts.push({mode:value.mode,preparation:value.preparation});}catch{}}};
    page.on('response',observer);
    try{
      await page.goto(new URL(`/?video=${sample.id}`,page.url()).href);
      await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2&&!v.paused&&v.videoWidth>0&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:60000}).toBe(true);
      if(baseline){
        await page.locator('video').evaluate(v=>{v.playbackRate=1;v.muted=true;});
        await page.evaluate(()=>{
          const state={longTasks:0,longTaskMs:0,progressMutations:0};
          globalThis.__avhubBaseline=state;
          new PerformanceObserver(list=>{for(const entry of list.getEntries()){state.longTasks++;state.longTaskMs+=entry.duration;}}).observe({type:'longtask'});
          const progress=document.querySelector('.seek-control');
          if(progress)new MutationObserver(list=>{state.progressMutations+=list.length;}).observe(progress,{attributes:true,attributeFilter:['style']});
        });
        // Exclude decoder/startup warmup from frame-drop deltas.
        await delay(5000);
      }
      const began=Date.now();let lastTime=0,stalledSince=null,paused=false;
      while(Date.now()-began<duration*1000){
        const state=await page.locator('video').evaluate(v=>{const q=v.getVideoPlaybackQuality();return{time:v.currentTime,paused:v.paused,ready:v.readyState,
          width:v.videoWidth,height:v.videoHeight,totalFrames:q.totalVideoFrames,droppedFrames:q.droppedVideoFrames,error:v.error?.code||null,rate:v.playbackRate,ended:v.ended};});
        const metrics=baseline?await desktop.evaluate(({app})=>app.getAppMetrics().map(item=>({type:item.type,cpu:item.cpu.percentCPUUsage,memoryKB:item.memory.workingSetSize}))):undefined;
        const ui=baseline?await page.evaluate(()=>({...globalThis.__avhubBaseline})):undefined;
        result.observations.push({elapsed:Math.round((Date.now()-began)/1000),...state,...(metrics?{processes:metrics,ui}:{}),documentVisible:await page.evaluate(()=>document.visibilityState==='visible')});
        if(state.error)throw new Error(`MediaError ${state.error}`);
        if(state.ended)throw new Error('Sample ended before the requested continuous test duration');
        if(state.time<=lastTime+.01&&!state.paused){stalledSince??=Date.now();if(Date.now()-stalledSince>15000)throw new Error('No playback progress for 15 seconds');}else stalledSince=null;
        lastTime=state.time;
        if(!baseline&&duration>60&&!paused&&Date.now()-began>duration*400){
          paused=true;await page.locator('video').evaluate(v=>v.pause());const time=state.time;
          await delay(20000);const after=await page.locator('video').evaluate(v=>v.currentTime);
          if(Math.abs(time-after)>1)throw new Error('Paused playback advanced');
          await page.locator('video').evaluate(v=>v.play());stalledSince=null;result.pauseRecovery=true;
        }
        if(!baseline&&duration>60&&report.samples.length===1&&Date.now()-began>duration*600)await page.locator('video').evaluate(v=>{v.playbackRate=1.5;});
        console.log(JSON.stringify({id:sample.id,elapsed:Math.round((Date.now()-began)/1000),time:state.time,frames:state.totalFrames,dropped:state.droppedFrames}));
        await delay(5000);
      }
      const first=result.observations[0],last=result.observations.at(-1);
      const frames=last.totalFrames-first.totalFrames,dropped=last.droppedFrames-first.droppedFrames;
      result.steadyFrames={total:frames,dropped,percent:frames?Math.round(dropped/frames*10000)/100:null};
      if(baseline&&result.observations.some(item=>item.rate!==1||visible&&!item.documentVisible))throw new Error('Baseline visibility/rate changed; do not compare this run');
      result.status='passed';
    }catch(error){result.status='failed';result.error=String(error);}
    finally{page.off('response',observer);writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));}
  }
}finally{
  if(desktop){const closed=desktop.waitForEvent('close',{timeout:30000}).then(()=>true,()=>false);
    // Test cleanup must not wait forever on a visible save-failure dialog.
    // Record the failure and discard only this isolated profile's unsaved state.
    report.quitSaveFailure=false;
    await desktop.evaluate(({app,dialog})=>{
      dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
      setTimeout(()=>app.quit(),0);
    }).catch(()=>{});
    report.closed=exit!==null||await closed;if(!report.closed)await desktop.close().catch(()=>{});
    const log=readFileSync(path.join(data,'desktop.log'),'utf8');report.quitSaveFailure=log.includes('renderer-save-complete success=false');
  }
  report.processExit=exit;writeFileSync(path.join(folder,'desktop-test.log'),logs);
  report.sourceUnchanged=samples.every(sample=>{const value=statSync(sample.path,{bigint:true});return String(value.size)===String(sample.before.size)&&String(value.mtimeNs)===sample.before.mtimeNs;});
  writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(folder,'report.json'),sourceUnchanged:report.sourceUnchanged,closed:report.closed}));
}
if(report.samples.some(sample=>sample.status!=='passed')||!report.sourceUnchanged||!report.closed||report.quitSaveFailure)process.exitCode=1;
