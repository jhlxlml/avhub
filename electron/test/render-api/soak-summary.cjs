// Summarize recorded evidence without converting redraws into decoded FPS.
function number(value){if(!['number','string'].includes(typeof value)||typeof value==='string'&&!value.trim())return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}
function counter(values){let previous=null,observedIncrease=0,resets=0,missing=0;for(const raw of values){const n=number(raw);if(n===null){missing++;previous=null;continue;}if(previous!==null){if(n<previous){resets++;observedIncrease+=n;}else observedIncrease+=n-previous;}previous=n;}return {observedIncrease,resets,missing,completeMonotonic:resets===0&&missing===0,meaning:'Observed lower bound if resets or missing samples occur; unavailable is not zero'};}
function summarize(report){
 const delta=(before,after)=>number(before)!==null&&number(after)!==null?after-before:null;
 const samples=report.samples||[],states=[report.before,...samples.map(s=>s.native),report.after].filter(Boolean);
 const drops={decoder:counter(states.map(s=>s.drops)),vo:counter(states.map(s=>s.voDrops)),delayedEstimate:counter(states.map(s=>s.voDelayed))};
 let sourceFramesAdvanced=0,coveredMs=0,ambiguousPairs=0;
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],dt=b.elapsedMs-a.elapsedMs;
  if(dt<=0||dt>=5000||![a.pixelCode,b.pixelCode].every(n=>Number.isInteger(n)&&n>=0&&n<150)){ambiguousPairs++;continue;}
  sourceFramesAdvanced+=(b.pixelCode-a.pixelCode+150)%150;coveredMs+=dt;
 }
 const electronPrivate=[];for(const s of samples){const values=s.desktop?.processes?.map(p=>number(p.memory?.privateBytes));if(values?.length&&values.every(n=>n!==null))electronPrivate.push({elapsedMs:s.elapsedMs,rawKiB:values.reduce((a,b)=>a+b,0)});}
 const late=electronPrivate.filter(s=>s.elapsedMs>=Math.min(60000,(report.playbackElapsedMs||0)/2));
 const first=report.resourcesBefore?.processIoIncludingPipes,last=report.resourcesAfter?.processIoIncludingPipes;
 const io=first&&last?Object.fromEntries(Object.keys(first).map(key=>[key,number(last[key])!==null&&number(first[key])!==null?last[key]-first[key]:null])):null;
 return {scope:report.scope,completed:report.completed,playbackElapsedMs:report.playbackElapsedMs,actualDecoderFrameCount:null,decoderCounterLimitation:'libmpv frame-info describes scheduling, not an exact decoder-output count',samples:samples.length,drops,pixelProgress:{sourceFramesAdvanced,coveredMs,ambiguousPairs,sourceTimeToWallRatio:coveredMs?sourceFramesAdvanced/25/(coveredMs/1000):null,meaning:'25fps modulo-150 pixel codes sampled on a repeated six-second fixture; not full-frame coverage or physical scanout'},nativeScheduledFrames:report.scheduledVideoFrames??delta(report.before?.scheduledFrames,report.after?.scheduledFrames),nativeRedrawFrames:report.redrawFrames??delta(report.before?.redrawFrames,report.after?.redrawFrames),nativeUnclassifiedFrames:report.unclassifiedFrames??delta(report.before?.unclassifiedFrames,report.after?.unclassifiedFrames),lateNative:report.lateWindow,lateElectronAggregatePrivate:late.length?{sampleCount:late.length,minRawKiB:Math.min(...late.map(s=>s.rawKiB)),maxRawKiB:Math.max(...late.map(s=>s.rawKiB)),rangeRawKiB:Math.max(...late.map(s=>s.rawKiB))-Math.min(...late.map(s=>s.rawKiB)),units:'Electron app.getAppMetrics memory.privateBytes: KiB; excludes external native host'}:null,nativeCpuTimeMs:report.cpuTimeMs??delta(report.resourcesBefore?.cpuTimeMs,report.resourcesAfter?.cpuTimeMs),nativeProcessIoDelta:io,ioLimitation:'Process I/O includes pipes and cached reads; not physical disk throughput'};
}
function assessDrops(states,elapsedMs){
 const decoder=counter(states.map(s=>s.drops)),vo=counter(states.map(s=>s.voDrops));
 if(!Number.isFinite(elapsedMs)||elapsedMs<=0)throw new Error('Missing playback duration');
 // Gate for the known 25fps fixture, not an arbitrary source FPS claim.
 const voBudget=Math.floor(elapsedMs/1000*25*.001);
 return {decoder,vo,voBudget,passed:decoder.completeMonotonic&&vo.completeMonotonic&&decoder.observedIncrease===0&&vo.observedIncrease<=voBudget,scope:'Known 25fps fixture; zero decoder drop, at most 0.1% observed VO drops; no physical scanout certification'};
}
module.exports={counter,summarize,assessDrops};
