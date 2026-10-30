import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const candidate=read('ci/mpv-stable-candidate.json'),inventory=read('third_party/mpv/candidate-components.json'),sources=read('ci/mpv-candidate-sources.json');
test('every candidate binary has exactly one classified component',()=>{
 assert.equal(inventory.archiveSha256,candidate.archiveSha256);assert.equal(inventory.sourceCommit,candidate.sourceCommit);
 const files=inventory.components.filter(c=>c.linkage!=='static-from-recipe').flatMap(c=>c.files);
 assert.deepEqual(files.sort(),candidate.files.map(f=>f.name).sort());assert.equal(new Set(files).size,files.length);
 assert.equal(inventory.exeSha256,candidate.files.find(f=>f.name==='mpv.exe').sha256);
});
test('static recipe dependencies are explicit and incomplete materials never claim distribution readiness',()=>{
 assert.deepEqual(inventory.components.filter(c=>c.linkage==='static-from-recipe').map(c=>c.id).sort(),['luajit','mujs']);
 assert.equal(inventory.transitiveDependenciesVerified,false);assert.equal(inventory.distributionReady,false);
 assert.ok(inventory.components.every(c=>c.licenseReview==='pending'));
});
test('locked source archives match the classified revision and fixed repository',()=>{
 assert.equal(sources.runtimeArchiveSha256,candidate.archiveSha256);
 for(const source of sources.archives){
  assert.equal(source.revision,inventory.components.find(c=>c.id===source.component).revision);
  assert.match(source.revision,/^[a-f0-9]{40}$/);assert.match(source.sha256,/^[a-f0-9]{64}$/);
  assert.ok(source.url.endsWith('/zip/'+source.revision));assert.equal(source.name,`${source.component}-${source.revision}.zip`);
 }
});
test('stable reference copies retain their pinned source digest',()=>{
 const references=read('third_party/mpv/stable-references.json');assert.equal(references.sourceCommit,candidate.sourceCommit);
 for(const file of references.references){
  const bytes=readFileSync(new URL('../../'+file.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
  assert.ok(file.url.includes('/'+candidate.sourceCommit+'/'));
 }
 assert.equal(references.completeDistributionMaterials,false);
});
test('binary version observations bind every exact candidate file without asserting source completeness',()=>{
 const observed=read('third_party/mpv/candidate-binary-versions.json');assert.equal(observed.archiveSha256,candidate.archiveSha256);
 assert.equal(observed.files.length,candidate.files.length);
 for(const file of candidate.files)assert.equal(observed.files.find(v=>v.name===file.name)?.sha256,file.sha256);
 assert.ok(observed.files.some(v=>v.fileVersion===null));
});
