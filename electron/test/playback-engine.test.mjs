// Contract tests with fake media events; not decoder/native/render acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
// Production TS validation remains npm run build (Bundler resolution). This
// separate emit only makes the same modules executable in a Node contract test.
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--noCheck','--target','ES2022','--module','Node16','--moduleResolution','Node16','--outDir','build/playback-engine-contract','--rootDir','frontend/src/playback',...['types','Html5Delivery','Html5Engine','PlaybackController','EngineSelector'].map(n=>`frontend/src/playback/${n}.ts`)],{cwd:new URL('../..',import.meta.url),windowsHide:true});
const {Html5Engine}=require('../../build/playback-engine-contract/Html5Engine.js'),{Html5Delivery}=require('../../build/playback-engine-contract/Html5Delivery.js'),{PlaybackController}=require('../../build/playback-engine-contract/PlaybackController.js'),{selectEngine}=require('../../build/playback-engine-contract/EngineSelector.js');
class Video extends EventTarget {
 currentTime=0;duration=60;paused=true;seeking=false;volume=1;muted=false;playbackRate=1;videoWidth=640;videoHeight=360;
 buffered={length:1,start:()=>2,end:()=>20};
 async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
 seeked(){this.seeking=false;this.dispatchEvent(new Event('seeked'));}
}
const options={startPosition:0,duration:60,indexedTs:false,indexedRemux:false,revision:()=>0,beforeAttach(){},onMse(){},onLevel(){},onBuffered(){},onError(){}};
const source=(mediaId=1)=>({mediaId,uri:`/media/${mediaId}/file`,transport:'direct',offsetSec:0,durationSec:60});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(){const video=new Video(),delivery={async load(){},destroy(){}},changes=[];
 const tracks={list:()=>[{id:'audio-1',type:'audio',selected:true},{id:'subtitle-1',type:'subtitle',selected:false}],select:(...v)=>changes.push(v),delay:v=>changes.push(['delay',v])};
 const engine=new Html5Engine(options,tracks,delivery),controller=new PlaybackController(engine);await engine.init(video);return {video,engine,controller,delivery,changes};}
