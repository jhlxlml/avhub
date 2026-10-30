// A real host initialization failure, without deleting/changing any runtime DLL.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {_electron,expect} from '@playwright/test';
import {sourceFingerprint} from './framecode-fixtures.mjs';
import attestation from './runtime-attestation.cjs';
const root=path.resolve(import.meta.dirname,'../../..'),base=path.join(root,'build/libmpv-render-spike'),packaged=process.argv.includes('--packaged'),folder=mkdtempSync(path.join(base,'startup-fault-')),report={scope:'Owned native host receives a fixed missing DLL suffix; no actual file removed',completed:false};
let desktop,pid;
try{
 const env={...process.env,AVHUB_RENDER_INJECT_START_FAILURE:'1',AVHUB_RENDER_SHARED_TEXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 let input;if(packaged){input=JSON.parse(readFileSync(path.join(base,'packaged-location.json')));report.sourceFingerprint=await sourceFingerprint();report.artifact=attestation.verifyLocation(input,report.sourceFingerprint,base);}
 desktop=await _electron.launch({...packaged?{executablePath:input.executable,args:[]}:{args:[path.join(import.meta.dirname,'main.cjs')]},cwd:base,env,timeout:30000});
 await expect.poll(()=>desktop.evaluate(()=>Boolean(globalThis.__renderSpike))).toBe(true);pid=await desktop.evaluate(()=>globalThis.__renderSpike.pid);
 const page=desktop.windows().find(w=>w.url().endsWith('/index.html'));assert.ok(page);
 await expect(page.getByRole('alert')).toContainText('Host exited');await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.hostExited())).toBe(true);
 await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('menu')).toBeVisible();
 assert.equal(await desktop.evaluate(()=>globalThis.__renderSpike.main.isDestroyed()),false);
 report.transfers=await desktop.evaluate(()=>({...globalThis.__renderSpike.transferStats}));assert.equal(report.transfers.imports,0);assert.equal(report.transfers.released,0);
 await page.screenshot({path:path.join(folder,'diagnostic.png')});await desktop.close();desktop=null;
 const check=spawnSync('powershell.exe',['-NoProfile','-Command',`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 1 }`],{windowsHide:true});assert.equal(check.status,0);report.noOrphan=true;report.completed=true;
}catch(error){report.error=String(error.stack||error);throw error;}finally{if(desktop)await desktop.close().catch(()=>{});writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify(report,null,2));console.log(folder);}
