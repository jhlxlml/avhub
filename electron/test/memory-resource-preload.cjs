// Test-only session preload, never packaged or registered by production code.
// No filesystem, IPC, timers, GC, cache purging or mutation APIs are exposed.
const {contextBridge,webFrame}=require('electron');
const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
contextBridge.exposeInMainWorld('__avhubMemoryResources',{
 snapshot:()=>{
  const raw=webFrame.getResourceUsage(),resources={};
  for(const kind of ['images','scripts','cssStyleSheets','xslStyleSheets','fonts','other']){
   resources[kind]=Object.fromEntries(['count','size','liveSize'].map(key=>[key,numeric(raw?.[kind]?.[key])]));
  }
  return {resources,jsHeapUsedBytes:numeric(performance.memory?.usedJSHeapSize)};
 },
});
