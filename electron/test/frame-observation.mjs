import assert from 'node:assert/strict';
import observation from './frame-observation.cjs';
const trace={events:[{event:'loadstart',at:0},{event:'playing',at:10}],samples:[
 {at:900,total:12,dropped:1},{at:3900,total:48,dropped:3},{at:7900,total:96,dropped:7},{at:12000,total:144,dropped:11},
]};
assert.deepEqual(observation.summarizeFrameTrace(trace),{unexpectedReloads:0,bins:[
 {throughMs:1000,frames:12,dropped:1},{throughMs:4000,frames:36,dropped:2},
 {throughMs:8000,frames:48,dropped:4},{throughMs:'end',frames:48,dropped:4},
]});
trace.events.push({event:'loadstart',at:2000});assert.equal(observation.summarizeFrameTrace(trace).unexpectedReloads,1);
console.log('Frame evidence contract passed: startup drops retained, disjoint bins and initial load versus actual reload.');
