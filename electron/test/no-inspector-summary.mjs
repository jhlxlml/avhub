// Summarizes the no-debugger workload only. Not allocation attribution or a
// declaration that a flat/declining process curve proves the absence of leaks.
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const stats=values=>{const a=values.map(finite).filter(v=>v!==null).sort((x,y)=>x-y);return a.length?{min:a[0],median:a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2,max:a.at(-1)}:{min:null,median:null,max:null};};
const memory=(point,role,key)=>{
 const items=point?.processes?.filter(p=>role==='gpu'?p.type==='GPU':p.role===role)??[];
 const values=items.map(p=>finite(p[key]));
 return values.length&&values.every(v=>v!==null)?values.reduce((n,v)=>n+v,0)/1024:null;
};
const memories=points=>Object.fromEntries(['library-renderer','gpu'].map(role=>[role,{workingSetMiB:stats(points.map(p=>memory(p,role,'workingSetKiB'))),privateMiB:stats(points.map(p=>memory(p,role,'privateKiB')))}]));
export function summarizeNoInspector(report){
 const rows=Array.isArray(report.cycles)?report.cycles:[],idle=Array.isArray(report.idle)?report.idle:[];
 const timed=rows.filter(r=>finite(r.elapsedMs)!==null&&r.elapsedMs>=0),windows=[],elapsed=finite(report.workloadMs);
 const windowEnd=Math.max(0,elapsed??0,...timed.map(r=>r.elapsedMs));
 for(const index of [...new Set(timed.map(r=>Math.max(0,Math.ceil(r.elapsedMs/600000)-1)))].sort((a,b)=>a-b)){
  const group=timed.filter(r=>Math.max(0,Math.ceil(r.elapsedMs/600000)-1)===index);
  windows.push({fromMinute:index*10,toMinute:Math.min((index+1)*10,windowEnd/60000),partial:windowEnd<(index+1)*600000,samples:group.length,...memories(group.map(r=>r.afterClose))});
 }
 const idleFirst=idle[0],idleLast=idle.at(-1),target=finite(report.targetSeconds);
 const diagnosticsDisabled=report.instrumentation?.inspector===false&&report.instrumentation?.playwright===false&&report.instrumentation?.forcedGc===false&&report.instrumentation?.cachePurge===false;
 const durationReached=target===null?null:target>0?elapsed!==null&&elapsed>=target*1000:report.targetReached===true;
 const errors=Array.isArray(report.errors)?report.errors:null;
 const pages=[...new Set(rows.map(r=>r.library?.page).filter(p=>Number.isInteger(p)&&p>0))].sort((a,b)=>a-b);
 const accepted=rows.length>=2&&(!report.walkPages||pages.length>=2)&&report.completed===true&&report.cleanExit===true&&report.sourceIdentityVerified===true&&report.targetReached===true&&durationReached===true&&diagnosticsDisabled&&errors?.length===0&&Array.isArray(report.remainingOwnedMpv)&&report.remainingOwnedMpv.length===0;
 return {build:report.build??null,phase:report.phase??null,walkPages:report.walkPages??null,accepted,
  completed:report.completed===true,cleanExit:report.cleanExit===true,sourceIdentityVerified:report.sourceIdentityVerified===true,
  targetSeconds:target,workloadMs:elapsed,durationReached,diagnosticsDisabled,cycles:rows.length,pages,
  warmCycles:memories(rows.slice(2).map(r=>r.afterClose)),tenMinuteWindows:windows,
  library:{cards:stats(rows.map(r=>r.library?.cards)),images:stats(rows.map(r=>r.library?.images)),decodedImages:stats(rows.map(r=>r.library?.decodedImages)),imagePixels:stats(rows.map(r=>r.library?.imagePixels)),nodes:stats(rows.map(r=>r.library?.nodes))},
  browsing:{images:stats(rows.map(r=>r.browsing?.images)),decodedImages:stats(rows.map(r=>r.browsing?.decodedImages)),imagePixels:stats(rows.map(r=>r.browsing?.imagePixels)),nodes:stats(rows.map(r=>r.browsing?.nodes))},
  playback:{cycles:rows.filter(r=>finite(r.sourceLoads)!==null).length,firstFrameMs:stats(rows.map(r=>r.firstFrameMs)),seekMs:stats(rows.map(r=>r.seekMs)),sourceLoads:stats(rows.map(r=>r.sourceLoads)),bufferingEvents:stats(rows.map(r=>r.bufferingEvents)),audioTracks:stats(rows.map(r=>r.audioTracks))},
  idle:{samples:idle.length,first:idleFirst?memories([idleFirst]):null,last:idleLast?memories([idleLast]):null},
  errors,limitations:['Process private memory/working set are not allocation categories or GPU VRAM.','DOM image pixels/nodes describe the current document, not retained native image-cache memory.','Warm cycles exclude the first two. Idle time never satisfies active workload duration.','No cold-cache, HDR, physical sound-device or mixed-DPI acceptance is implied.']};
}
