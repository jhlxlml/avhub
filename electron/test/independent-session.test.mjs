// Typed adapter/coordinator contracts on a fake IPC port, not native decoding.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--strict','--skipLibCheck','--target','ES2022','--module','Node16','--moduleResolution','Node16','--outDir','build/independent-session-contract','--rootDir','frontend/src','frontend/src/playback/IndependentSessionAdapter.ts','frontend/src/vite-env.d.ts'],{cwd:new URL('../..',import.meta.url),windowsHide:true});
const require=createRequire(import.meta.url),{IndependentSessionAdapter:Adapter}=require('../../build/independent-session-contract/playback/IndependentSessionAdapter.js'),{PlaybackSessionCoordinator:Coordinator}=require('../../build/independent-session-contract/playback/PlaybackSessionCoordinator.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const source=id=>({mediaId:id,uri:`avhub-media:${id}`,transport:'direct',offsetSec:0,resumePositionSec:4.16,autoplay:false});
function fixture(){
 const states=new Set(),closed=new Set(),history=[],calls=[];let raw,sequence=0;
 const port={states,closed,history,calls,failSave:false,failClose:false,openGate:null,deferSeek:false,
  emit(change){raw={...raw,...change,revision:raw.revision+1};states.forEach(fn=>fn(structuredClone(raw)));},
  retire(){closed.forEach(fn=>fn({session:raw.session}));},
  async invoke(action,input){calls.push({action,input});if(action==='open'){
   raw={session:'native-'+ ++sequence,mediaId:input.mediaId,presentation:'independent',revision:1,phase:'ready',restarts:1,pendingSeek:null,seekMode:null,lastSeekTarget:null,lastSeekPosition:null,sourceIdentity:'a'.repeat(64),properties:{'time-pos':input.start,pause:input.paused,volume:70,mute:true,speed:1.25,aid:2,sid:3,'sub-delay':.4,duration:100}};
   if(port.openGate)await port.openGate;return {session:raw.session,presentation:'independent'};
  }
  if(action==='snapshot')return structuredClone(raw);
  if(action==='flush'&&port.failSave)throw new Error('injected write failure');
  if(action==='close'){if(port.failClose)throw new Error('injected owned-process exit failure');port.retire();}
  if(action==='seek'){port.emit({pendingSeek:input.value});if(!port.deferSeek)port.settle(input.value);}
  return {ok:true};},
  settle(seconds){port.emit({pendingSeek:null,lastSeekTarget:seconds,lastSeekPosition:seconds,restarts:raw.restarts+1,properties:{...raw.properties,'time-pos':seconds}});},
  onState(fn){states.add(fn);history.push(fn);return()=>states.delete(fn);},onClosed(fn){closed.add(fn);return()=>closed.delete(fn);},
 };
 const adapters=[],coordinator=new Coordinator({'mpv-independent':()=>{const a=new Adapter(port,{timeoutMs:1000});adapters.push(a);return a;}});
 return {port,coordinator,adapters,get raw(){return structuredClone(raw);}};
}
test('real ready state, pause intent and source-bound track memory enter coordinator',async()=>{
 const f=fixture();await f.coordinator.load(source(1),'mpv-independent');const s=f.coordinator.getState();
 assert.equal(s.phase,'ready');assert.equal(f.port.calls[0].input.paused,true);assert.equal(s.snapshot.positionSec,4.16);assert.equal(s.snapshot.paused,true);assert.equal(s.snapshot.volume,.7);assert.equal(s.snapshot.rate,1.25);assert.deepEqual(s.snapshot.tracks,{sourceIdentity:'a'.repeat(64),audio:'2',subtitle:'3',delaySec:.4});await f.coordinator.close();assert.equal(f.port.states.size,0);assert.equal(f.port.closed.size,0);
});
test('closing during real acquisition waits for open receipt then releases once',async()=>{
 const f=fixture();let finish;f.port.openGate=new Promise(resolve=>finish=resolve);
 const opening=f.coordinator.load(source(1),'mpv-independent').catch(e=>e);await tick();let done=false;const close=f.coordinator.close().then(()=>done=true);await tick();assert.equal(done,false);assert.equal(f.port.calls.filter(c=>c.action==='close').length,0);finish();assert.equal((await opening).kind,'cancelled');await close;assert.equal(f.port.calls.filter(c=>c.action==='close').length,1);
});
test('old native revision/session/media events cannot overwrite a new source',async()=>{
 const f=fixture();await f.coordinator.load(source(1),'mpv-independent');const stale=f.raw;await f.coordinator.load(source(2),'mpv-independent');f.port.history[0]({...stale,revision:999,properties:{...stale.properties,'time-pos':99}});f.port.emit({mediaId:1});assert.equal(f.coordinator.getState().identity.mediaId,2);assert.equal(f.coordinator.getState().snapshot.positionSec,4.16);await f.coordinator.close();
});
test('seek ACK or metadata alone is insufficient; a matching native restart is required',async()=>{
 const f=fixture();await f.coordinator.load(source(1),'mpv-independent');f.port.deferSeek=true;let done=false;const task=f.coordinator.seekTo(17).then(()=>done=true);await tick();assert.equal(done,false);f.port.emit({properties:{...f.raw.properties,'time-pos':17}});await tick();assert.equal(done,false);f.port.settle(17);await task;assert.equal(f.coordinator.getState().snapshot.positionSec,17);await f.coordinator.close();
});
test('latest seek cancels the old JS wait and uses existing native seek queue',async()=>{
 const f=fixture();await f.coordinator.load(source(1),'mpv-independent');f.port.deferSeek=true;const first=f.coordinator.seekTo(7).catch(e=>e);await tick();const second=f.coordinator.seekTo(19);await tick();assert.equal((await first).name,'AbortError');f.port.settle(7);await tick();f.port.settle(19);await second;assert.equal(f.coordinator.getState().snapshot.positionSec,19);await f.coordinator.close();
});
test('save failure retains ownership and retry closes only after a successful flush',async()=>{
 const f=fixture();await f.coordinator.load(source(1),'mpv-independent');f.port.failSave=true;await assert.rejects(()=>f.coordinator.close(),e=>e.kind==='save');assert.equal(f.port.calls.filter(c=>c.action==='close').length,0);assert.equal(f.port.states.size,1);f.port.failSave=false;await f.coordinator.close();assert.equal(f.port.calls.filter(c=>c.action==='close').length,1);assert.equal(f.port.states.size,0);
});
test('failed native close is retained and can be retried without forgetting owner',async()=>{
 const f=fixture();await f.coordinator.load(source(1),'mpv-independent');f.port.failClose=true;await assert.rejects(()=>f.coordinator.close(),e=>e.kind==='cleanup');assert.equal(f.port.states.size,1);f.port.failClose=false;await f.coordinator.close();assert.equal(f.port.states.size,0);
});
test('authoritative native close does not flush an already retired session',async()=>{
 const f=fixture();await f.coordinator.load(source(1),'mpv-independent');f.port.retire();await f.coordinator.close();assert.equal(f.port.calls.filter(c=>c.action==='flush'||c.action==='close').length,0);assert.equal(f.coordinator.getState().phase,'closed');
});

test('independent keyframe result uses the measured landing without claiming exactness',async()=>{
 const f=fixture();await f.coordinator.load(source(1),'mpv-independent');f.port.deferSeek=true;
 let done=false;const seek=f.coordinator.seekTo(17).then(()=>done=true);await tick();
 f.port.emit({pendingSeek:null,lastSeekTarget:17,lastSeekPosition:12,restarts:2,seekDiagnostics:{strategy:'keyframe',target:18,position:12},properties:{...f.raw.properties,'time-pos':12}});
 await tick();assert.equal(done,false);
 f.port.emit({seekDiagnostics:{strategy:'keyframe',target:17,position:12}});
 await seek;assert.equal(f.coordinator.getState().snapshot.positionSec,12);await f.coordinator.close();
});
