// Paths and integrity contracts, not decode/presentation acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const {renderRuntimeLayout}=require('../dist/renderRuntimeLayout.js');
const {verifyRenderRuntime}=require('../dist/renderHostClient.js');
test('development defaults and packaged resources are isolated',()=>{
 const dev=renderRuntimeLayout(root,false,'C:/resource');assert.equal(dev.bundled,false);assert.equal(dev.root,root);
 const packed=renderRuntimeLayout(root,true,'C:/resource','render-runtime-candidate-ABC123');
 assert.equal(packed.bundled,true);assert.equal(packed.dll,path.join('C:/resource','native-render/libmpv-2.dll'));assert.equal(packed.root,path.join('C:/resource','native-render/source'));
 const candidate=renderRuntimeLayout(root,false,'C:/unused','render-runtime-candidate-ABC123');assert.equal(candidate.ffiBase,path.join(root,'build/render-runtime-candidate-ABC123/ffi'));
});
test('candidate selection rejects arbitrary paths rather than loading a new directory',()=>{
 for(const value of ['../elsewhere','C:/outside','render-runtime-candidate-../../x','render-runtime-candidate-ABC123/other'])assert.throws(()=>renderRuntimeLayout(root,false,'',value));
});
test('a staged manifest cannot omit the pinned Vulkan dependency',async()=>{
 const stage=JSON.parse(readFileSync(path.join(root,'build/render-runtime-staging.json'),'utf8')).folder;
 const folder=mkdtempSync(path.join(root,'build/render-integrity-contract-'));
 const manifest=JSON.parse(readFileSync(path.join(stage,'runtime.json'),'utf8'));
 // Actual host and DLL identities, but a deliberately incomplete copied manifest.
 manifest.dependencies=[];writeFileSync(path.join(folder,'runtime.json'),JSON.stringify(manifest));
 const runtime={host:path.join(stage,'AVHubNativeRender.exe'),dll:path.join(stage,'libmpv-2.dll'),manifest:path.join(folder,'runtime.json'),root:path.join(stage,'source'),bundled:true};
 await assert.rejects(verifyRenderRuntime(runtime),/Vulkan/);
});