test('M1 selector never invents a native adapter before M2',()=>{
 for(const preference of ['auto','html5','mpv'])assert.equal(selectEngine({preference,nativeEnabled:true,registered:['html5','mpv']}).kind,'html5');
});
test('M3 candidate requires explicit local SDR trial; auto/default/remote retain HTML5',()=>{
 const trial={preference:'mpv',nativeEnabled:true,registered:['html5','mpv'],nativeScope:'sdr-trial',sourceKind:'local'};assert.equal(selectEngine(trial).kind,'mpv');
 for(const change of [{preference:'auto'},{preference:'html5'},{nativeEnabled:false},{nativeScope:undefined},{sourceKind:'remote'},{registered:['html5']}])assert.equal(selectEngine({...trial,...change}).kind,'html5');
});
test('play pause audio rate and offset seconds retain media surface identity',async()=>{
 const {video,controller}=await fixture();await controller.load({...source(),offsetSec:10});
 await controller.play();assert.equal(controller.getState().status,'playing');await controller.pause();assert.equal(video.paused,true);
 await controller.setVolume(.3);await controller.setMuted(true);await controller.setRate(1.5);video.currentTime=5;
 const s=controller.getState();assert.equal(s.positionSec,15);assert.deepEqual(s.bufferedRanges,[[12,30]]);assert.equal(s.volume,.3);assert.equal(s.rate,1.5);assert.equal(s.muted,true);await controller.dispose();
});
test('new load aborts an unresolved old load and preserves latest source generation',async()=>{
 const {controller,delivery}=await fixture(),old=deferred();let loads=0;delivery.load=()=>++loads===1?old.promise:Promise.resolve();
 const first=controller.load(source(1)),rejected=assert.rejects(first,{name:'AbortError'});await controller.load(source(2));await rejected;old.resolve();await Promise.resolve();
 assert.equal(controller.getState().mediaId,2);assert.equal(controller.getState().generation,2);await controller.dispose();
});
test('seek supersedes old completion and waits for actual matching media seek event',async()=>{
 const {video,controller}=await fixture();await controller.load({...source(),offsetSec:10});
 const old=controller.seekTo(22),rejected=assert.rejects(old,{name:'AbortError'});const latest=controller.seekTo(31);await rejected;
 assert.equal(video.currentTime,21);video.currentTime=12;video.seeked();let done=false;void latest.then(()=>done=true);await Promise.resolve();assert.equal(done,false);
 video.currentTime=21;video.seeked();await latest;await controller.dispose();
});
test('dispose is shared, cancels pending load and play, and prevents later commands',async()=>{
 const {video,controller,delivery}=await fixture(),load=deferred();delivery.load=()=>load.promise;
 const pending=controller.load(source()),rejected=assert.rejects(pending,{name:'AbortError'}),a=controller.dispose();assert.equal(controller.dispose(),a);await rejected;await a;load.resolve();
 await assert.rejects(()=>controller.play(),{name:'AbortError'});assert.equal(video.paused,true);
 const f=await fixture();await f.controller.load(source());const play=deferred();f.video.play=()=>play.promise;
 const playing=f.controller.play(),cancelled=assert.rejects(playing,{name:'AbortError'});await f.controller.dispose();await cancelled;play.resolve();
});
test('disposed subscriptions are removed and time events are coalesced',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {video,controller}=await fixture();await controller.load(source());const states=[];controller.subscribe(s=>states.push(s));
 for(let i=0;i<20;i++){video.currentTime=i;video.dispatchEvent(new Event('timeupdate'));}assert.equal(states.length,1);t.mock.timers.tick(200);assert.equal(states.length,2);
 await controller.dispose();video.dispatchEvent(new Event('playing'));t.mock.timers.tick(1000);assert.equal(states.length,2);
});
test('seek timeout rejects rather than inventing a completed target',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {controller}=await fixture();await controller.load(source());const pending=controller.seekTo(20),failed=assert.rejects(pending,/尚未到达/);t.mock.timers.tick(15001);await failed;await controller.dispose();
});
test('track ids and subtitle delay are validated through the existing business ports',async()=>{
 const {controller,changes}=await fixture();await controller.load(source());await controller.selectTrack('subtitle','subtitle-1');await controller.setSubtitleDelay(.3);
 assert.deepEqual(changes,[['subtitle','subtitle-1'],['delay',.3]]);await assert.rejects(()=>controller.selectTrack('subtitle','C:/unknown.srt'));await assert.rejects(()=>controller.setSubtitleDelay(11));await controller.dispose();
});
test('delivery refuses paths outside the current authorized service or another media id',async()=>{
 globalThis.location={href:'http://127.0.0.1:8877/',origin:'http://127.0.0.1:8877'};const delivery=new Html5Delivery(),video=new Video();
 for(const uri of ['file:///E:/private.mp4','https://example.invalid/video','/media/2/file','/api/unknown'])await assert.rejects(()=>delivery.load(video,{...source(),uri},options));
 await delivery.load(video,source(),options);assert.equal(video.src,'/media/1/file');delivery.destroy();delete globalThis.location;
});
test('controller retains failed cleanup for explicit retry and rejects later playback',async()=>{
 const {engine}=await fixture();let attempts=0;const original=engine.dispose.bind(engine);engine.dispose=()=>++attempts===1?Promise.reject(new Error('owned reader still active')):original();const controller=new PlaybackController(engine,7);await controller.load(source());assert.equal(controller.getState().generation,8);
 await assert.rejects(controller.dispose(),/reader still active/);await assert.rejects(controller.play(),{name:'AbortError'});await controller.dispose();assert.equal(attempts,2);
});
