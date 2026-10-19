// Synthetic report-contract tests, not playback or memory-performance evidence.
import assert from 'node:assert/strict';
import {writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const workspace=ownedTemporaryWorkspace('avhub-soak-report-');
const script=path.join(import.meta.dirname,'summarize-library-soak.mjs');
const diagnostics={processes:[{type:'Tab',workingSetKB:102400,privateKB:51200}],dom:{documents:1,nodes:100,jsEventListeners:4}};
const summarize=report=>{
  const file=path.join(workspace,'report.json');writeFileSync(file,JSON.stringify(report));
  const result=spawnSync(process.execPath,[script,file],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
};
try{
  const partial=summarize({seconds:3600,elapsedMs:1000,totalElapsedMs:3601000,targetReached:false,cleanExit:false,network:{enabled:false,completed:0,transferBytes:0},samples:[{elapsedMs:1000,...diagnostics}],playbacks:[{cycle:0,firstFrameMs:900,afterClose:diagnostics},{cycle:1,firstFrameMs:200,afterClose:diagnostics}],idleSeconds:60,idleSamples:[{elapsedMs:60000,...diagnostics}]});
  assert.equal(partial.targetReached,false,'idle/total wall time must never pass an incomplete workload');
  assert.equal(partial.cleanExit,false);assert.equal(partial.network.transferBytes,null,'disabled diagnostics are unknown, not zero traffic');
  assert.equal(partial.playback.warmFirstFrameMs.median,200,'first initialization is excluded from warm-cycle statistics');
  assert.equal(partial.playback.lifecycle[1].privateMiB,50);assert.equal(partial.idle.samples[0].rendererMiB,100);
  assert.equal(partial.idle.samples[0].dom.jsEventListeners,4);
  assert.equal(partial.tenMinuteWindows.length,1,'idle must not create fictitious workload windows');
  const legacy=summarize({elapsedMs:600001,targetReached:true,cleanExit:true,samples:[{elapsedMs:599999,processes:diagnostics.processes}],playbacks:[]});
  assert.equal(legacy.tenMinuteWindows.length,1,'cleanup tail must not add an empty ten-minute window');
  assert.equal(legacy.rendererCounters.documents.max,null,'missing measurements are not zero');
  assert.equal(legacy.instrumentation,null);assert.deepEqual(legacy.idle.samples,[]);
  console.log('Library soak report contract passed: partial duration, unknown metrics, warm cycles and legacy reports.');
}finally{
  assert.match(path.basename(workspace),/^avhub-soak-report-/);rmSync(workspace,{recursive:true,force:true});
}
