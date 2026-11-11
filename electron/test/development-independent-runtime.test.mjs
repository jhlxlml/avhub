import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {developmentIndependentRuntime} from '../../scripts/development-independent-runtime.mjs';
const project=path.resolve(import.meta.dirname,'../..');
const fixture=()=>{const root=fs.mkdtempSync(path.join(project,'build/independent-selection-'));fs.mkdirSync(path.join(root,'build'));return root;};
test('without local acceptance, selection preserves the installed development runtime',()=>{
 assert.equal(developmentIndependentRuntime(fixture()),undefined);
});
test('accepted selection binds to the exact runtime manifest; changed bytes fail',()=>{
 const root=fixture(),candidate='mpv-desktop-runtime-abc12345',folder=path.join(root,'build',candidate);fs.mkdirSync(folder);
 const manifest=JSON.stringify({exeSha256:'b'.repeat(64)});fs.writeFileSync(path.join(folder,'runtime.json'),manifest);
 fs.writeFileSync(path.join(root,'build/independent-mkv-runtime-acceptance.json'),JSON.stringify({schema:1,passed:true,candidate,exeSha256:'b'.repeat(64),manifestSha256:createHash('sha256').update(manifest).digest('hex')}));
 assert.equal(developmentIndependentRuntime(root),candidate);fs.appendFileSync(path.join(folder,'runtime.json'),' ');assert.throws(()=>developmentIndependentRuntime(root),/验收对象已变化/);
});
test('an explicit developer selection takes precedence, while escaping names fail',()=>{
 const root=fixture();fs.writeFileSync(path.join(root,'build/independent-mkv-runtime-acceptance.json'),'invalid');
 assert.equal(developmentIndependentRuntime(root,'mpv-desktop-runtime-abc12345'),'mpv-desktop-runtime-abc12345');assert.throws(()=>developmentIndependentRuntime(root,'../other'),/无效/);
});
test('malformed acceptance cannot silently opt into a runtime',()=>{
 const root=fixture();fs.writeFileSync(path.join(root,'build/independent-mkv-runtime-acceptance.json'),'null');assert.throws(()=>developmentIndependentRuntime(root),/验收记录无效/);
});
