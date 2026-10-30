// Audit measured reports; never assert a speedup or hide a slow round.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=name=>JSON.parse(readFileSync(path.join(root,name),'utf8'));
const summary=read('build/replayed-seek-ABBA.json'),runs=summary.reports.map(read);

test('ABBA comparison uses the actual selected cohorts and identical targets/sources',()=>{
 assert.deepEqual(summary.order,['old','new','new','old']);assert.equal(summary.totalSeeks,320);
 assert.deepEqual(runs.map(r=>r.runtime.cohort),[
  read('ci/self-built-render-runtime.json').id,read('ci/replayed-render-runtime.json').id,
  read('ci/replayed-render-runtime.json').id,read('ci/self-built-render-runtime.json').id]);
 for(const item of summary.rows){
  const rows=runs.map(run=>run.rows.find(row=>row.sample===item.sample));
  assert.equal(new Set(rows.map(row=>row.source.sha256)).size,1);
  for(const row of rows){
   assert.equal(row.sourceLoads,1);assert.equal(row.seeks.length,20);assert.equal(row.passed,true);
   assert.deepEqual(row.seeks.map(s=>s.target),rows[0].seeks.map(s=>s.target));
   assert.ok(row.seeks.every(s=>Math.abs(s.pixel-s.expected)<=1));
  }
 }
});

test('reported pooled latency retains both rounds including their long tails',()=>{
 for(const item of summary.rows){
  for(const [key,indices] of [['old',[0,3]],['new',[1,2]]]){
   const values=indices.flatMap(i=>runs[i].rows.find(row=>row.sample===item.sample).seeks.map(s=>s.ms)).sort((a,b)=>a-b);
   assert.equal(item[key].n,40);
   assert.equal(item[key].p50,(values[19]+values[20])/2);
   assert.equal(item[key].p95,values[37]);assert.equal(item[key].max,values[39]);
  }
 }
 assert.equal(summary.defaultChanged,false);assert.equal(summary.distributionReady,false);
});
