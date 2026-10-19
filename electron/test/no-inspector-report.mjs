// Synthetic report contract, not runtime or memory-performance acceptance.
import assert from 'node:assert/strict';
import {summarizeNoInspector} from './no-inspector-summary.mjs';
const point=(working=102400,privateKiB=51200)=>({processes:[{type:'Tab',role:'library-renderer',workingSetKiB:working,privateKiB}]});
const row=(elapsedMs,page=1)=>({elapsedMs,library:{page,cards:96,images:40,nodes:4000},afterClose:point(),sourceLoads:1,seekMs:150,bufferingEvents:0,audioTracks:0});
const fixture={completed:true,cleanExit:true,sourceIdentityVerified:true,targetReached:true,targetSeconds:3600,workloadMs:3600000,remainingOwnedMpv:[],errors:[],instrumentation:{inspector:false,playwright:false,forcedGc:false,cachePurge:false},cycles:[row(1000),row(600000,2),row(600001,3),row(3600000,2)],idle:[{elapsedMs:60000,...point(99999)}]};
const valid=summarizeNoInspector(fixture);assert.equal(valid.accepted,true);assert.deepEqual(valid.pages,[1,2,3]);
assert.equal(valid.warmCycles['library-renderer'].privateMiB.median,50);assert.equal(valid.warmCycles.gpu.privateMiB.median,null);
assert.deepEqual(valid.tenMinuteWindows.map(w=>w.fromMinute),[0,10,50]);
assert.equal(valid.library.imagePixels.max,null,'missing image measurements are unknown, not zero');
for(const patch of [{workloadMs:1000},{completed:false},{cleanExit:false},{sourceIdentityVerified:false},{remainingOwnedMpv:[{}]},{errors:['failure']},{targetReached:false},{instrumentation:{...fixture.instrumentation,inspector:true}}])assert.equal(summarizeNoInspector({...fixture,...patch}).accepted,false);
assert.equal(summarizeNoInspector({...fixture,cycles:[]}).accepted,false);
assert.equal(summarizeNoInspector({...fixture,walkPages:true,cycles:[row(1000),row(3600000)]}).accepted,false,'same page cannot pass a cross-page report');
assert.equal(summarizeNoInspector({...fixture,cycles:[row(1000),row(2000),{...row(3000),afterClose:point(-1,-1)}]}).warmCycles['library-renderer'].privateMiB.max,null);
const tail=summarizeNoInspector({...fixture,workloadMs:3610000,cycles:[...fixture.cycles,row(3609000)]}).tenMinuteWindows.at(-1);
assert.equal(tail.partial,true);assert.ok(tail.toMinute<61,'a final in-flight cycle is labelled as a partial window, not a full extra ten minutes');
const legacy=summarizeNoInspector({completed:true,cleanExit:true,cycles:[{afterClose:point()}]});assert.equal(legacy.accepted,false);assert.equal(legacy.durationReached,null);assert.deepEqual(legacy.tenMinuteWindows,[]);
assert.equal(summarizeNoInspector({...fixture,workloadMs:1000,idle:[{elapsedMs:3600000,...point()}]}).durationReached,false,'idle cannot satisfy the active target');
console.log('No-inspector report contract passed: active duration, confirmed exit, missing data, warm cycles and time windows.');
