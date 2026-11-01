// Adapter contracts with an explicit fake port. These are not native playback evidence.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--noCheck','--target','ES2022','--module','Node16','--moduleResolution','Node16','--outDir','build/mpv-engine-contract','--rootDir','frontend/src/playback','frontend/src/playback/types.ts','frontend/src/playback/MpvEngine.ts'],{cwd:new URL('../..',import.meta.url),windowsHide:true});
const {MpvEngine}=require('../../build/mpv-engine-contract/MpvEngine.js');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const source=(id=1)=>({mediaId:id,uri:`avhub-media:${id}`,transport:'direct',offsetSec:0});
const state=(s,extra={})=>({session:`session-${s.mediaId}`,generation:s.generation,mediaId:s.mediaId,revision:1,status:'playing',positionSec:s.startSec,durationSec:120,volume:.7,muted:false,rate:1,tracks:[{id:'1',type:'audio',selected:true},{id:'2',type:'subtitle',selected:false}],...extra});
const tick=()=>new Promise(r=>setImmediate(r));
function port(){const p={listeners:new Set(),calls:[],detachments:0,attachments:0,async attach(){p.attachments++;return async()=>{p.detachments++;};},async open(s){p.calls.push(['open',s.mediaId]);return state(s);},async command(...args){p.calls.push(['command',...args]);},async close(...args){p.calls.push(['close',...args]);},subscribe(fn){p.listeners.add(fn);return()=>p.listeners.delete(fn);},emit(s){for(const fn of p.listeners)fn(s);}};return p;}
async function setup(){const p=port(),engine=new MpvEngine(p);await engine.init({nativeSurface:{}});return {p,engine};}

test('metadata and play intent survive a temporary paused seek; malformed source identity is rejected',async()=>{
 const {p,engine}=await setup();await engine.load(source());const native=state({mediaId:1,generation:1,startSec:0},{revision:2,status:'paused',playIntent:true,sourceIdentity:'a'.repeat(64),subtitleDelaySec:.8,presented:{serial:1,positionSec:0,seekId:0}});
 p.emit(native);assert.equal(engine.getPlayIntent(),true);assert.equal(engine.getPresentedSerial(),1);assert.equal(engine.getTrackSelection().sourceIdentity,'a'.repeat(64));assert.equal(engine.getTrackSelection().delaySec,.8);
 p.emit({...native,revision:3,sourceIdentity:'file:///unauthorized',subtitleDelaySec:9});assert.equal(engine.getTrackSelection().delaySec,.8);assert.equal(engine.getTrackSelection().sourceIdentity,'a'.repeat(64));await engine.dispose();
});

