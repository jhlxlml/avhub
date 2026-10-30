// Real Electron, trusted own process/child only. Used before/after ownership repair.
import {_electron,expect} from '@playwright/test';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../../..'),folder=path.join(root,'build/libmpv-render-spike');
const evidence=mkdtempSync(path.join(folder,'handle-crash-'));
const packaged=JSON.parse(readFileSync(path.join(folder,'packaged-location.json')));
const env={...process.env,AVHUB_RENDER_FP16:'1',AVHUB_RENDER_SHARED_TEXTURE:'1',AVHUB_RENDER_SAMPLE:'Framecode-v3-3840x2160-av1.mkv'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
let desktop;const report={scope:'Own private M2 Electron process; abrupt child termination, not normal disposal',completed:false};
try{
 desktop=await _electron.launch({executablePath:packaged.executable,args:[],cwd:folder,env,timeout:30000});
 await expect.poll(()=>desktop.evaluate(()=>Boolean(globalThis.__renderSpike)),{timeout:30000}).toBe(true);
 await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.transferStats.imports)).toBeGreaterThan(2);
 report.before=await desktop.evaluate(async (_electron,ffi)=>{
  const k=process.getBuiltinModule('module').createRequire(process.execPath)(ffi),lib=k.load('kernel32.dll');
  globalThis.__ownHandleInfo=lib.func('int __stdcall GetHandleInformation(void *handle, _Out_ uint32_t *flags)');
  const s=await globalThis.__renderSpike.command('snapshot');globalThis.__ownSharedHandle=BigInt(s.shared.handle);
  globalThis.__newHandleOwnership=s.shared.handleOwner==='native-source';
  if(globalThis.__newHandleOwnership)return {ownership:'parent-owned',...globalThis.__renderSpike.handleStats(),transfers:{...globalThis.__renderSpike.transferStats}};
  return {valid:!!globalThis.__ownHandleInfo(globalThis.__ownSharedHandle,[0]),transfers:{...globalThis.__renderSpike.transferStats}};
 },path.join(folder,'ffi/node_modules/koffi'));
 await desktop.evaluate(()=>process.kill(globalThis.__renderSpike.pid));
 await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.hostExited())).toBe(true);
 await expect.poll(()=>desktop.evaluate(()=>{const s=globalThis.__renderSpike.transferStats;return s.imports-s.released;})).toBe(0);
 if(report.before.ownership==='parent-owned')await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.handleStats().live)).toBe(0);
 report.after=await desktop.evaluate(()=>({...globalThis.__newHandleOwnership?globalThis.__renderSpike.handleStats():{valid:!!globalThis.__ownHandleInfo(globalThis.__ownSharedHandle,[0])},uiAlive:!globalThis.__renderSpike.main.isDestroyed(),transfers:{...globalThis.__renderSpike.transferStats}}));
 report.leakReproduced=report.before.valid&&report.after.valid;report.completed=true;
 if(report.before.ownership==='parent-owned')expect(report.leakReproduced).toBe(false);
}finally{if(desktop)await desktop.close();writeFileSync(path.join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(evidence,JSON.stringify(report));}
