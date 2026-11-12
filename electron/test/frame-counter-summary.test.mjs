import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeFrameCounter} from './frame-counter-summary.mjs';
test('a decreasing MPV counter cannot erase earlier observed drops',()=>{
 const r=summarizeFrameCounter([0,15,3,9].map(value=>({value})));
 assert.equal(r.lastReading,9);assert.equal(r.observedIncreaseLowerBound,24);assert.equal(r.counterDecreases,1);assert.equal(r.totalIsExact,false);
});
test('seek boundary is retained without assuming an unobserved counter reset',()=>{
 const r=summarizeFrameCounter([{value:0,seekId:1},{value:2,seekId:1},{value:5,seekId:2},{value:8,seekId:2}]);
 assert.equal(r.observedIncreaseLowerBound,8);assert.equal(r.seekBoundaries,1);assert.equal(r.counterDecreases,0);
});
test('carried readings across multiple seek IDs cannot invent new drops',()=>{
 const r=summarizeFrameCounter([{value:8,seekId:1},{value:8,seekId:2},{value:8,seekId:3},{value:2,seekId:3}]);
 assert.equal(r.observedIncreaseLowerBound,2);assert.equal(r.seekBoundaries,2);assert.equal(r.counterDecreases,1);
});
test('the real 20-minute ambiguous boundary remains a conservative lower bound',()=>{
 const r=summarizeFrameCounter([{value:0,seekId:15},{value:44,seekId:15},{value:1,seekId:16},{value:8,seekId:17},{value:2,seekId:18}]);
 assert.equal(r.observedIncreaseLowerBound,54);assert.equal(r.seekBoundaries,3);assert.equal(r.counterDecreases,2);assert.equal(r.totalIsExact,false);
});
test('missing readings are not invented; initial reading is a baseline',()=>{
 const r=summarizeFrameCounter([{value:7},{value:null},{value:NaN},{value:9}]);
 assert.equal(r.observedIncreaseLowerBound,2);assert.equal(r.missingSamples,2);assert.equal(r.firstReading,7);
});
