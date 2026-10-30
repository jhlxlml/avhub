// Raw webFrame counters are a partial cache view, never total allocation/VRAM.
const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const stats=values=>{
 const sorted=values.filter(valid).sort((a,b)=>a-b);
 return sorted.length?{min:sorted[0],median:sorted[Math.floor((sorted.length-1)/2)],max:sorted.at(-1)}:{min:null,median:null,max:null};
};
export function summarizeMemoryResources(points){
 const rows=points.map(point=>point?.resourceUsage).filter(value=>value&&typeof value==='object');
 const kinds=['images','scripts','cssStyleSheets','xslStyleSheets','fonts','other'];
 return {samples:rows.length,
  caches:Object.fromEntries(kinds.map(kind=>[kind,Object.fromEntries(['count','size','liveSize'].map(key=>[key,stats(rows.map(row=>row.resources?.[kind]?.[key]))]))])),
  jsHeapUsedBytes:stats(rows.map(row=>row.jsHeapUsedBytes)),
  limitation:'size/liveSize preserve raw Electron webFrame counters. Not complete decoded image memory, process private bytes or GPU VRAM. Missing is null, not zero.',
 };
}
