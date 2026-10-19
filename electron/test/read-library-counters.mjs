// Non-mutating companion for an already running, isolated cover stress test.
// Never call prepareForLeakDetection, collectGarbage, reload or clearCache.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,appendFileSync} from 'node:fs';
import path from 'node:path';
const profile=realpathSync(process.argv[2]??'');
assert.equal(path.basename(profile),'profile');
assert.match(path.basename(path.dirname(profile)),/^avhub-cover-stress-[a-zA-Z0-9]+$/);
const port=Number(readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);
assert.ok(Number.isInteger(port)&&port>0&&port<65536);
const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(5000)})).json();
const target=targets.find(target=>{try{const url=new URL(target.url||'about:blank');return target.type==='page'&&url.hostname==='127.0.0.1'&&!url.searchParams.has('nativePlayer');}catch{return false;}});
assert.ok(target,'Owned test main renderer must exist');
const address=new URL(target.webSocketDebuggerUrl);
assert.ok(address.protocol==='ws:'&&address.hostname==='127.0.0.1'&&Number(address.port)===port);
const socket=new WebSocket(address);let sequence=0;
const query=method=>new Promise((resolve,reject)=>{
  const id=++sequence;
  const finish=()=>{clearTimeout(timer);socket.removeEventListener('message',message);socket.removeEventListener('error',error);socket.removeEventListener('close',closed);};
  const message=event=>{const value=JSON.parse(event.data);if(value.id!==id)return;finish();value.error?reject(new Error(value.error.message)):resolve(value.result);};
  const error=()=>{finish();reject(new Error('Read-only diagnostic transport failed'));};
  const closed=()=>{finish();reject(new Error('Owned renderer closed during sampling'));};
  const timer=setTimeout(()=>{finish();reject(new Error('Read-only diagnostic timed out'));},5000);
  socket.addEventListener('message',message);socket.addEventListener('error',error);socket.addEventListener('close',closed);
  socket.send(JSON.stringify({id,method}));
});
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Diagnostic connection timed out')),5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Cannot connect to owned diagnostic target'));},{once:true});});
  const dom=await query('Memory.getDOMCounters'),heap=await query('Runtime.getHeapUsage');
  let checkpointElapsedMs=null;try{checkpointElapsedMs=JSON.parse(readFileSync(path.join(profile,'../progress.json'),'utf8')).elapsedMs;}catch{}
  const row={at:new Date().toISOString(),checkpointElapsedMs,phase:new URL(target.url).searchParams.has('video')?'playback':'library',dom,heap};
  appendFileSync(path.join(profile,'../renderer-counters.jsonl'),JSON.stringify(row)+'\n');console.log(JSON.stringify(row));
}finally{socket.close();}
