import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameDeliveryRecorder} from './frame-delivery-recorder.cjs';
test('ring retains bounded chronological history and freezes after stop',()=>{
 const r=createFrameDeliveryRecorder({capacity:16,tailMs:5,maxCaptures:1});
 for(let at=0;at<20;at++)r.record({kind:'frame',at,ms:1});
 r.record({kind:'snapshot',at:20,ms:1,outputDrops:0});r.record({kind:'snapshot',at:21,ms:1,outputDrops:2});
 r.record({kind:'present',at:25,ms:2,gpuAt:26});const result=r.stop();
 assert.equal(result.captures[0].before.length,16);assert.equal(result.captures[0].before[0].at,6);assert.equal(result.captures[0].complete,true);
 assert.equal(result.captures[0].after[0].kind,'present');r.record({kind:'frame',at:30,ms:1});assert.equal(r.stop(),result);assert.equal(result.written,23);
});
test('larger observed burst replaces smallest capture, never grows capture budget',()=>{
 const r=createFrameDeliveryRecorder({capacity:16,tailMs:100,maxCaptures:2});
 for(const [at,outputDrops] of [0,1,3,3,0,44].entries())r.record({kind:'snapshot',at,ms:0,outputDrops});
 const result=r.stop();assert.equal(result.captures.length,2);assert.deepEqual(result.captures.map(c=>c.delta).sort((a,b)=>a-b),[2,44]);assert.ok(result.captures.every(c=>!c.complete));
});
test('tail is bounded during rapid calls and missing counters do not trigger captures',()=>{
 const r=createFrameDeliveryRecorder({capacity:16,tailMs:5000,maxCaptures:1});
 r.record({kind:'snapshot',at:0,ms:0,outputDrops:0});r.record({kind:'snapshot',at:1,ms:0,outputDrops:1});
 for(let at=2;at<100;at++)r.record({kind:'snapshot',at,ms:0});
 const result=r.stop();assert.equal(result.captures.length,1);assert.equal(result.captures[0].after.length,16);assert.equal(result.captures[0].truncated,true);
 assert.throws(()=>createFrameDeliveryRecorder({capacity:0}));
});
test('delayed GC observation keeps its original interval in the capture tail',()=>{
 const r=createFrameDeliveryRecorder({capacity:16,tailMs:100,maxCaptures:1});
 r.record({kind:'snapshot',at:0,ms:0,outputDrops:0});r.record({kind:'snapshot',at:200,ms:0,outputDrops:2});
 r.record({kind:'gc',at:100,ms:50,observedAt:210});const c=r.stop().captures[0];
 assert.equal(c.after[0].at,100);assert.equal(c.after[0].observedAt,210);assert.equal(c.complete,false);
});
