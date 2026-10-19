// Read-only report analysis. Does not launch the app or touch source media.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=process.argv[2];assert.ok(file,'Provide library-soak.json');
const report=JSON.parse(readFileSync(file,'utf8'));
const samples=report.samples??[],playbacks=report.playbacks??[];
const quantile=(values,fraction)=>{
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  return sorted.length?sorted[Math.floor((sorted.length-1)*fraction)]:null;
};
const range=values=>({min:quantile(values,0),median:quantile(values,.5),p95:quantile(values,.95),max:quantile(values,1)});
const memory=type=>{
  const points=samples.map(sample=>{const processes=(sample.processes??[]).filter(value=>value.type===type);return {time:sample.elapsedMs,value:processes.length?processes.reduce((sum,value)=>sum+value.workingSetKB,0)/1024:null};});
  const end=samples.at(-1)?.elapsedMs??0;
  return {unit:'MiB',...range(points.map(value=>value.value)),firstFiveMinutes:range(points.filter(value=>value.time<=300000).map(value=>value.value)),lastFiveMinutes:range(points.filter(value=>value.time>=Math.max(0,end-300000)).map(value=>value.value))};
};
const network=report.network??{};
const processMemory=(row,field)=>{
  const values=(row?.processes??[]).filter(process=>process.type==='Tab').map(process=>process[field]);
  return values.length&&values.every(Number.isFinite)?values.reduce((sum,value)=>sum+value,0)/1024:null;
};
const heapMiB=(row,field)=>Number.isFinite(row?.heapUsage?.[field])?row.heapUsage[field]/1024**2:null;
const lifecycle=playbacks.map(row=>({cycle:row.cycle,firstFrameMs:row.firstFrameMs??null,rendererMiB:processMemory(row.afterClose,'workingSetKB'),privateMiB:processMemory(row.afterClose,'privateKB'),jsHeapMiB:heapMiB(row.afterClose,'usedSize'),embedderHeapMiB:heapMiB(row.afterClose,'embedderHeapUsedSize'),dom:row.afterClose?.dom??null}));
const idle=(report.idleSamples??[]).map(row=>({elapsedMs:row.elapsedMs,rendererMiB:processMemory(row,'workingSetKB'),privateMiB:processMemory(row,'privateKB'),jsHeapMiB:heapMiB(row,'usedSize'),embedderHeapMiB:heapMiB(row,'embedderHeapUsedSize'),dom:row.dom??null}));
const tenMinuteWindows=[];
for(let start=0;start<=(samples.at(-1)?.elapsedMs??-1);start+=600000){
  const rows=samples.filter(sample=>sample.elapsedMs>=start&&sample.elapsedMs<start+600000);
  const values=type=>rows.flatMap(sample=>(sample.processes??[]).filter(process=>process.type===type).map(process=>process.workingSetKB/1024));
  tenMinuteWindows.push({fromMinute:start/60000,toMinute:Math.min(start+600000,report.elapsedMs)/60000,samples:rows.length,rendererMiB:range(values('Tab')),gpuProcessMiB:range(values('GPU'))});
}
console.log(JSON.stringify({
  build:report.build??null,seconds:report.seconds,elapsedSeconds:(report.elapsedMs??0)/1000,
  totalElapsedSeconds:(report.totalElapsedMs??report.elapsedMs??0)/1000,instrumentation:report.instrumentation??null,
  targetReached:report.targetReached===true,cleanExit:report.cleanExit===true,
  sourceIdentityVerified:report.sourceIdentityVerified??'not recorded by this harness revision',
  samples:samples.length,playbackCycles:playbacks.length,errors:report.errors??[],
  memory:{renderer:memory('Tab'),gpuProcess:memory('GPU'),main:memory('Browser')},
  rendererCounters:{documents:range(samples.map(sample=>sample.dom?.documents)),nodes:range(samples.map(sample=>sample.dom?.nodes)),listeners:range(samples.map(sample=>sample.dom?.jsEventListeners)),embedderHeapBytes:range(samples.map(sample=>sample.heapUsage?.embedderHeapUsedSize)),privateMiB:range(samples.flatMap(sample=>(sample.processes??[]).filter(process=>process.type==='Tab').map(process=>process.privateKB==null?null:process.privateKB/1024)))},
  tenMinuteWindows,
  network:network.enabled===false?{enabled:false,completed:null,cacheHits:null,notModified:null,transferBytes:null,failed:null,transferredMiB:null,cacheHitRatio:null}:{...network,transferredMiB:(network.transferBytes??0)/1024**2,cacheHitRatio:network.completed?(network.cacheHits??0)/network.completed:null},
  playback:{openMs:range(playbacks.map(value=>value.openMs)),firstFrameMs:range(playbacks.map(value=>value.firstFrameMs)),warmFirstFrameMs:range(playbacks.slice(1).map(value=>value.firstFrameMs)),seekMs:range(playbacks.map(value=>value.seekMs)),sourceLoads:[...new Set(playbacks.map(value=>value.sourceLoads))],bufferingEvents:playbacks.reduce((sum,value)=>sum+(value.bufferingEvents??0),0),maxDropped:quantile(playbacks.map(value=>value.dropped),1),maxDecoderDropped:quantile(playbacks.map(value=>value.decoderDropped),1),windowsAfterClose:playbacks.map(value=>value.windowsAfterClose),lifecycle},
  idle:{requestedSeconds:report.idleSeconds??0,samples:idle},
  timing:report.timing??null,
  limitations:['Sampled working set is not a leak-proof bound; GPU working set is not VRAM.','Memory windows may overlap for runs shorter than ten minutes. No forced GC or cache reset.','Null means unavailable, not zero. This summary never upgrades a partial run to passed.'],
},null,2));
