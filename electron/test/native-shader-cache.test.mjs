import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,readdir,open,utimes,symlink} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url);
const {prepareNativeShaderCache}=require('../dist/nativeShaderCache.js');
const sample=()=>mkdtemp(path.join(root,'build/shader-cache-test-'));

test('owned shader cache is reusable without deleting valid compiled programs',async()=>{
 const data=await sample(),dir=await prepareNativeShaderCache(data);assert.ok(dir);
 const file=path.join(dir,'a'.repeat(64));await writeFile(file,'compiled');await prepareNativeShaderCache(data,'closed');
 assert.equal(await prepareNativeShaderCache(data),dir);assert.equal(await readFile(file,'utf8'),'compiled');
});
test('unowned directory and unknown objects are never adopted or deleted',async()=>{
 const data=await sample(),dir=path.join(data,'native-shaders-v1');await mkdir(dir);await writeFile(path.join(dir,'keep.txt'),'user');
 await assert.rejects(prepareNativeShaderCache(data));assert.deepEqual(await readdir(dir),['keep.txt']);
 const owned=await sample(),cache=await prepareNativeShaderCache(owned);await writeFile(path.join(cache,'keep.txt'),'user');
 assert.equal(await prepareNativeShaderCache(owned),undefined);assert.equal(await readFile(path.join(cache,'keep.txt'),'utf8'),'user');
});
test('idle capacity reclamation only deletes oldest owned hash entries',async()=>{
 const data=await sample(),dir=await prepareNativeShaderCache(data);
 for(let i=0;i<66;i++){const file=path.join(dir,i.toString(16).padStart(64,'0')),fd=await open(file,'wx');await fd.truncate(1024**2);await fd.close();await utimes(file,new Date(1700000000000+i*1000),new Date(1700000000000+i*1000));}
 assert.equal(await prepareNativeShaderCache(data,'closed'),dir);
 const files=(await readdir(dir)).filter(name=>/^[a-f0-9]{64}$/i.test(name));assert.equal(files.length,48);assert.ok(!files.includes('0'.repeat(64)));assert.ok(files.includes((65).toString(16).padStart(64,'0')));
});
test('oversized entries and excess entry count are reclaimed while idle',async()=>{
 const data=await sample(),dir=await prepareNativeShaderCache(data),large=path.join(dir,'f'.repeat(64));
 const fd=await open(large,'wx');await fd.truncate(5*1024**2);await fd.close();await prepareNativeShaderCache(data,'closed');assert.ok(!(await readdir(dir)).includes('f'.repeat(64)));
 for(let i=0;i<513;i++)await writeFile(path.join(dir,i.toString(16).padStart(64,'0')),'');
 await prepareNativeShaderCache(data,'closed');assert.equal((await readdir(dir)).length,386);
});
test('directory junction never redirects cache cleanup to another folder',async()=>{
 const data=await sample(),target=await sample();await writeFile(path.join(target,'keep.txt'),'safe');
 await symlink(target,path.join(data,'native-shaders-v1'),'junction');
 assert.equal(await prepareNativeShaderCache(data),undefined);assert.deepEqual(await readdir(target),['keep.txt']);
});

test('corrupted or unrecorded compiled programs are discarded before opening',async()=>{
 const data=await sample(),dir=await prepareNativeShaderCache(data),file=path.join(dir,'b'.repeat(64));await writeFile(file,'valid');await prepareNativeShaderCache(data,'closed');
 await writeFile(file,'broken');await writeFile(path.join(dir,'c'.repeat(64)),'unrecorded');
 assert.equal(await prepareNativeShaderCache(data),dir);assert.deepEqual((await readdir(dir)).sort(),['.avhub-integrity.json','.avhub-owner.json']);
});
test('a torn integrity index safely invalidates only owned compiled programs',async()=>{
 const data=await sample(),dir=await prepareNativeShaderCache(data),file=path.join(dir,'d'.repeat(64));await writeFile(file,'valid');await prepareNativeShaderCache(data,'closed');
 await writeFile(path.join(dir,'.avhub-integrity.json'),'{');await prepareNativeShaderCache(data);assert.ok(!(await readdir(dir)).includes('d'.repeat(64)));
});
