import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const {independentRuntimeLayout}=createRequire(import.meta.url)('../dist/independentRuntimeLayout.js');
const root=path.resolve(import.meta.dirname,'../..');
test('default development layout preserves the existing executable/manifest',()=>{
 const value=independentRuntimeLayout(root,false,'','');assert.equal(value.executable,path.join(root,'bin/mpv/mpv.exe'));assert.equal(value.manifest,undefined);
});
test('explicit candidate is bounded to the owned build name',()=>{
 const value=independentRuntimeLayout(root,false,'','mpv-desktop-runtime-abc12345');assert.equal(value.executable,path.join(root,'build/mpv-desktop-runtime-abc12345/mpv.exe'));assert.equal(value.manifest,path.join(root,'build/mpv-desktop-runtime-abc12345/runtime.json'));
 for(const input of ['../mpv','D:/untrusted','mpv-desktop-runtime-abc12345/other'])assert.throws(()=>independentRuntimeLayout(root,false,'',input));
});
test('packaged app ignores development override',()=>{
 const value=independentRuntimeLayout(root,true,path.join(root,'build/isolated-resources'),'../invalid');assert.equal(value.executable,path.join(root,'build/isolated-resources/mpv/mpv.exe'));
});
