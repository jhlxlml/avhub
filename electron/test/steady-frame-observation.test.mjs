import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startSteadyFrames,summarizeSteadyFrames} from './steady-frame-observation.mjs';

test('steady summary retains drops, callback misses and distinct presentation gaps',()=>{
 const trace={samples:[{at:0,time:3,total:40,dropped:1,paused:false,seeking:false,ready:4,visible:'visible',focused:true},
  {at:1000,time:4,total:52,dropped:3,paused:false,seeking:false,ready:4,visible:'visible',focused:true}],
  frames:[{at:5,expected:0,mediaTime:3,presented:10,processingMs:2},
   {at:90,expected:83,mediaTime:3.083,presented:11,processingMs:3},
   {at:340,expected:333,mediaTime:3.333,presented:14,processingMs:4}],animations:[0,17,34,68],events:[],omitted:0};
 const summary=summarizeSteadyFrames(trace,12);
 assert.equal(summary.dropped,2);assert.equal(summary.total,12);assert.equal(summary.missedCallbackFrames,2);
 assert.equal(summary.longPresentationGaps,1);assert.equal(summary.presentationMs.max,250);
 assert.equal(summary.callbackMs.max,250);assert.equal(summary.animationMs.max,34);
 assert.equal(summary.allPlaying,true);assert.equal(summary.allVisible,true);
});

test('missing callbacks are unavailable rather than zero latency; interruption remains visible',()=>{
 const trace={samples:[{at:0,time:0,total:0,dropped:0,paused:true,seeking:false,ready:1,visible:'hidden',focused:false}],frames:[],animations:[],events:[{name:'waiting'}],omitted:4};
 const summary=summarizeSteadyFrames(trace,60);
 assert.equal(summary.presentationMs.max,null);assert.equal(summary.presentationMs.count,0);
 assert.equal(summary.allPlaying,false);assert.equal(summary.allVisible,false);assert.equal(summary.allFocused,false);
 assert.deepEqual(summary.events,['waiting']);assert.equal(summary.omitted,4);
});

test('sampler is bounded, stop is idempotent and listeners/callbacks are released',()=>{
 const names=['window','document','requestAnimationFrame','cancelAnimationFrame','setInterval','clearInterval'];
 const original=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 let tick,cleared=0,cancelled=0,animationCancelled=0;const handlers=new Map();
 try{
  Object.assign(globalThis,{window:{},document:{visibilityState:'visible',hasFocus:()=>true},
   requestAnimationFrame:()=>8,cancelAnimationFrame:id=>{assert.equal(id,8);animationCancelled++;},
   setInterval:callback=>{tick=callback;return 9;},clearInterval:id=>{assert.equal(id,9);cleared++;}});
  startSteadyFrames({currentTime:3,paused:false,seeking:false,readyState:4,
   getVideoPlaybackQuality:()=>({totalVideoFrames:40,droppedVideoFrames:1}),
   requestVideoFrameCallback:()=>7,cancelVideoFrameCallback:id=>{assert.equal(id,7);cancelled++;},
   addEventListener:(name,callback)=>handlers.set(name,callback),removeEventListener:(name,callback)=>{assert.equal(handlers.get(name),callback);handlers.delete(name);}});
  for(let n=0;n<400;n++)tick();
  const result=window.__steadyFrames.stop();assert.equal(window.__steadyFrames.stop(),result);
  assert.equal(result.samples.length,256);assert.ok(result.omitted>0);assert.equal(handlers.size,0);
  assert.deepEqual([cleared,cancelled,animationCancelled],[1,1,1]);
 }finally{for(const [name,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
