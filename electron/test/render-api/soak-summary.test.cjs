const {test}=require('node:test');const assert=require('node:assert/strict');const {counter,summarize,assessDrops}=require('./soak-summary.cjs');
test('4K25 gate rejects high drop rates, decoder loss and counter uncertainty',()=>{
 const states=(a,b)=>[{drops:0,voDrops:9},{drops:a,voDrops:b}];
 assert.equal(assessDrops(states(0,9),120000).passed,true);
 assert.equal(assessDrops(states(0,12),120000).passed,true);
 assert.equal(assessDrops(states(0,13),120000).passed,false);
 assert.equal(assessDrops(states(1,9),120000).passed,false);
 assert.equal(assessDrops(states(null,9),120000).passed,false);
 assert.equal(assessDrops(states(0,0),120000).passed,false);
 assert.throws(()=>assessDrops(states(0,9),0),/duration/);
});
test('Unavailable and reset drop counters cannot become certified zero drops',()=>{
 assert.deepEqual(counter(['0','2','2']).observedIncrease,2);assert.equal(counter(['0',null,'0']).completeMonotonic,false);
 const reset=counter(['3','5','0','2']);assert.equal(reset.resets,1);assert.equal(reset.observedIncrease,4);assert.equal(reset.completeMonotonic,false);
 assert.equal(counter(['','0']).missing,1);
 assert.equal(counter([' ',false,'0']).missing,2);
});
test('Loop pixel progress handles wrap but rejects intervals that hide a full cycle',()=>{
 const result=summarize({completed:true,samples:[{elapsedMs:0,pixelCode:125,native:{}},{elapsedMs:2000,pixelCode:25,native:{}},{elapsedMs:8000,pixelCode:25,native:{}}]});
 assert.equal(result.pixelProgress.sourceFramesAdvanced,50);assert.equal(result.pixelProgress.coveredMs,2000);assert.equal(result.pixelProgress.ambiguousPairs,1);assert.equal(result.pixelProgress.sourceTimeToWallRatio,1);assert.equal(result.actualDecoderFrameCount,null);
});
test('Resource summaries keep process I/O distinct from disk and missing metrics unavailable',()=>{
 const result=summarize({samples:[],resourcesBefore:{processIoIncludingPipes:{readTransferBytes:10}},resourcesAfter:{processIoIncludingPipes:{readTransferBytes:30}}});
 assert.equal(result.nativeProcessIoDelta.readTransferBytes,20);assert.equal(result.lateElectronAggregatePrivate,null);assert.equal(result.pixelProgress.sourceTimeToWallRatio,null);
});
