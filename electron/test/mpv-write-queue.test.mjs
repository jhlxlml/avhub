// Controlled Socket completion/MPV ACK contracts. Not native playback evidence.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {MpvClient}=createRequire(import.meta.url)('../dist/mpvClient.js');
const fixture=()=>{const writes=[],client=new MpvClient(()=>{},()=>{});client.socket={destroyed:false,write(line,callback){writes.push({packet:JSON.parse(line),callback});}};return {client,writes};};
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));

test('FIFO gates OS writes but never waits for MPV replies',async()=>{
 const {client,writes}=fixture();let secondDone=false;
 const first=client.command(['get_property','a']),second=client.command(['get_property','b']).then(value=>{secondDone=true;return value;}),third=client.command(['get_property','c']);
 assert.equal(writes.length,1);
 client.message({request_id:1,error:'success',data:'a'});assert.equal(await first,'a');assert.equal(writes.length,1,'ACK alone must not release an unfinished OS write');
 writes[0].callback();await tick();assert.equal(writes.length,2);assert.equal(secondDone,false);
 writes[1].callback();await tick();assert.equal(writes.length,3,'next write need not wait for previous MPV ACK');
 client.message({request_id:3,error:'success',data:'c'});client.message({request_id:2,error:'success',data:'b'});writes[2].callback();
 assert.deepEqual(await Promise.all([second,third]),['b','c']);assert.deepEqual(writes.map(write=>write.packet.request_id),[1,2,3]);assert.equal(client.requests.size,0);
});
test('timed-out queued commands cannot be sent later',async()=>{
 const {client,writes}=fixture(),first=client.command(['get_property','a']);
 await assert.rejects(client.command(['get_property','expired'],10),/超时/);
 writes[0].callback();await tick();assert.equal(writes.length,1);
 client.message({request_id:1,error:'success'});await first;assert.equal(client.requests.size,0);
});
test('write and disconnect failures reject callers instead of pretending ACK',async()=>{
 const {client,writes}=fixture(),first=assert.rejects(client.command(['get_property','a']),/未发送/),second=assert.rejects(client.command(['get_property','b']),/已断开/);
 client.socket.destroyed=true;writes[0].callback(new Error('controlled write failure'));client.clearRequests();await Promise.all([first,second]);await tick();assert.equal(writes.length,1);assert.equal(client.requests.size,0);
});
test('capacity and shutdown retain a bounded queue with no stale sends',async()=>{
 const {client,writes}=fixture(),pending=Promise.allSettled(Array.from({length:64},()=>client.command(['get_property','a'])));
 await assert.rejects(client.command(['get_property','overflow']),/操作过多/);client.clearRequests();writes[0].callback();await tick();
 assert.ok((await pending).every(result=>result.status==='rejected'));assert.equal(writes.length,1);assert.equal(client.requests.size,0);
});
test('dispatch timing is notified at actual wire dispatch, not queue insertion',async()=>{
 const {client,writes}=fixture(),dispatch=[];
 const first=client.command(['get_property','a'],5000,()=>dispatch.push('a')),second=client.command(['get_property','b'],5000,()=>dispatch.push('b'));
 assert.deepEqual(dispatch,['a']);writes[0].callback();await tick();assert.deepEqual(dispatch,['a','b']);
 writes[1].callback();client.message({request_id:1,error:'success'});client.message({request_id:2,error:'success'});await Promise.all([first,second]);assert.equal(client.transport.writeCount,2);
});

test('repeated drains cannot resend a request while its ACK is outstanding',async()=>{
 const {client,writes}=fixture(),pending=Array.from({length:64},(_,i)=>client.command(['get_property',String(i)]));
 for(let i=0;i<64;i++){client.flushWrites();assert.equal(writes.length,i+1);writes[i].callback();await tick();}
 for(let i=0;i<256;i++)client.flushWrites();
 assert.equal(writes.length,64);assert.equal(new Set(writes.map(write=>write.packet.request_id)).size,64);
 for(const write of writes)client.message({request_id:write.packet.request_id,error:'success'});
 await Promise.all(pending);assert.equal(client.requests.size,0);
});
