// Deterministic coordination tests; no windows, video writes or real processes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),Module=require('node:module'),originalLoad=Module._load;
const {ownedRendererExited}=require('../dist/processLiveness.js');
assert.equal(ownedRendererExited(0,()=>{throw new Error('must not probe');}),false);
assert.equal(ownedRendererExited(123,(_pid,signal)=>{assert.equal(signal,0);throw Object.assign(new Error('gone'),{code:'ESRCH'});}),true);
assert.equal(ownedRendererExited(123,()=>{throw Object.assign(new Error('denied'),{code:'EPERM'});}),false);
let NativePlayer;
try{Module._load=function(id,...rest){return id==='electron'?{}:originalLoad.call(this,id,...rest);};({NativePlayer}=require('../dist/nativePlayer.js'));}finally{Module._load=originalLoad;}
const tick=()=>new Promise(r=>setTimeout(r,0));
const player=new NativePlayer({main:()=>null,log:()=>{}});player.publish=()=>{};
const activity=player.activity.bind(player);player.activity=async()=>{};
let unblock;const gate=new Promise(r=>unblock=r),writes=[];
player.api=async(route,_method,body)=>{writes.push({route,body});if(writes.length===1)await gate;return {};};
const active={client:{snapshot:{properties:{'time-pos':10}}},persist:Promise.resolve(),audioRevision:0,savedAudio:0,speedRevision:0,savedSpeed:0,styleRevision:0,savedStyle:0};
const first=player.save(active);for(let i=0;i<30;i++)assert.equal(player.save(active),first);await tick();assert.equal(writes.length,1);
active.client.snapshot.properties['time-pos']=20;const final=player.save(active,true);unblock();await Promise.all([first,final]);assert.equal(writes.length,2);assert.equal(writes[1].body.progress,20);
let release;const wait=new Promise(r=>release=r),activities=[];
player.api=async(_route,_method,body)=>{activities.push(body);if(activities.length===1)await wait;return {};};
Object.assign(active.client.snapshot,{phase:'ready',pendingSeek:null});Object.assign(active.client.snapshot.properties,{pause:false});active.owner='fixture';active.mediaId=1;
const initial=activity(active);await tick();for(let i=0;i<30;i++)activity(active);activity(active,false);release();await initial;assert.equal(activities.length,2);assert.equal(activities.at(-1).present,false);
player.activity=async()=>{};player.save=async()=>{};const order=[];player.api=async route=>{order.push(route);return {};};
// Only frame acquisition excludes navigation; slow PNG publishing must not.
player.trusted=()=>{};active.client.session='fixture';active.closing=false;active.screenshotBusy=true;player.active=active;
let sought;active.client.seek=value=>{sought=value;};player.capturingFrames.add(active);
await assert.rejects(()=>player.invoke({},'seek',{session:'fixture',value:8}),/截取画面/);
player.capturingFrames.delete(active);await player.invoke({},'seek',{session:'fixture',value:8});assert.equal(sought,8);
let finish;const capture=new Promise(r=>finish=r);const closing={...active,screenshotBusy:true,closing:false,operations:new Set(),heartbeat:setInterval(()=>{},10000),host:{isDestroyed:()=>false,destroy:()=>order.push('host')},overlay:{isDestroyed:()=>false,destroy:()=>order.push('overlay')},client:{...active.client,stop:async()=>order.push('stop')}};
player.active=closing;player.captureTasks.set(closing,capture);const closed=player.close();await tick();assert.deepEqual(order,[],'read fence stays held while capture writes');finish();await closed;assert.equal(order[0],'stop');assert.match(order[1],/native-read/);assert.equal(player.active,null);
const source=readFileSync(new URL('../../frontend/src/nativeLayoutQueue.ts',import.meta.url),'utf8');
const {NativeLayoutQueue}=await import('data:text/javascript;base64,'+Buffer.from(Module.stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));let count=0;const errors=[];
const queue=new NativeLayoutQueue(async()=>{if(++count===1)throw new Error('transient');},e=>errors.push(e));queue.push(1,'same');await new Promise(r=>setTimeout(r,150));assert.equal(count,2);assert.equal(errors.length,0);queue.push(1,'same');await tick();assert.equal(count,2);queue.dispose();
const values=[];let next;const held=new Promise(r=>next=r),latest=new NativeLayoutQueue(async v=>{values.push(v);if(v===1)await held;},()=>{});latest.push(1,'1');latest.push(2,'2');latest.push(3,'3');next();await tick();assert.deepEqual(values,[1,3]);latest.dispose();
let failures=0,attempts=0;const bounded=new NativeLayoutQueue(async()=>{attempts++;throw new Error('persistent');},()=>failures++);bounded.push(1,'1');await new Promise(r=>setTimeout(r,750));assert.equal(attempts,4);assert.equal(failures,1);bounded.dispose();
console.log('Native coordination passed: bounded saves/activity, capture-before-exit, confirmed layout retry/latest geometry.');
const surfaces=new NativePlayer({log:()=>{}}),surface={closing:false,owner:'fixture',client:{processId:123},host:{isDestroyed:()=>false,getNativeWindowHandle:()=>Buffer.from([1,0,0,0])}};
let probes=0;surfaces.api=async()=>{if(++probes<4)throw Object.assign(new Error('not ready'),{status:409});return {};};
const scheduled=[],realTimer=globalThis.setTimeout;
try{globalThis.setTimeout=(fn,ms,...args)=>{scheduled.push(ms);return realTimer(fn,0,...args);};await surfaces.raiseSurface(surface);}finally{globalThis.setTimeout=realTimer;}
assert.equal(probes,4);assert.deepEqual(scheduled,[15,20,25],'ready surface must not pay repeated fixed 100ms sleeps');
probes=0;surfaces.api=async()=>{probes++;throw Object.assign(new Error('forbidden'),{status:403});};
await assert.rejects(()=>surfaces.raiseSurface(surface),/forbidden/);assert.equal(probes,1,'authorization errors never retry');
console.log('Native surface readiness passed: short bounded backoff and fail-fast permission errors.');
