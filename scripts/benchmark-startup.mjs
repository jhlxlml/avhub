import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error(`${name} is required`);return args[i+1];};
const source=option('--source'),index=option('--index');
const requestedId=args.includes('--id')?Number(option('--id')):null;
const child=spawn(process.env.AVHUB_PYTHON||'python',['-B','tests/real_startup_server.py','--source',source,'--index',index],
  {cwd:project,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',errors='',server,browser,exited=false,sourceCheck=null;
child.on('exit',()=>{exited=true;});child.stderr.on('data',chunk=>{errors+=chunk;});
child.stdout.on('data',chunk=>{
  output+=chunk;
  for(const line of output.split('\n'))try{const data=JSON.parse(line);if(data.url)server=data;if('source_unchanged' in data)sourceCheck=data;}catch{/* partial line */}
});
const report={samples:[],limitations:['Read-only source; copy of benchmark index, no daily library writes.',
  'Headless Edge software/GPU environment may differ from the visible Electron window.',
  'Warm OS caches; highest-resolution samples, not all files or a codec-wide guarantee.',
  'Includes application initialization through first presented frame; no seek benchmark.']};
try{
  for(let attempt=0;!server&&attempt<200;attempt++){if(exited)throw new Error(errors);await delay(100);}
  if(!server)throw new Error('Isolated startup server timed out');
  report.build=server.build;report.indexed=server.indexed;
  for(let attempt=0;attempt<100;attempt++){
    try{if((await fetch(`${server.url}/api/health`,{signal:AbortSignal.timeout(500)})).ok)break;}catch{/* start */}
    await delay(100);
  }
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  for(const sample of server.samples.filter(sample=>requestedId===null||sample.id===requestedId)){
    const page=await browser.newPage({viewport:{width:1440,height:850}});
    const attempts=[];const result={...sample,status:'ok',attempts};
    page.on('response',async response=>{
      if(response.request().method()==='POST'&&response.url().endsWith(`/api/media/${sample.id}/playback`)){
        try{const body=await response.json();attempts.push({mode:body.mode,preparation:body.preparation});}catch{/* response disposed */}
      }
    });
    const began=performance.now();
    try{
      await page.goto(`${server.url}/?video=${sample.id}`);
      await page.waitForFunction(()=>/^[\d.]+ (?:ms|秒)$/.test(document.querySelector('output[aria-label="起播耗时"]')?.textContent||''),undefined,{timeout:60000});
      result.navigationToFrameMs=Math.round(performance.now()-began);
      const details=page.locator('.playback-diagnostics');await details.locator('summary').click();
      result.fields=await details.locator('dl>div').evaluateAll(rows=>Object.fromEntries(rows.map(row=>[row.querySelector('dt')?.textContent,row.querySelector('dd')?.textContent])));
      result.frames=await page.locator('video').evaluate(video=>{const q=video.getVideoPlaybackQuality();return{width:video.videoWidth,height:video.videoHeight,total:q.totalVideoFrames,dropped:q.droppedVideoFrames};});
    }catch(error){result.status='incomplete';result.error=String(error);result.displayedError=await page.locator('.resume[role="alert"]').textContent().catch(()=>null);
      result.videoState=await page.locator('video').evaluate(video=>({paused:video.paused,readyState:video.readyState,
        width:video.videoWidth,height:video.videoHeight,time:video.currentTime,duration:video.duration,error:video.error?.code,
        frames:video.getVideoPlaybackQuality().totalVideoFrames})).catch(()=>null);
      result.preparation=await page.getByLabel('播放准备阶段').textContent().catch(()=>null);
    }
    finally{await page.close();}
    report.samples.push(result);console.log(JSON.stringify({id:sample.id,ext:sample.ext,codec:sample.video_codec,status:result.status,navigationToFrameMs:result.navigationToFrameMs,attempts}));
  }
}finally{
  await browser?.close();
  if(server)await fetch(`${server.url}/benchmark/shutdown`,{method:'POST',signal:AbortSignal.timeout(1500)}).catch(()=>{});
  for(let attempt=0;!exited&&attempt<150;attempt++)await delay(100);
  if(!exited){child.kill();report.cleanup='server forced to exit';}
  report.sourceCheck=sourceCheck;
  const folder=path.join(project,'build','startup-benchmarks');mkdirSync(folder,{recursive:true});
  const destination=path.join(folder,`report-${Date.now()}.json`);writeFileSync(destination,JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:destination,sourceCheck}));
}
