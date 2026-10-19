import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{nativeViewport}=require('../dist/nativeEmbedding.js');
const valid={x:24,y:100,width:1000,height:560,clip:{x:0,y:0,width:1000,height:560},visible:true};
assert.deepEqual(nativeViewport(valid),valid);
assert.deepEqual(nativeViewport({...valid,y:-120,clip:{x:0,y:180,width:1000,height:380}}).clip,{x:0,y:180,width:1000,height:380});
for(const value of [null,{},true,{...valid,x:NaN},{...valid,width:0},{...valid,height:Infinity},{...valid,radius:Infinity},{...valid,radius:-1},{...valid,visible:1},{...valid,clip:{...valid.clip,x:-1}},{...valid,clip:{...valid.clip,width:2000}}])assert.throws(()=>nativeViewport(value));
console.log('Native embedding viewport validation passed');