test('explicit seek cancellation rejects the wait and awaits native cancellation ACK',async()=>{
 const {p,engine}=await setup();await engine.load(source());const gate=deferred();p.command=async(...args)=>{p.calls.push(['command',...args]);if(args[2]==='cancel-seek')await gate.promise;};
 const seek=engine.seekTo(40).catch(error=>error);let done=false;const cancel=engine.cancelPendingSeek().then(()=>done=true);assert.equal((await seek).name,'AbortError');await tick();assert.equal(done,false);gate.resolve();await cancel;assert.equal(done,true);await engine.dispose();
});
test('init shares one attachment and dispose waits for pending attachment cleanup',async()=>{
 const p=port(),gate=deferred();p.attach=async()=>{p.attachments++;await gate.promise;return async()=>{p.detachments++;};};const engine=new MpvEngine(p),surface={};
 const init=engine.init({nativeSurface:surface}),rejected=assert.rejects(init,{name:'AbortError'});assert.equal(engine.init({nativeSurface:surface}),init);
 await assert.rejects(engine.init({nativeSurface:{}}),/已经初始化/);let finished=false;const stopping=engine.dispose().then(()=>finished=true);await tick();assert.equal(finished,false);gate.resolve();await rejected;await stopping;assert.equal(p.attachments,1);assert.equal(p.detachments,1);
});
test('canonical media ids only, invalid generation cannot cancel the active load',async()=>{
 const {p,engine}=await setup(),gate=deferred();p.open=async s=>{await gate.promise;return state(s);};const loading=engine.load(source());await tick();
 await assert.rejects(engine.load(source(2),{generation:1}),/代次/);await assert.rejects(engine.load({...source(),uri:'file:///private.mp4'}),/媒体 ID/);gate.resolve();await loading;assert.equal(engine.getState().mediaId,1);await engine.dispose();
});
test('aborted open closes its real session before a replacement and ignores old events',async()=>{
 const {p,engine}=await setup(),gate=deferred();let count=0;p.open=async s=>{p.calls.push(['open',s.mediaId]);if(++count===1)await gate.promise;return state(s);};
 const first=engine.load(source()),rejected=assert.rejects(first,{name:'AbortError'});await tick();const second=engine.load(source(2));await rejected;gate.resolve();await second;
 assert.deepEqual(p.calls.slice(0,3),[['open',1],['close','session-1',1],['open',2]]);
 p.emit(state({mediaId:1,generation:1,startSec:99},{revision:200}));assert.equal(engine.getState().positionSec,0);await engine.dispose();
});
test('early state event is replayed only for the opened identity and newer revision',async()=>{
 const {p,engine}=await setup();p.open=async s=>{p.emit(state(s,{revision:3,positionSec:4}));return state(s);};await engine.load(source());assert.equal(engine.getState().positionSec,4);
 p.emit(state({mediaId:1,generation:1,startSec:90},{revision:2}));assert.equal(engine.getState().positionSec,4);await engine.dispose();
});
test('seek waits for a fresh actually presented target, not command ack or time-pos',async()=>{
 const {p,engine}=await setup();await engine.load(source());let complete=false;const seek=engine.seekTo(30).then(()=>complete=true);await tick();assert.equal(complete,false);
 const s=state({mediaId:1,generation:1,startSec:30});p.emit({...s,revision:2});await tick();assert.equal(complete,false);
 p.emit({...s,revision:3,presented:{serial:2,positionSec:30,seekId:0}});await tick();assert.equal(complete,false);
 p.emit({...s,revision:4,presented:{serial:3,positionSec:10,seekId:1}});await tick();assert.equal(complete,false);
 p.emit({...s,revision:5,presented:{serial:4,positionSec:30,seekId:1}});await seek;await engine.dispose();
});
test('new seek supersedes old seek and timeout rejects without fabricated completion',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {p,engine}=await setup();await engine.load(source());const old=engine.seekTo(4),cancelled=assert.rejects(old,{name:'AbortError'});const current=engine.seekTo(12),timed=assert.rejects(current,/呈现确认/);await cancelled;t.mock.timers.tick(15001);await timed;assert.deepEqual(p.calls.filter(c=>c[3]==='cancel-seek').map(c=>c[4]),[{seekId:2}]);await engine.dispose();
});
test('commands retain engine units and validate track ownership, invalid inputs and snapshots',async()=>{
 const {p,engine}=await setup();await engine.load({...source(),resumePositionSec:15,autoplay:false});await engine.setVolume(.3);await engine.setMuted(true);await engine.setRate(1.5);await engine.selectTrack('subtitle','2');await engine.setSubtitleDelay(.4);
 assert.deepEqual(p.calls.slice(1).map(c=>c.slice(3)),[['volume',.3],['mute',true],['rate',1.5],['track',{type:'subtitle',id:'2'}],['subtitle-delay',.4]]);
 await assert.rejects(engine.setVolume(2));await assert.rejects(engine.selectTrack('subtitle','C:/unknown.srt'));await assert.rejects(engine.setSubtitleDelay(11));
 p.emit(state({mediaId:1,generation:1,startSec:99},{revision:9,volume:100}));assert.equal(engine.getState().positionSec,15);const tracks=await engine.listTracks();tracks[0].selected=false;assert.equal((await engine.listTracks())[0].selected,true);await engine.dispose();
});
test('failed close retains ownership for retry; dispose is shared and cancels pending seek',async()=>{
 const {p,engine}=await setup();await engine.load(source());const seek=engine.seekTo(5),cancelled=assert.rejects(seek,{name:'AbortError'});let failures=1;p.close=async()=>{if(failures-->0)throw new Error('child alive');};
 const stopping=engine.dispose();assert.equal(engine.dispose(),stopping);await assert.rejects(stopping,/child alive/);await cancelled;assert.equal(p.detachments,0);assert.notEqual(engine.getSession(),null);await engine.dispose();assert.equal(p.detachments,1);assert.equal(engine.getSession(),null);assert.equal(p.listeners.size,0);
});
test('clock-only snapshots coalesce while track and pause changes publish immediately',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {p,engine}=await setup();await engine.load(source());const seen=[];engine.subscribe(s=>seen.push(s));
 for(let revision=2;revision<22;revision++)p.emit(state({mediaId:1,generation:1,startSec:revision/10},{revision}));assert.equal(seen.length,1);t.mock.timers.tick(200);assert.equal(seen.length,2);
 p.emit(state({mediaId:1,generation:1,startSec:2},{revision:22,status:'paused'}));assert.equal(seen.length,3);
 p.emit(state({mediaId:1,generation:1,startSec:2},{revision:23,status:'paused',tracks:[]}));assert.equal(seen.length,4);await engine.dispose();t.mock.timers.tick(1000);assert.equal(seen.length,4);
});
test('a command finishing after a newer generation cannot report success',async()=>{
 const {p,engine}=await setup();await engine.load(source());const gate=deferred();p.command=()=>gate.promise;const playing=engine.play(),cancelled=assert.rejects(playing,{name:'AbortError'});
 await engine.load(source(2));gate.resolve();await cancelled;assert.equal(engine.getState().mediaId,2);await engine.dispose();
});
test('subscription setup failure releases the attachment and permits a clean retry',async()=>{
 const p=port(),subscribe=p.subscribe;let failures=1;p.subscribe=fn=>{if(failures-->0)throw new Error('subscribe failed');return subscribe(fn);};const engine=new MpvEngine(p),target={nativeSurface:{}};
 await assert.rejects(engine.init(target),/subscribe failed/);assert.equal(p.detachments,1);await engine.init(target);await engine.load(source());assert.equal(engine.getState().status,'playing');await engine.dispose();assert.equal(p.attachments,2);assert.equal(p.detachments,2);
});
