// Bounded real Electron/MPV loop endurance. Repeated short generated media,
// not a long unique movie, exact decoder counter or physical scanout test.
import assert from 'node:assert/strict';
import path from 'node:path';
import {appendFileSync,writeFileSync} from 'node:fs';
import resources from './resource-convergence.cjs';
import counters from './soak-summary.cjs';
export async function soakAcceptance({desktop,controls,evidence,seconds,continuous=false,continuousDuration=180}){
 assert.ok(Number.isInteger(seconds)&&seconds>=5&&seconds<=1800);if(continuous){assert.ok([180,960].includes(continuousDuration));assert.ok(seconds<=continuousDuration-10,'Cannot measure beyond the bounded continuous fixture');}
 const command=(action,extra={})=>desktop.evaluate((_,args)=>globalThis.__renderSpike.command(args.action,args.extra),{action,extra});
 const samples=[],started=performance.now(),report={scope:continuous?'Continuous '+continuousDuration+'-second stream-copy timeline with repeated six-second 4K25 SDR10 content; no exact decoder count or physical scanout certification':'Repeated six-second 4K25 SDR10 fixture in real Electron; no exact decoder frame count or physical scanout certification',continuous,requestedSeconds:seconds,startedUtc:new Date().toISOString(),completed:false,decodedFrameCount:null,samples,policy:{lateNativePrivateRangeBytes:64*1024*1024,lateNativeGpuRangeBytes:64*1024*1024,lateHandleRange:16,settledHandleGrowth:8,idleHandleRange:8}};
 const output=path.join(evidence,'soak-checkpoints.jsonl');
 async function idleTrace(){
  await command('pause',{value:true});
  for(let i=0;i<25;i++){const state=await desktop.evaluate(()=>({...globalThis.__renderSpike.transferStats}));if(state.imports===state.released)break;await controls.waitForTimeout(200);if(i===24)throw new Error('GPU references did not drain before idle sampling');}
  const trace=[];for(let i=0;i<15;i++){await controls.waitForTimeout(100);trace.push({resources:await command('resources'),transfers:await desktop.evaluate(()=>({...globalThis.__renderSpike.transferStats}))});}return trace;
 }
 try{
  await command('pause',{value:true});await command('soak-loop',{value:!continuous});await command('seek',{value:0});
  await desktop.evaluate(()=>globalThis.__renderSpike.probeFrame());
  report.idleBefore=await idleTrace();
  report.before=await command('snapshot');report.resourcesBefore=await command('resources');
  await command('pause',{value:false});
  const playbackStart=performance.now();let previous;
  while(performance.now()-playbackStart<seconds*1000){
   await controls.waitForTimeout(Math.min(2137,Math.max(1,seconds*1000-(performance.now()-playbackStart))));
   const probe=await desktop.evaluate(()=>globalThis.__renderSpike.probeFrame()),native=await command('snapshot');
   const expected=Math.round(Number(native.time)*25)%150,diff=Math.abs(probe.top-expected),circularError=Math.min(diff,150-diff);
   const row={elapsedMs:performance.now()-playbackStart,utc:new Date().toISOString(),pixelCode:probe.top,expectedFromPosition:expected,circularFrameError:circularError,native,resources:await command('resources'),renderer:probe.metrics,desktop:await desktop.evaluate(({app})=>({mainMemory:process.memoryUsage(),processes:app.getAppMetrics(),transfers:{...globalThis.__renderSpike.transferStats}}))};
   samples.push(row);appendFileSync(output,JSON.stringify(row)+'\n');
   if(samples.length%27===0)console.log('M2 continuous seconds='+Math.round(row.elapsedMs/1000)+' actualPixelCode='+row.pixelCode+' decoderDrops='+native.drops+' voDrops='+native.voDrops+' handles='+row.resources.handles);
   assert.ok(Number.isInteger(probe.top)&&probe.top>=0&&probe.top<150,'Actual video pixel code unavailable');
   assert.ok(circularError<=5,'Visible pixels diverged from running native position by more than 200ms');
   if(previous){assert.ok(row.elapsedMs-previous.elapsedMs<5000,'Sampling gap makes a full counter cycle ambiguous');if(row.elapsedMs-previous.elapsedMs>1000)assert.notEqual(row.pixelCode,previous.pixelCode,'Real video pixels stopped advancing');}
   assert.equal(native.renderError,null);assert.equal(native.pause,'no');
   assert.ok(row.desktop.transfers.maxInFlight<=1);assert.equal(row.desktop.transfers.importFailures,0);
   assert.equal(probe.metrics.frames,probe.metrics.gpuCompletions,'A video frame was released before recorded GPU completion');
   previous=row;
  }
  report.playbackElapsedMs=performance.now()-playbackStart;
  await command('pause',{value:true});await desktop.evaluate(()=>globalThis.__renderSpike.probeFrame());
  report.after=await command('snapshot');report.resourcesAfter=await command('resources');
  report.idleAfter=await idleTrace();
  report.dropAssessment=counters.assessDrops([report.before,...samples.map(s=>s.native),report.after],report.playbackElapsedMs);
  assert.equal(report.dropAssessment.passed,true,'Decoder/VO drops exceeded the explicit 4K25 gate or counters were unavailable/reset');
  const late=samples.filter(s=>s.elapsedMs>=Math.min(60000,report.playbackElapsedMs/2));
  const range=values=>Math.max(...values)-Math.min(...values);
  report.lateWindow={sampleCount:late.length,nativePrivateRangeBytes:range(late.map(s=>s.resources.privateBytes)),nativeHandleRange:range(late.map(s=>s.resources.handles)),nativeGpuRangeBytes:range(late.map(s=>s.resources.gpuMemory.CurrentUsage))};
  report.legacyRangeWouldPass=report.lateWindow.nativePrivateRangeBytes<=report.policy.lateNativePrivateRangeBytes&&report.lateWindow.nativeHandleRange<=report.policy.lateHandleRange&&report.lateWindow.nativeGpuRangeBytes<=report.policy.lateNativeGpuRangeBytes;
  report.resourceConvergence=resources.convergence(report.idleBefore,report.idleAfter,samples);
  const c=report.resourceConvergence;
  assert.ok(c.privateBytes.peakPositiveGrowth<=report.policy.lateNativePrivateRangeBytes,'Native private memory grew beyond budget');
  assert.ok(c.gpu.peakPositiveGrowth<=report.policy.lateNativeGpuRangeBytes,'Native GPU memory grew beyond budget');
  assert.ok(c.handles.peakPositiveGrowth<=report.policy.lateHandleRange,'Active native handles grew beyond budget');
  assert.ok(c.handles.settledPositiveGrowth<=report.policy.settledHandleGrowth,'Released-frame idle handles failed to converge');
  assert.ok(c.handles.idleRange<=report.policy.idleHandleRange,'Released-frame idle handles remain unstable');
  report.cpuTimeMs=report.resourcesAfter.cpuTimeMs-report.resourcesBefore.cpuTimeMs;
  report.scheduledVideoFrames=report.after.scheduledFrames-report.before.scheduledFrames;
  report.redrawFrames=report.after.redrawFrames-report.before.redrawFrames;
  report.repeatFrames=report.after.repeatFrames-report.before.repeatFrames;
  report.unclassifiedFrames=report.after.unclassifiedFrames-report.before.unclassifiedFrames;
  report.completed=true;return report;
 }catch(error){report.error=String(error.stack||error);throw error;}
 finally{report.endedUtc=new Date().toISOString();report.elapsedMs=performance.now()-started;await command('pause',{value:true}).catch(()=>{});await command('soak-loop',{value:false}).catch(()=>{});writeFileSync(path.join(evidence,'soak-acceptance.json'),JSON.stringify(report,null,2));}
}
