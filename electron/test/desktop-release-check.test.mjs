// Verification runner contracts; fixture commands never build or publish.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {releaseChecks,runReleaseChecks} from '../../scripts/desktop-release-check.mjs';
const root=path.resolve(import.meta.dirname,'../..');
test('source plan cannot package, push or publish; exact package adds current proof gates',()=>{
 assert.deepEqual(releaseChecks(root).map(c=>c.id),['dual-runtime','source-materials','retained-build-evidence']);
 const checks=releaseChecks(root,'build/release-candidate');assert.equal(checks.length,5);
 assert.ok(checks.every(c=>!c.args.some(a=>/^(push|tag|--publish|--force)$/.test(a))));
 assert.throws(()=>releaseChecks(root,'../elsewhere'));
});
test('failed prerequisite stops dependent work; resume preserves failure and revalidates success',()=>{
 const directory=fs.mkdtempSync(path.join(root,'build/release-check-contract-')),checks=[{id:'a'},{id:'b'},{id:'c'}];
 const called=[];
 assert.equal(runReleaseChecks(root,directory,checks,c=>{called.push(c.id);return {status:c.id==='b'?1:0,stdout:c.id};},()=> 'same').passed,false);
 assert.deepEqual(called,['a','b']);called.length=0;
 assert.equal(runReleaseChecks(root,directory,checks,c=>{called.push(c.id);return {status:0};},()=> 'same').passed,true);
 assert.deepEqual(called,['a','b','c']);
 const journal=JSON.parse(fs.readFileSync(path.join(directory,'journal.json'),'utf8'));
 assert.equal(journal.attempts.length,2);assert.equal(journal.attempts[0].checks[1].status,'FAIL');
 assert.equal(fs.readFileSync(path.join(directory,'attempt-1-b.log'),'utf8'),'b');
});
test('source changed during successful checks cannot be reported as passing',()=>{
 const directory=fs.mkdtempSync(path.join(root,'build/release-check-contract-'));let read=0;
 const result=runReleaseChecks(root,directory,[{id:'a'}],()=>({status:0}),()=>read++?'after':'before');
 assert.equal(result.passed,false);assert.equal(result.sourceChanged,true);
});
