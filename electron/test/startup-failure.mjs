// Real Electron + actual isolated backend/owned process tree; no user library.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),build=path.join(root,'build');mkdirSync(build,{recursive:true});
const folder=mkdtempSync(path.join(build,'startup-failure-'));
const report={passed:false,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),cases:[]};
const persist=()=>writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify(report,null,2));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
function terminateOwned(pid){
 if(!pid||!alive(pid))return;
 if(process.platform==='win32')spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});
 else process.kill(pid,'SIGKILL');
}
persist();
try{
 for(const name of ['window-create','missing-runtime','timeout-tree']){
  const home=path.join(folder,name);mkdirSync(home);const profile=path.join(home,'profile');
  const config={root,case:name,result:path.join(home,'child.json')};const configFile=path.join(home,'run.json');writeFileSync(configFile,JSON.stringify(config));
  const env={...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:home,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'};
  delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
  if(name==='missing-runtime')env.AVHUB_PYTHON=path.join(home,'owned-missing-runtime.exe');
  const started=Date.now();let output='',childResult,child,verifiedStopped=false;
  try{
   child=spawn(createRequire(import.meta.url)('electron'),[path.join(root,'electron/test/startup-failure.cjs'),configFile],{cwd:home,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output=(output+data).slice(-32768);});
   let timer;let exit;
   try{exit=await Promise.race([
    new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned startup fault test exceeded 75s')),75000);}),
   ]);}finally{clearTimeout(timer);}
   childResult=JSON.parse(readFileSync(config.result,'utf8'));
   const log=readFileSync(path.join(profile,'desktop.log'),'utf8');
   assert.equal(exit.code,0);assert.equal(childResult.willQuit,true);assert.equal(childResult.errorDialogs,1);
   assert.ok(log.includes('startup-error'));assert.ok(log.includes('startup-cleanup-complete'));
   assert.ok(log.indexOf('startup-error')<log.indexOf('startup-cleanup-complete'));
   const elapsedMs=Date.now()-started;
   if(name==='window-create'){
    assert.equal(childResult.windowAttempts,1);assert.ok(log.includes('backend-ready'));
    assert.ok(log.includes('backend-stopped gracefully'));
   }else if(name==='missing-runtime'){
    assert.equal(childResult.backendPid,null);assert.ok(log.includes('backend-not-started'));
    assert.ok(elapsedMs<20000,'A spawn error must not wait for the 45s health deadline');
   }else{
    assert.ok(log.includes('backend-force-stop'));assert.ok(childResult.descendantPid);
    assert.ok(elapsedMs>=45000&&elapsedMs<70000,'Production startup/cleanup deadlines must remain bounded');
   }
   for(const pid of [childResult.backendPid,childResult.descendantPid].filter(Boolean))assert.equal(alive(pid),false,'Owned backend/descendant must not survive failed startup');
   const port=Number(log.match(/backend-start port=(\d+)/)?.[1]);assert.ok(port>0);
   await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}));
   verifiedStopped=true;
   report.cases.push({name,elapsedMs,backendStopped:true,descendantStopped:name==='timeout-tree'?true:null,willQuit:true});persist();
  }finally{
   writeFileSync(path.join(home,'output.log'),output);
   if(child&&child.exitCode===null&&child.signalCode===null)terminateOwned(child.pid);
   // Cleanup only PIDs emitted by this test-owned entry, never enumerated apps.
   if(!verifiedStopped){
    if(!childResult&&existsSync(config.result))childResult=JSON.parse(readFileSync(config.result,'utf8'));
    for(const pid of [childResult?.backendPid,childResult?.descendantPid].filter(Boolean))terminateOwned(pid);
   }
  }
 }
 report.passed=true;console.log('Real Electron startup failure cleanup passed:',JSON.stringify(report.cases));
}finally{persist();console.log('Startup fault evidence:',path.join(folder,'acceptance.json'));}
