// Deterministic lifetime tests. No real process, windows or media writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{IndependentPlayer}=require('../dist/independentPlayer.js'),{independentInput}=require('../dist/independentInput.js');
for(const value of [0,121,1.2,'5',null])assert.throws(()=>independentInput(value));
const input=independentInput(9);assert.match(input,/MBTN_BACK script-message-to avhub_ui seek-relative -9/);assert.match(input,/^c script-message avhub screenshot$/m);
assert.doesNotMatch(input,/screenshot-to-file|write-watch-later|loadfile|\brun\b|console/);
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(api){
 const player=new IndependentPlayer({api,send:()=>{},log:()=>{}});
 const s={client:{session:'fixture',snapshot:{phase:'ready',pendingSeek:null,properties:{'time-pos':3,pause:false}}},mediaId:1,owner:'owner',title:'test',closing:false,stopped:false,cleanupError:'',saveError:'',revision:0,failed:false,ready:false,persist:Promise.resolve(),timer:setInterval(()=>{},10000)};
 player.active=s;return {player,s};
}
{
 let unblock;const gate=new Promise(r=>unblock=r),writes=[];
 const {player,s}=fixture(async(route,method,body)=>{writes.push({route,method,body});if(writes.length===1)await gate;return {};});
 const first=player.save(s);for(let n=0;n<30;n++)assert.equal(player.save(s),first);
 await tick();s.client.snapshot.properties['time-pos']=7;const final=player.save(s,true);unblock();await Promise.all([first,final]);
 assert.deepEqual(writes.filter(v=>v.route.endsWith('/progress')).map(v=>v.body.progress),[3,7]);clearInterval(s.timer);
}
{
 const order=[];let finish;const capture=new Promise(r=>finish=r),{player,s}=fixture(async(route)=>{order.push(route);return {};});
 s.capture=capture;s.client.stop=async()=>{order.push('stop');};
 const closing=player.close();assert.equal(player.close(),closing);await tick();assert.deepEqual(order,[]);
 finish();await closing;assert.ok(order.indexOf('stop')<order.indexOf('/api/native-read/owner'));assert.equal(player.hasSession,false);
}
{
 const routes=[];let exits=false;const {player,s}=fixture(async(route)=>{routes.push(route);return {};});
 s.client.stop=async()=>{if(!exits)throw new Error('not exited');};
 await assert.rejects(()=>player.close(),/not exited/);assert.equal(player.hasSession,true);assert.ok(!routes.includes('/api/native-read/owner'));
 s.failed=true;s.failure=new Error('primary startup fault');await assert.rejects(()=>player.prepareOpen(),/primary startup fault.*文件保护/);
 exits=true;await player.prepareOpen();assert.equal(player.hasSession,false);assert.ok(routes.includes('/api/native-read/owner'));
}
{
 const writes=[],{player,s}=fixture(async(route,method,body)=>{writes.push({route,method,body});return {};});
 Object.assign(s,{ready:true,memory:{source:'source'},memoryRetired:false,externalSubtitles:['allowed.srt'],lastMemory:'',lastAudio:''});
 Object.assign(s.client.snapshot.properties,{'track-list':[{type:'sub',id:4,external:true,'external-filename':'allowed.srt'}],sid:4,'sub-delay':.5,volume:50,mute:false,speed:1.1});
 await player.save(s);assert.equal(writes.find(v=>v.route.endsWith('/playback-state')).body.changes.subtitle,'allowed.srt');
 assert.equal('playbackSpeed' in writes.find(v=>v.route==='/api/preferences').body.values,false,'native arbitrary speed cannot corrupt portable preference');
 clearInterval(s.timer);
}
console.log('Independent coordination passed: bounded saves, capture fence, exit confirmation, subtitle allowlist and safe preferences.');
{
 const routes=[];let broken=true,stops=0;
 const {player,s}=fixture(async(route)=>{routes.push(route);if(route.endsWith('/progress')&&broken)throw new Error('simulated DB failure');return {};});
 s.ready=true;s.memory={source:'source'};s.externalSubtitles=[];
 s.client.stop=async()=>{stops++;s.client.snapshot.phase='closed';};
 await assert.rejects(()=>player.close(),/尚未保存/);
 assert.equal(stops,1);assert.ok(routes.includes('/api/native-read/owner'),'confirmed exit releases source fence even when saving fails');
 assert.equal(player.hasSession,true,'unsaved snapshot retained until explicit resolution');
 assert.equal(player.view(s).stopped,true);assert.equal(player.view(s).recovery,'save');
 await assert.rejects(()=>player.prepareOpen(),/先重试保存/);
 await assert.rejects(()=>player.invoke('discard-close','wrong-session'),/过期/);
 broken=false;await player.invoke('close','fixture');assert.equal(player.hasSession,false);
}
{
 let broken=true,stops=0;const {player,s}=fixture(async(route)=>{if(route.endsWith('/progress')&&broken)throw new Error('save failed');return {};});
 s.client.stop=async()=>{stops++;};
 await assert.rejects(()=>player.invoke('discard-close','fixture'),/没有可放弃/);
 await assert.rejects(()=>player.close(),/尚未保存/);assert.equal(stops,1);
 await player.invoke('discard-close','fixture');assert.equal(player.hasSession,false,'explicit discard works without a successful save');
}
{
 let cleanupFails=true;const routes=[];const {player,s}=fixture(async(route)=>{routes.push(route);if(route.includes('/native-read/')&&cleanupFails)throw new Error('cleanup offline');return {};});
 s.client.stop=async()=>{};
 await assert.rejects(()=>player.close(),/cleanup offline/);assert.equal(player.view(s).recovery,'cleanup');
 await assert.rejects(()=>player.invoke('show','fixture'),/已关闭/);
 cleanupFails=false;await player.close();assert.equal(player.hasSession,false);
}
{
 let release;const held=new Promise(resolve=>release=resolve),bodies=[];
 const {player,s}=fixture(async(route,_method,body)=>{if(route==='/api/playback/activity'){bodies.push(body);if(bodies.length===1)await held;}return {};});
 const first=player.activity(s,true);await tick();
 s.client.snapshot.properties.pause=true;s.client.snapshot.seekMode='native';s.client.snapshot.pendingSeek=10;
 for(let n=0;n<30;n++)player.activity(s,true);
 const last=player.activity(s,false);release();await Promise.all([first,last]);
 assert.equal(bodies.length,2);assert.equal(bodies.at(-1).present,false,'final inactive state wins over delayed active heartbeat');
 const preparing=player.activityBody(s,true);assert.equal(preparing.preparing,true);assert.equal(preparing.playing,true,'paused native seeks receive I/O priority');
 s.stopped=true;assert.equal(player.activityBody(s,true).playing,false);clearInterval(s.timer);
}
console.log('Independent recovery passed: stopped/unsaved separation, explicit discard, cleanup retry and latest bounded I/O priority.');
{
 let cleanupFails=true;const {player,s}=fixture(async(route)=>{if(route.includes('/native-read/')&&cleanupFails)throw new Error('cleanup offline');return {};});
 s.failed=true;s.failure=new Error('initial startup fault');s.client.stop=async()=>{};
 await assert.rejects(()=>player.close(true),/cleanup offline/);assert.equal(s.stopped,true);
 cleanupFails=false;await player.prepareOpen();assert.equal(player.hasSession,false,'failed startup cleanup remains retryable before any attached session exists');
}
