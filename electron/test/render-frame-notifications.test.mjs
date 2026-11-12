// Controlled pipe/scheduling contracts, not GPU or performance certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{RenderHostClient}=require('../dist/renderHostClient.js'),{RenderPlayer}=require('../dist/renderPlayer.js');
function client(enabled){
 const previous=process.env.AVHUB_RENDER_FRAME_NOTIFICATIONS;
 if(enabled===undefined)delete process.env.AVHUB_RENDER_FRAME_NOTIFICATIONS;else process.env.AVHUB_RENDER_FRAME_NOTIFICATIONS=enabled?'1':'0';
 const value=new RenderHostClient({}, {drain:async()=>{}});
 if(previous===undefined)delete process.env.AVHUB_RENDER_FRAME_NOTIFICATIONS;else process.env.AVHUB_RENDER_FRAME_NOTIFICATIONS=previous;
 const failures=[];value.on('failure',error=>failures.push(error));return {value,failures};
}

test('default requests real notifications but retains legacy fallback until a host hint arrives',()=>{
 const {value,failures}=client(undefined);assert.deepEqual(value.frameNotificationStats(),{requested:true,received:0,lastSerial:0});assert.equal(value.frameNotificationsActive,false);
 value.accept(Buffer.from('{"event":"frame-ready","serial":1}\n'));assert.equal(value.frameNotificationsActive,true);assert.deepEqual(failures,[]);
 const off=client(false);assert.equal(off.value.frameNotificationStats().requested,false);
});
test('split ready hints coalesce by serial and do not complete a command or GPU receipt',()=>{
 const {value,failures}=client(true);let hints=0,replies=0;value.on('frame-ready',()=>hints++);
 assert.equal(value.frameNotificationsActive,false);
 value.pending.set(9,{resolve:()=>replies++,reject:assert.fail});
 value.accept(Buffer.from('{"event":"frame-'));value.accept(Buffer.from('ready","serial":2}\n{"event":"frame-ready","serial":2}\n{"event":"frame-ready","serial":1}\n'));
 assert.equal(hints,1);assert.equal(replies,0);assert.equal(value.pending.size,1);
 value.accept(Buffer.from('{"id":9,"result":{"ok":true}}\n{"event":"frame-ready","serial":3}\n'));
 assert.equal(replies,1);assert.equal(hints,2);assert.equal(value.pending.size,0);assert.deepEqual(failures,[]);
 assert.deepEqual(value.frameNotificationStats(),{requested:true,received:2,lastSerial:3});
 assert.equal(value.frameNotificationsActive,true);
});
test('unsolicited, malformed and mixed response/notification packets remain fatal',()=>{
 for(const [enabled,packet] of [[false,{event:'frame-ready',serial:1}],[true,{event:'frame-ready',serial:0}],[true,{event:'frame-ready',serial:1,id:2}],[true,{event:'unknown',serial:1}]]){
  const {value,failures}=client(enabled);value.accept(Buffer.from(JSON.stringify(packet)+'\n'));assert.equal(failures.length,1);assert.match(failures[0].message,/协议无效/);
 }
});
test('retired host hints cannot wake a closed player',()=>{
 const {value,failures}=client(true);let hints=0;value.on('frame-ready',()=>hints++);value.retired=true;
 value.accept(Buffer.from('{"event":"frame-ready","serial":1}\n'));assert.equal(hints,0);assert.deepEqual(failures,[]);
});
test('busy pump coalesces hints and idle pump cancels fallback before starting once',()=>{
 const player=new RenderPlayer({}),active={closing:false,error:'',bridge:{},poll:Promise.resolve()};player.active=active;let starts=0;
 player.pump=()=>{starts++;active.poll=Promise.resolve();};player.wakeFrame(active,1);player.wakeFrame(active,1);
 assert.equal(starts,0);assert.equal(active.frameReady,true);
 active.poll=undefined;active.timer=setTimeout(()=>assert.fail('stale fallback fired'),20);
 player.wakeFrame(active,1);player.wakeFrame(active,1);assert.equal(starts,1);assert.equal(active.timer,undefined);
});
test('closing, failed and stale sessions never start a frame task',()=>{
 const player=new RenderPlayer({}),active={closing:false,error:'',bridge:{}};let starts=0;player.pump=()=>starts++;player.active=active;
 player.wakeFrame({...active},1);active.closing=true;player.wakeFrame(active,1);active.closing=false;active.error='failure';player.wakeFrame(active,1);assert.equal(starts,0);
});
test('a late hint for an already acquired texture cannot queue another frame task',()=>{
 const player=new RenderPlayer({}),active={closing:false,error:'',bridge:{},lastFrame:4};player.active=active;
 player.pump=()=>assert.fail('already acquired frame must not wake');player.wakeFrame(active,4);player.wakeFrame(active,3);assert.equal(active.frameReady,undefined);
});
