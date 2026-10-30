// Keep raw oscillation separate from upward pressure. A driver trim is not a leak.
function convergence(before,after,samples){
 if(before.length<15||after.length<15||!samples.length)throw new Error('Missing released-frame idle evidence');
 for(const p of [...before,...after])if(p.transfers.imports!==p.transfers.released)throw new Error('Idle resources still have active GPU readers');
 const median=v=>{const a=[...v].sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
 const value=(r,key)=>key==='gpu'?r.gpuMemory?.CurrentUsage:r[key];
 const result={};for(const key of ['handles','privateBytes','gpu']){
  const start=before.map(p=>value(p.resources,key)),end=after.map(p=>value(p.resources,key)),active=samples.map(p=>value(p.resources,key));
  if([...start,...end,...active].some(n=>!Number.isFinite(n)||n<0))throw new Error('Missing resource metric '+key);
  const baseline=median(start),settled=median(end);
  result[key]={baseline,settled,activeMin:Math.min(...active),activeMax:Math.max(...active),activeRange:Math.max(...active)-Math.min(...active),peakPositiveGrowth:Math.max(0,Math.max(...active)-baseline),settledPositiveGrowth:Math.max(0,settled-baseline),idleRange:Math.max(...end)-Math.min(...end)};
 }
 return result;
}
module.exports={convergence};
