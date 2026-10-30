import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateMpvManifest,distributionProblems,distributionRoles} from '../../scripts/mpv-readiness-policy.mjs';
const current=JSON.parse(readFileSync(new URL('../mpv-runtime.json',import.meta.url),'utf8'));
const pending=JSON.parse(readFileSync(new URL('../mpv-distribution.json',import.meta.url),'utf8'));
test('one boolean cannot open the preview distribution gate',()=>{
 validateMpvManifest(current);
 const problems=distributionProblems({...current,distributionReady:true},pending,()=>true);
 assert.ok(problems.some(p=>p.includes('fixed upstream')));assert.ok(problems.some(p=>p.includes('notices')));
});
test('evidence must bind the exact runtime and contain verified files for every role',()=>{
 const manifest={...current,distributionReady:true,releaseTag:'v0.41.0',sourceCommit:'a'.repeat(40),releaseBlockers:[]};
 const evidence={...pending};for(const role of distributionRoles)evidence[role]={state:'complete',files:[{path:'fixture.txt',sha256:'b'.repeat(64)}]};
 assert.equal(distributionProblems(manifest,evidence,()=>true).length,0);
 assert.ok(distributionProblems(manifest,evidence,()=>false).length>=5);
 assert.ok(distributionProblems(manifest,{...evidence,exeSha256:'c'.repeat(64)},()=>true).some(p=>p.includes('different runtime')));
 assert.ok(distributionProblems(manifest,{...evidence,notices:{state:'complete',files:[]}},()=>true).some(p=>p.startsWith('notices:')));
});
test('pinned manifest rejects arbitrary hosts and accepts fixed upstream tags',()=>{
 assert.throws(()=>validateMpvManifest({...current,url:'https://example.invalid/mpv.zip'}));
 validateMpvManifest({...current,releaseTag:'v0.41.0',url:`https://github.com/mpv-player/mpv/releases/download/v0.41.0/${current.asset}`});
});
test('release CLI cannot bypass runtime verification with manifest-only',()=>{
 const result=spawnSync(process.execPath,['scripts/check-mpv-readiness.mjs','--release','--manifest-only'],{cwd:new URL('../..',import.meta.url),encoding:'utf8',timeout:10000});
 assert.notEqual(result.status,0);assert.match(result.stderr,/cannot skip runtime files/);
});
test('upstream reference snapshots retain their recorded digest and full source binding',()=>{
 const references=JSON.parse(readFileSync(new URL('../../third_party/mpv/references.json',import.meta.url),'utf8'));
 assert.equal(references.sourceCommit,current.sourceCommit);assert.equal(references.completeDistributionMaterials,false);
 for(const file of references.references){
  assert.equal(createHash('sha256').update(readFileSync(new URL('../../'+file.path,import.meta.url))).digest('hex'),file.sha256);
  assert.ok(file.url.includes('/'+current.sourceCommit+'/'));
 }
});
