// Orchestration contracts with owned fake adapters, NOT decoding/GPU/hardware or release acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--strict','--skipLibCheck','--target','ES2022','--module','Node16','--moduleResolution','Node16','--outDir','build/playback-session-contract','--rootDir','frontend/src/playback','frontend/src/playback/PlaybackSessionCoordinator.ts'],{cwd:new URL('../..',import.meta.url),windowsHide:true});
const {PlaybackSessionCoordinator:Coordinator,PlaybackSessionFailure:Failure}=createRequire(import.meta.url)('../../build/playback-session-contract/PlaybackSessionCoordinator.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const source=(mediaId=1)=>({mediaId,uri:`avhub-media:${mediaId}`,transport:'direct',offsetSec:0,durationSec:100,resumePositionSec:0,autoplay:true});
class Adapter{
 state={positionSec:0,paused:false,volume:.7,muted:false,rate:1.25,tracks:{sourceIdentity:'fingerprint-1',audio:'a2',subtitle:'s3',delaySec:.4}};
 listeners=new Set();history=[];opens=0;saves=0;closes=0;released=0;seeks=0;deferSeek=false;
 async open(source,identity,signal,resume){this.opens++;this.identity=identity;this.openSignal=signal;if(this.openGate)await this.openGate.promise;if(this.openFailure)throw this.openFailure;this.state=resume??{...this.state,positionSec:source.resumePositionSec,paused:!source.autoplay,tracks:{...this.state.tracks,sourceIdentity:`fingerprint-${source.mediaId}`}};return this.state;}
 snapshot(){return this.state;}
 subscribe(listener){this.listeners.add(listener);this.history.push(listener);return()=>this.listeners.delete(listener);}
 emit(change){this.state={...this.state,...change};this.listeners.forEach(listener=>listener(this.state));}
 async seekTo(seconds,signal){this.seeks++;if(this.deferSeek){const gate=this.seekGate=deferred();const cancel=()=>gate.reject(new DOMException('cancelled','AbortError'));signal.addEventListener('abort',cancel,{once:true});await gate.promise.finally(()=>signal.removeEventListener('abort',cancel));}if(signal.aborted)throw new DOMException('cancelled','AbortError');this.emit({positionSec:seconds});}
 async cancelPending(){this.seekGate?.reject(new DOMException('cancelled','AbortError'));this.seekGate=null;}
 async save(){this.saves++;if(this.saveGate)await this.saveGate.promise;if(this.saveFailure)throw this.saveFailure;}
 async close(){this.closes++;if(this.closeFailure)throw this.closeFailure;this.released++;}
}

test('root scopes share generation while stale close, flush and seek cannot touch a new engine',async()=>{
 const root=new Coordinator({}),a=new Adapter(),b=new Adapter(),chrome=root.scope('chromium',()=>a),native=root.scope('mpv-independent',()=>b);
 await chrome.load(source(1),'chromium');const first=chrome.getState();await native.load(source(1),'mpv-independent');const second=native.getState();
 assert.equal(first.rootId,second.rootId);assert.ok(second.identity.generation>first.identity.generation);assert.equal(a.closes,1);
 await chrome.close();await chrome.flush();await assert.rejects(chrome.seekTo(4),{name:'AbortError'});
 assert.equal(b.closes,0);assert.equal(b.saves,0);assert.equal(native.getState().phase,'ready');assert.equal(chrome.getState().phase,'closed');await root.close();assert.equal(b.closes,1);
});
test('late old open and its unmount close cannot cancel the newly requested scope',async()=>{
 const root=new Coordinator({}),a=new Adapter(),b=new Adapter(),gate=deferred();a.openGate=gate;
 const old=root.scope('chromium',()=>a),next=root.scope('libmpv-d3d11',()=>b);
 const loading=old.load(source(1),'chromium').catch(e=>e);await tick();const opening=next.load(source(2),'libmpv-d3d11'),unmount=old.close();gate.resolve();
 assert.equal((await loading).kind,'cancelled');await opening;await unmount;assert.equal(next.getState().identity.mediaId,2);assert.equal(b.closes,0);assert.equal(a.closes,1);await root.close();
});
test('new scope waits for old close commit and late old cleanup never clears ready state',async()=>{
 const root=new Coordinator({}),a=new Adapter(),b=new Adapter(),gate=deferred(),old=root.scope('chromium',()=>a),next=root.scope('chromium',()=>b);
 await old.load(source(1),'chromium');a.saveGate=gate;const closing=old.close();await tick();const opening=next.load(source(2),'chromium');assert.equal(b.opens,0);gate.resolve();await closing;await opening;
 await old.close();assert.equal(next.getState().phase,'ready');assert.equal(b.opens,1);assert.equal(b.closes,0);await root.close();
});
test('failed prior-owner retirement blocks new factory and stays retryable from the new scope',async()=>{
 const root=new Coordinator({}),a=new Adapter(),b=new Adapter(),old=root.scope('chromium',()=>a),next=root.scope('mpv-independent',()=>b);
 await old.load(source(1),'chromium');a.saveFailure=new Error('write failed');await assert.rejects(next.load(source(2),'mpv-independent'),{kind:'save'});
 assert.equal(b.opens,0);assert.equal(a.closes,0);assert.equal(root.getState().identity.mediaId,1);assert.equal(next.getState().identity,null);
 a.saveFailure=null;await next.load(source(2),'mpv-independent');assert.equal(next.getState().identity.mediaId,2);await old.close();assert.equal(b.closes,0);await root.close();
});
test('scope flush and close coalesce and failed flush blocks both close and root shutdown',async()=>{
 const root=new Coordinator({}),a=new Adapter(),scope=root.scope('chromium',()=>a),gate=deferred();await scope.load(source(),'chromium');a.saveGate=gate;
 const flush=scope.flush();assert.equal(scope.flush(),flush);void flush.catch(()=>{});await tick();const close=scope.close().catch(e=>e),shutdown=root.close().catch(e=>e);gate.reject(new Error('disk busy'));
 assert.equal((await flush.catch(e=>e)).kind,'save');assert.equal((await close).kind,'save');assert.equal((await shutdown).kind,'save');assert.equal(a.closes,0);
 a.saveGate=null;await scope.close();assert.equal(a.closes,1);
});
test('a queued scope can be cancelled while global close is still reclaiming the previous owner',async()=>{
 const root=new Coordinator({}),a=new Adapter(),b=new Adapter(),old=root.scope('chromium',()=>a),next=root.scope('mpv-independent',()=>b),gate=deferred();
 await old.load(source(),'chromium');a.saveGate=gate;const shutdown=root.close();await tick();const opening=next.load(source(2),'mpv-independent').catch(e=>e),cancel=next.close();gate.resolve();await shutdown;assert.equal((await opening).name,'AbortError');await cancel;assert.equal(b.opens,0);assert.equal(next.getState().phase,'closed');
});
function fixture(configure=()=>{}){const adapters=[];const factories=Object.fromEntries(['chromium','mpv-independent','libmpv-d3d11'].map(kind=>[kind,()=>{const adapter=new Adapter();configure(adapter,kind,adapters.length);adapters.push(adapter);return adapter;}]));return {coordinator:new Coordinator(factories),adapters};}

test('old seek and subtitle events cannot change a new media identity',async()=>{
 const {coordinator:c,adapters:a}=fixture();await c.load(source(1),'chromium');a[0].deferSeek=true;
 const seek=c.seekTo(41).catch(error=>error);await tick();assert.equal(a[0].seeks,1);
 await c.load(source(2),'libmpv-d3d11');assert.equal((await seek).name,'AbortError');
 a[0].history[0]({...a[0].state,positionSec:99,tracks:{...a[0].state.tracks,subtitle:'stale'}});
 assert.equal(c.getState().identity.mediaId,2);assert.equal(c.getState().snapshot.positionSec,0);assert.equal(c.getState().snapshot.tracks.subtitle,'s3');
 assert.ok(Object.isFrozen(c.getState().identity));assert.ok(Object.isFrozen(c.getState().snapshot.tracks));await c.close();assert.ok(a.every(adapter=>adapter.released===1));
});
test('queued source and handoff snapshots cannot be mutated by their caller',async()=>{
 const {coordinator:c,adapters:a}=fixture(),mutable=source(1);const loading=c.load(mutable,'chromium');mutable.mediaId=99;mutable.uri='untrusted';await loading;assert.equal(c.getState().identity.mediaId,1);
 a[0].emit({positionSec:34});const switching=c.switchEngine('mpv-independent');a[0].state.tracks.subtitle='changed-after-request';await switching;
 assert.equal(c.getState().snapshot.positionSec,34);assert.equal(c.getState().snapshot.tracks.subtitle,'s3');await c.close();
});
test('cancelled open awaits actual native acquisition and exactly one release',async()=>{
 const gate=deferred();const {coordinator:c,adapters:a}=fixture(adapter=>adapter.openGate=gate);
 const opening=c.load(source(),'libmpv-d3d11').catch(error=>error);await tick();assert.equal(a[0].opens,1);
 let closed=false;const closing=c.close().then(()=>closed=true);await tick();assert.equal(closed,false);assert.equal(a[0].closes,0);
 gate.resolve();assert.equal((await opening).kind,'cancelled');await closing;assert.equal(a[0].closes,1);assert.equal(a[0].released,1);assert.equal(c.getState().phase,'closed');
});
test('close can cancel a queued open before any adapter acquires resources',async()=>{
 const {coordinator:c,adapters:a}=fixture();const opening=c.load(source(),'libmpv-d3d11').catch(error=>error);assert.equal(c.getState().phase,'opening');await c.close();assert.equal((await opening).name,'AbortError');assert.equal(a.length,0);assert.equal(c.getState().phase,'closed');
});
test('30 rapid transitions and shared close leave no double release or pending ownership',{timeout:5000},async()=>{
 const {coordinator:c,adapters:a}=fixture();await c.load(source(),'chromium');
 const tasks=Array.from({length:30},(_,index)=>c.load(source(index+2),index%2?'mpv-independent':'libmpv-d3d11'));
 const results=Promise.allSettled(tasks);const first=c.close();assert.equal(c.close(),first);await first;await results;
 assert.ok(a.every(adapter=>adapter.opens===1&&adapter.released===1&&adapter.closes===1));assert.equal(c.getState().phase,'closed');
});
test('30 acquired alternating sessions reclaim each owner before the next acquisition',async()=>{
 const {coordinator:c,adapters:a}=fixture();
 await Array.from({length:30},(_,index)=>index).reduce(async(prior,index)=>{await prior;await c.load(source(index+1),['chromium','mpv-independent','libmpv-d3d11'][index%3]);assert.equal(a.filter(adapter=>adapter.opens&&!adapter.released).length,1);},Promise.resolve());
 await c.close();assert.equal(a.length,30);assert.ok(a.every(adapter=>adapter.closes===1&&adapter.released===1));
});
test('same-media three-engine roundtrip retains pause, volume, tracks, delay and position',async()=>{
 const {coordinator:c,adapters:a}=fixture();await c.load(source(),'chromium');a[0].emit({positionSec:42,paused:true,muted:true});
 const snapshot=c.getState().snapshot;
 for(const kind of ['mpv-independent','libmpv-d3d11','chromium']){await c.switchEngine(kind);assert.equal(c.getState().identity.engineKind,kind);assert.deepEqual(c.getState().snapshot,snapshot);}
 await c.close();assert.ok(a.every(adapter=>adapter.closes===1));
});
test('flush/close coalesce one unchanged save; simultaneous close shares its promise',async()=>{
 const gate=deferred();const {coordinator:c,adapters:a}=fixture();await c.load(source(),'chromium');a[0].saveGate=gate;
 const flush=c.flush();assert.equal(c.flush(),flush);await tick();const close=c.close();assert.equal(c.close(),close);assert.equal(a[0].saves,1);
 gate.resolve();await Promise.all([flush,close]);assert.equal(a[0].saves,1);assert.equal(a[0].closes,1);
});
test('failed pending save blocks close and fallback until explicit retry',async()=>{
 const gate=deferred();const {coordinator:c,adapters:a}=fixture();await c.load(source(),'chromium');a[0].saveGate=gate;
 const flush=c.flush().catch(error=>error);await tick();const close=c.close().catch(error=>error);gate.reject(new Error('database busy'));
 assert.equal((await flush).kind,'save');assert.equal((await close).kind,'save');assert.equal(a[0].closes,0);assert.equal(c.getState().phase,'error');
 await assert.rejects(c.recover(c.getState().failure,'mpv-independent'),{kind:'save'});assert.equal(a.length,1);
 a[0].saveGate=null;await c.close();assert.equal(a[0].saves,2);assert.equal(a[0].closes,1);assert.equal(c.getState().phase,'closed');
});
test('cleanup failures retain ownership and cannot silently fall back',async()=>{
 const {coordinator:c,adapters:a}=fixture();await c.load(source(),'chromium');a[0].closeFailure=new Error('handle still owned');
 await assert.rejects(c.close(),{kind:'cleanup'});assert.equal(c.getState().identity.mediaId,1);assert.equal(a[0].released,0);
 await assert.rejects(c.recover(c.getState().failure,'mpv-independent'),{kind:'cleanup'});assert.equal(a.length,1);
 a[0].closeFailure=null;await c.close();assert.equal(a[0].released,1);assert.equal(a[0].saves,1);
});
test('one safe initialization fallback restores old intent, reports failure, never loops',async()=>{
 const {coordinator:c,adapters:a}=fixture((adapter,kind)=>{if(kind==='libmpv-d3d11')adapter.openFailure=new Failure('initialization','device setup failed','open');});
 await c.load(source(),'chromium');a[0].emit({positionSec:36,paused:true});
 await assert.rejects(c.switchEngine('libmpv-d3d11'),{kind:'initialization'});
 assert.equal(c.getState().phase,'ready');assert.equal(c.getState().identity.engineKind,'chromium');assert.equal(c.getState().snapshot.positionSec,36);assert.equal(c.getState().snapshot.paused,true);assert.equal(c.getState().automaticRecoveries,1);
 await assert.rejects(c.recover(c.getState().failure,'mpv-independent'),{kind:'initialization'});assert.equal(a.length,3);await c.close();assert.ok(a.every(adapter=>adapter.released===1));
});
test('runtime missing may recover once; integrity, auth, media, save and cleanup may not',async()=>{
 const {coordinator:c,adapters:a}=fixture();await c.load(source(),'chromium');
 for(const kind of ['integrity','unauthorized','source-invalid','media-offline','backend-aborted','save','cleanup','device-lost','unknown'])await assert.rejects(c.recover(new Failure(kind,kind,'test'),'mpv-independent'),{kind});
 assert.equal(a.length,1);await c.recover(new Failure('runtime-missing','libmpv.dll missing','open'),'mpv-independent');assert.equal(c.getState().automaticRecoveries,1);
 await assert.rejects(c.recover(new Failure('runtime-missing','still missing','open'),'chromium'),{kind:'runtime-missing'});assert.equal(a.length,2);await c.close();
});

test('recovery for a failed new source cannot inherit old source position or tracks',async()=>{
 const {coordinator:c,adapters:a}=fixture((adapter,kind)=>{if(kind==='libmpv-d3d11')adapter.openFailure=new Failure('runtime-missing','missing runtime','open');});
 await c.load(source(1),'chromium');a[0].emit({positionSec:57,tracks:{...a[0].state.tracks,subtitle:'old-source-only'}});
 await assert.rejects(c.load(source(2),'libmpv-d3d11'),{kind:'runtime-missing'});
 await c.recover(c.getState().failure,'chromium');assert.equal(c.getState().identity.mediaId,2);assert.equal(c.getState().snapshot.positionSec,0);assert.equal(c.getState().snapshot.tracks.sourceIdentity,'fingerprint-2');assert.equal(c.getState().snapshot.tracks.subtitle,'s3');await c.close();
});

test('superseding a rollback cancels it without publishing a stale recovery error',async()=>{
 const gate=deferred();const {coordinator:c,adapters:a}=fixture((adapter,kind,index)=>{if(kind==='libmpv-d3d11')adapter.openFailure=new Failure('initialization','failed setup','open');if(index===2)adapter.openGate=gate;});
 await c.load(source(),'chromium');const switching=c.switchEngine('libmpv-d3d11').catch(error=>error);await tick();assert.equal(a.length,3);
 const loading=c.load(source(2),'mpv-independent');gate.resolve();assert.equal((await switching).name,'AbortError');await loading;
 assert.equal(c.getState().identity.mediaId,2);assert.equal(c.getState().phase,'ready');assert.equal(c.getState().failure,null);await c.close();assert.ok(a.every(adapter=>adapter.released===1));
});
