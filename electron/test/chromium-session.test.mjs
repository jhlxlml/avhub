// Pure owner contracts with fake video callbacks/ports; not decoder acceptance.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--strict','--skipLibCheck','--target','ES2022','--module','Node16','--moduleResolution','Node16','--outDir','build/chromium-session-contract','--rootDir','frontend/src','frontend/src/playback/ChromiumSessionAdapter.ts'],{cwd:new URL('../..',import.meta.url),windowsHide:true});
const require=createRequire(import.meta.url),{ChromiumSessionAdapter:Adapter}=require('../../build/chromium-session-contract/playback/ChromiumSessionAdapter.js'),{PlaybackSessionCoordinator:Coordinator}=require('../../build/chromium-session-contract/playback/PlaybackSessionCoordinator.js');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const callbacks=new Map();let sequence=0;
 const video=Object.assign(new EventTarget(),{currentTime:0,readyState:0,videoWidth:0,seeking:false,paused:true,ended:false,error:null,
  requestVideoFrameCallback(fn){callbacks.set(++sequence,fn);return sequence;},cancelVideoFrameCallback(id){callbacks.delete(id);},
  present(time){video.currentTime=time;video.readyState=2;video.videoWidth=640;const rows=[...callbacks.values()];callbacks.clear();rows.forEach(fn=>fn(0,{mediaTime:time}));},
 });
 const state={positionSec:0,volume:.7,muted:true,rate:1.25},saved=[];let disposed=0,released=0;
 const engine={getState:()=>({...state,positionSec:video.currentTime+10}),subscribe:()=>()=>{},cancelPending(){},async dispose(){disposed++;},
  async seekTo(value){video.seeking=true;video.currentTime=value-10;video.present(value-10);video.seeking=false;video.dispatchEvent(new Event('seeked'));},
 };
 const ports={saveFailure:false,releaseFailure:false,async open(){},tracks:()=>({sourceIdentity:'owned-source',audio:'2',subtitle:'srt',delaySec:.3}),
  async save(snapshot,ended){saved.push({snapshot,ended});if(ports.saveFailure)throw new Error('disk write failed');},
  async release(){if(ports.releaseFailure)throw new Error('token retirement failed');released++;},
 };
 const adapter=new Adapter(engine,video,ports),c=new Coordinator({chromium:()=>adapter});
 const load=()=>c.load({mediaId:1,uri:'/media/1/file',transport:'direct',offsetSec:10},'chromium');
 return {video,adapter,c,ports,saved,load,resources:()=>({disposed,released,callbacks:callbacks.size})};
}
test('load ACK cannot publish readiness before an actual video frame callback',async()=>{
 const f=fixture(),loading=f.load();await tick();assert.equal(f.c.getState().phase,'opening');f.video.present(2);await loading;assert.equal(f.c.getState().phase,'ready');assert.equal(f.c.getState().snapshot.positionSec,12);await f.c.close();assert.equal(f.resources().callbacks,0);
});
test('paused seek frame arriving before seeked is retained as target evidence',async()=>{
 const f=fixture(),loading=f.load();await tick();f.video.present(0);await loading;await f.c.seekTo(18);assert.equal(f.c.getState().snapshot.positionSec,18);assert.equal(f.c.getState().snapshot.paused,true);await f.c.close();
});
test('retirement freezes old clock and tracks before shared video refs reset',async()=>{
 const f=fixture(),loading=f.load();await tick();f.video.present(4);await loading;f.adapter.captureForClose();f.video.currentTime=0;f.video.readyState=0;await f.c.close();assert.equal(f.saved.at(-1).snapshot.positionSec,14);assert.equal(f.saved.at(-1).snapshot.tracks.subtitle,'srt');assert.equal(f.resources().released,1);
});
test('save failure retains decoder owner until explicit retry',async()=>{
 const f=fixture(),loading=f.load();await tick();f.video.present(3);await loading;f.ports.saveFailure=true;await assert.rejects(f.c.close(),e=>e.kind==='save');assert.equal(f.resources().released,0);assert.equal(f.resources().disposed,0);f.ports.saveFailure=false;await f.c.close();assert.equal(f.resources().released,1);
});
test('release failure retains a retryable cleanup owner',async()=>{
 const f=fixture(),loading=f.load();await tick();f.video.present(3);await loading;f.ports.releaseFailure=true;await assert.rejects(f.c.close(),e=>e.kind==='cleanup');assert.equal(f.resources().released,0);f.ports.releaseFailure=false;await f.c.close();assert.equal(f.resources().released,1);
});
test('close cancels a first-frame wait and retires the pending owner',async()=>{
 const f=fixture(),loading=f.load().catch(e=>e);await tick();await f.c.close();assert.equal((await loading).kind,'cancelled');assert.equal(f.c.getState().phase,'closed');assert.equal(f.resources().released,1);assert.equal(f.saved[0].snapshot,null);assert.equal(f.resources().callbacks,0);
});
