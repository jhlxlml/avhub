import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFrameReleases} from './frame-release-analysis.mjs';
const entry=(kind,at,ms)=>({kind,at,ms,textureId:'owned-texture'});
test('release completion uses start plus duration; duplicate retained entries do not create duplicate lifecycles',()=>{
 const done=entry('renderer-native-release-done',100,200),gpu=entry('renderer-gpu-done',90,5);
 const report={delivery:{timeOrigin:1000,worst:{start:entry('main-native-release-start',310,0),done:entry('main-native-release-done',310,4)},captures:[]},rendererDelivery:{timeOrigin:1000,worst:{done,gpu},tail:[done,gpu],delays:[{...done,entries:[done]}]}};
 const result=analyzeFrameReleases(report);assert.equal(result.rows.length,1);assert.deepEqual(result.rows[0],{textureId:'owned-texture',rendererGpuMs:5,rendererReleaseMs:200,mainReleaseMs:4,approximateHandoffMs:10,clockOrderUncertain:false});
});
test('missing phases remain unavailable and negative clock differences are not clamped into success',()=>{
 const report={delivery:{timeOrigin:1000,worst:{start:entry('main-native-release-start',101,0)},captures:[]},rendererDelivery:{timeOrigin:1100,worst:{done:entry('renderer-native-release-done',100,1)},tail:[],delays:[]}};
 let row=analyzeFrameReleases(report).rows[0];assert.equal(row.rendererGpuMs,null);assert.equal(row.mainReleaseMs,null);assert.equal(row.approximateHandoffMs,-100);assert.equal(row.clockOrderUncertain,true);
 delete report.delivery.timeOrigin;row=analyzeFrameReleases(report).rows[0];assert.equal(row.approximateHandoffMs,null);
});
