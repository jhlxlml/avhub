// Actual local inventory/staging boundary. No player is launched by this test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {stageRenderRuntime} from '../../scripts/stage-render-runtime.mjs';
const root=path.resolve(import.meta.dirname,'../..');
test('staging requires the real pinned loader and never certifies distribution',()=>{
 const before=readdirSync(path.join(root,'build')).filter(n=>n.startsWith('render-runtime-candidate-'));
 if(existsSync(path.join(root,'build/vulkan-runtime-input/runtime/runtime.json'))){
  const result=stageRenderRuntime(root);
  assert.equal(result.layout.distributionReady,false);
  assert.equal(result.layout.scope,'local-runtime-layout-candidate-not-packaged-acceptance');
  assert.equal(JSON.parse(readFileSync(path.join(result.folder,'runtime.json'),'utf8')).productionDistributionReady,false);
  return;
 }
 assert.throws(()=>stageRenderRuntime(root),/ENOENT/);
 assert.deepEqual(readdirSync(path.join(root,'build')).filter(n=>n.startsWith('render-runtime-candidate-')),before);
});
