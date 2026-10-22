import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const {FilePreviewRequest,cancellableFilePreview}=createRequire(import.meta.url)('../dist/filePreview.js');

test('only preview snapshots and cache release can be cancelled',()=>{
 for(const action of ['preview','preview-records','release-preview','release-record-preview'])assert.equal(cancellableFilePreview(action),true);
 for(const action of ['rename','recycle','restore-record','delete-record','clear-record','permissions','recheck','resolve-source',null,{},'cancel-preview'])assert.equal(cancellableFilePreview(action),false);
});
test('successful preview clears its timeout without aborting a completed read',async()=>{
 const request=new FilePreviewRequest('owned',20);let signal;
 assert.equal(await request.run(async value=>{signal=value;return 42;}),42);
 await delay(40);assert.equal(signal.aborted,false);
});
test('whole read/body deadline releases even an abort-ignoring transport, without retry',async()=>{
 const request=new FilePreviewRequest('owned',20);let calls=0,signal;
 await assert.rejects(request.run(value=>{calls++;signal=value;return new Promise(()=>{});}),/预检超时.*未执行文件修改/);
 assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('explicit cancel rejects promptly and a late response cannot replace cancellation',async()=>{
 const request=new FilePreviewRequest('owned',1000);let finish;
 const task=request.run(()=>new Promise(resolve=>{finish=resolve;}));
 await delay(0);request.cancel();await assert.rejects(task,/已取消预检/);
 finish('late result');await delay(0);await assert.rejects(task,/已取消预检/);
});
test('cancel before dispatch does not call transport',async()=>{
 const request=new FilePreviewRequest('owned',20);request.cancel();let calls=0;
 await assert.rejects(request.run(async()=>{calls++;}),/已取消预检/);assert.equal(calls,0);
});
test('ordinary read errors are not rewritten as timeouts or silently retried',async()=>{
 const request=new FilePreviewRequest('owned',20),error=new Error('fixture failure');let calls=0;
 await assert.rejects(request.run(async()=>{calls++;throw error;}),value=>value===error);assert.equal(calls,1);
});
