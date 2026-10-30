import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installChromiumCycleObserver,classifyChromiumWaits} from './chromium-cycle-observer.mjs';

test('initial loading stays visible and separate from playback or seek interruptions',()=>{
 const events=['loadstart','waiting','waiting','playing','waiting','seeking','waiting','seeked','waiting','playing'];
 assert.deepEqual(classifyChromiumWaits(events.map(name=>({name}))),{startup:2,playback:2,seek:1});
 assert.deepEqual(classifyChromiumWaits([]),{startup:0,playback:0,seek:0});
});

test('Chromium cycle evidence is bounded and releases listeners/video callbacks',()=>{
 const names=['window','document','HTMLVideoElement'];
 const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const listeners=new Map();let frame,cancelled=0;
 class Video{
   currentTime=0;
   matches(selector){return selector==='.player-shell video';}
   requestVideoFrameCallback(callback){frame=callback;return 7;}
   cancelVideoFrameCallback(id){assert.equal(id,7);cancelled++;}
 }
 try{
   Object.assign(globalThis,{window:{},HTMLVideoElement:Video,document:{
     addEventListener:(name,callback,capture)=>{assert.equal(capture,true);listeners.set(name,callback);},
     removeEventListener:(name,callback,capture)=>{assert.equal(capture,true);assert.equal(listeners.get(name),callback);listeners.delete(name);},
   }});
   installChromiumCycleObserver();const video=new Video();
   listeners.get('loadstart')({target:video,type:'loadstart'});
   frame(0,{mediaTime:1,presentedFrames:10});
   for(let n=0;n<150;n++)listeners.get('waiting')({target:video,type:'waiting'});
   const state=window.__chromiumLibraryCycle.snapshot();
   assert.equal(state.sourceLoads,1);assert.equal(state.lastFrame.mediaTime,1);
   assert.notEqual(state.firstFrameMs,null);assert.equal(state.events.length,128);
   state.events.length=0;assert.equal(window.__chromiumLibraryCycle.snapshot().events.length,128);
   window.__chromiumLibraryCycle.stop();window.__chromiumLibraryCycle.stop();
   assert.equal(listeners.size,0);assert.equal(cancelled,1);
 }finally{for(const[name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
