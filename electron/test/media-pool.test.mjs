import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createMediaPool,mediaHash} from './media-pool.mjs';
const project=path.resolve(import.meta.dirname,'../..');
fs.mkdirSync(path.join(project,'build'),{recursive:true});
const work=fs.mkdtempSync(path.join(project,'build/media-pool-contract-'));
const pool=createMediaPool(path.join(work,'pool'));

test('same recipe reuses immutable bytes; read-only aliases share storage',()=>{
 const source=pool.get('basic'),identity=fs.statSync(source),hash=mediaHash(source),inode=fs.statSync(source,{bigint:true}).ino;
 assert.equal(pool.get('basic'),source);
 assert.equal(fs.statSync(source).mtimeMs,identity.mtimeMs);
 assert.equal(mediaHash(source),hash);
 const alias=path.join(work,'ReadOnly.mp4');pool.place(source,alias);
 assert.equal(fs.statSync(alias,{bigint:true}).ino,inode);
 assert.throws(()=>fs.writeFileSync(alias,'must not change'),/EPERM|EACCES/);
 fs.unlinkSync(alias);assert.equal(mediaHash(source),hash);
});

test('mutation copies never modify the shared sample or original import',()=>{
 const source=pool.get('basic'),hash=mediaHash(source),copy=path.join(work,'Mutable.mp4');
 pool.place(source,copy,{mutable:true});assert.notEqual(fs.statSync(copy,{bigint:true}).ino,fs.statSync(source,{bigint:true}).ino);
 fs.writeFileSync(copy,'owned mutation');assert.equal(mediaHash(source),hash);
 const original=path.join(work,'Original.mp4');fs.copyFileSync(source,original);fs.chmodSync(original,0o666);
 const before=fs.statSync(original),snapshot=pool.imported(original);
 assert.notEqual(fs.statSync(original,{bigint:true}).ino,fs.statSync(snapshot,{bigint:true}).ino);
 assert.equal(fs.statSync(original).mode,before.mode);assert.equal(fs.statSync(original).mtimeMs,before.mtimeMs);
 fs.appendFileSync(original,'new owned bytes');assert.equal(mediaHash(snapshot),hash);
 assert.notEqual(pool.imported(original),snapshot);
});

test('stream-copy recipes reuse content identity across different temporary paths',()=>{
 const source=pool.get('basic'),first=path.join(work,'A.mkv'),second=path.join(work,'B.mkv');
 const args=(output,input=source)=>['-v','error','-i',input,'-map','0:v:0','-c','copy','-n',output];
 const initial=pool.generate(args(first)),identity=fs.statSync(initial.fixture);
 const alias=path.join(work,'DifferentInputPath.mp4');pool.place(source,alias);
 const repeated=pool.generate(args(second,alias));assert.equal(repeated.fixture,initial.fixture);
 assert.equal(fs.statSync(repeated.fixture).mtimeMs,identity.mtimeMs);
 assert.equal(fs.statSync(first,{bigint:true}).ino,fs.statSync(second,{bigint:true}).ino);
 assert.throws(()=>pool.place(source,second),/Never overwrite/);
});

test('failed generation is not published as a reusable successful fixture',()=>{
 const before=pool.list().map(entry=>entry.id);
 assert.throws(()=>pool.generate(['-v','error','-f','lavfi','-i','avhub_nonexistent_filter',path.join(work,'Failure.mp4')]));
 assert.deepEqual(pool.list().map(entry=>entry.id),before);
 assert.equal(fs.existsSync(path.join(work,'Failure.mp4')),false);
});

test('corruption is reported without replacement; unknown pools and escaping paths rejected',()=>{
 const source=pool.get('basic'),before=fs.statSync(source,{bigint:true});fs.chmodSync(source,0o666);
 const fd=fs.openSync(source,'r+');fs.writeSync(fd,Buffer.from([0xff]),0,1,0);fs.closeSync(fd);
 assert.throws(()=>pool.get('basic'),/checksum changed/);assert.equal(fs.statSync(source,{bigint:true}).ino,before.ino);
 const unknown=path.join(work,'unknown');fs.mkdirSync(unknown);fs.writeFileSync(path.join(unknown,'user.txt'),'keep');
 assert.throws(()=>createMediaPool(unknown),/unowned nonempty/);
 assert.throws(()=>createMediaPool(path.join(project,'outside-build')),/stay in project build/);
 const redirected=path.join(work,'redirected');fs.symlinkSync(unknown,redirected,'junction');
 assert.throws(()=>createMediaPool(redirected),/redirected/);
 assert.equal(fs.readFileSync(path.join(unknown,'user.txt'),'utf8'),'keep');
});

console.log('Owned contract workspace: '+work);
