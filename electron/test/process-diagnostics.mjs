import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{processMemorySnapshot}=require('../dist/processDiagnostics.js');
const rows=[
  {pid:1,type:'Browser',memory:{workingSetSize:100,privateBytes:50},name:'private.mov',commandLine:'C:/private/media'},
  {pid:2,type:'Tab',memory:{workingSetSize:200,privateBytes:100}},
  {pid:3,type:'Tab',memory:{workingSetSize:300,privateBytes:150}},
  {pid:4,type:'GPU',memory:{workingSetSize:400}},
  {pid:0,type:'C:/private/media',memory:{workingSetSize:NaN,privateBytes:-1}},
];
const result=processMemorySnapshot(rows,{main:1,libraryRenderer:2,controlsRenderer:3},42);
assert.equal(result.sampledAt,42);assert.equal(result.unit,'KiB');assert.equal(result.scope,'electron-processes-only');assert.equal(result.gpuWorkingSetIsNotVram,true);
assert.deepEqual(result.processes.map(row=>row.role),['main','library-renderer','controls-renderer','other','other']);
assert.equal(result.processes[3].privateKiB,null);assert.equal(result.processes[4].workingSetKiB,null);assert.equal(result.processes[4].pid,null);assert.equal(result.processes[4].type,'Other');
assert.ok(!JSON.stringify(result).includes('private.mov'));assert.ok(!JSON.stringify(result).includes('C:/private'));
assert.equal(processMemorySnapshot([{pid:1,type:'Tab',memory:{workingSetSize:0,privateBytes:0}}],{main:2}).processes[0].privateKiB,0);
const bounded=processMemorySnapshot(Array.from({length:40},()=>rows[0]),{main:1});assert.equal(bounded.processes.length,32);assert.equal(bounded.truncated,true);
assert.equal(result.truncated,false);
console.log('Process diagnostics passed: roles, units, missing values, bounded output and path/name exclusion.');
