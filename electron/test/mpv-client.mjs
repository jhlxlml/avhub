import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {MpvClient}=require('../dist/mpvClient.js');
const {subtitleStyle,subtitleOptions}=require('../dist/nativeSubtitle.js');
assert.throws(()=>subtitleStyle({size:99,color:'#ffffff',background:0}));
assert.deepEqual(subtitleOptions(subtitleStyle({size:30,color:'#ffe38a',background:.65})).find(([key])=>key==='sub-back-color'),['sub-back-color','#a6000000']);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const videoTracks=[{type:'video',id:1,selected:true}];
const isSeek=c=>c[0]==='set_property'&&c[1]==='time-pos';
const published=[],sent=[];let position=10;
const client=new MpvClient(state=>published.push(state),()=>{});
client.snapshot.phase='ready';
client.command=async value=>{sent.push(value);if(value[0]==='get_property')return position;return null;};
client.seek(10);client.seek(20);client.seek(30);
assert.deepEqual(sent.filter(isSeek),[['set_property','time-pos',10]]);
assert.equal(client.snapshot.pendingSeek,30);
client.message({event:'playback-restart'});await tick();
assert.deepEqual(sent.filter(isSeek),[['set_property','time-pos',10],['set_property','time-pos',30]]);
assert.equal(client.snapshot.pendingSeek,30);
// A stale restart/time must not finish the latest seek.
client.message({event:'playback-restart'});await tick();assert.equal(client.snapshot.pendingSeek,30);
position=30;client.message({event:'playback-restart'});await tick();assert.equal(client.snapshot.pendingSeek,null);
assert.ok(client.snapshot.lastSeekTotalMs>=client.snapshot.lastSeekMs,'intent latency includes queue wait');
client.message({event:'start-file'});client.message({event:'property-change',name:'paused-for-cache',data:true});
client.message({event:'property-change',name:'paused-for-cache',data:true});await tick();
client.message({event:'property-change',name:'paused-for-cache',data:false});
assert.equal(client.snapshot.sourceLoads,1);assert.equal(client.snapshot.bufferingEvents,1);assert.ok(client.snapshot.bufferingMs>0);
assert.equal(client.snapshot.properties['time-pos'],30);assert.equal(client.snapshot.seeks,2);
assert.throws(()=>client.seek(NaN));assert.throws(()=>client.seek(-1));
client.message({event:'end-file',reason:'error'});assert.equal(client.snapshot.phase,'error');assert.match(client.snapshot.error,/未自动转码/);
await client.stop();
await assert.rejects(()=>client.start('never-executed','never-opened','0',0),/已取消/);
const corrected=[],events=[];let actual=41.7;
const repair=new MpvClient(value=>events.push(value),()=>{});
repair.snapshot.phase='ready';
repair.command=async value=>{corrected.push(value);return value[0]==='get_property'?actual:null;};
repair.seek(40);repair.message({event:'playback-restart'});await tick();
assert.ok(corrected.some(value=>value[0]==='set_property'&&value[1]==='options/hr-seek-demuxer-offset'&&value[2]>0));
assert.equal(repair.snapshot.pendingSeek,40,'overshoot is not success');
actual=40.02;repair.message({event:'playback-restart'});await tick();
assert.equal(repair.snapshot.pendingSeek,null);assert.equal(repair.snapshot.seekCorrections,1);
assert.ok(corrected.some(value=>value[1]==='options/hr-seek-demuxer-offset'&&value[2]===0),'preroll restored after observed correction');
await repair.stop();
const superseded=[],second=new MpvClient(()=>{},()=>{});let actualSecond=11.8;
second.snapshot.phase='ready';
second.command=async value=>{superseded.push(value);return value[0]==='get_property'?actualSecond:null;};
second.seek(10);second.message({event:'playback-restart'});await tick();
second.seek(20);second.message({event:'playback-restart'});await tick();
const reset=superseded.findIndex(value=>value[1]==='options/hr-seek-demuxer-offset'&&value[2]===0);
const next=superseded.findIndex(value=>isSeek(value)&&value[2]===20);
assert.ok(reset>=0&&next>reset,'superseding ordinary seek must not inherit temporary preroll');
actualSecond=20.01;second.message({event:'playback-restart'});await tick();assert.equal(second.snapshot.pendingSeek,null);
await second.stop();
const overlap=new MpvClient(()=>{},()=>{});let overlapPosition=10;
overlap.snapshot.phase='ready';
overlap.command=async value=>{if(value[0]==='get_property')return overlapPosition;if(isSeek(value)&&value[2]===20){overlapPosition=20;overlap.message({event:'playback-restart'});}return null;};
overlap.seek(10);overlap.seek(20);overlap.message({event:'playback-restart'});await tick();
assert.equal(overlap.snapshot.pendingSeek,null,'a restart received during preceding verification must not be lost');assert.equal(overlap.snapshot.properties['time-pos'],20);await overlap.stop();
// Early clicks are retained, coalesced and clamped once metadata is known.
const startupSent=[],early=new MpvClient(()=>{},()=>{});let earlyPosition=39.99;
early.command=async value=>{startupSent.push(value);return value[0]==='get_property'?earlyPosition:null;};
early.seek(10);early.seek(90);assert.equal(early.snapshot.phase,'starting');assert.equal(early.snapshot.pendingSeek,90);assert.equal(startupSent.length,0);
early.startupStage='started';early.snapshot.properties.duration=40;early.snapshot.properties['video-params']={w:640,h:360};early.snapshot.properties['track-list']=videoTracks;
early.message({event:'file-loaded'});await tick();
assert.deepEqual(startupSent.filter(isSeek),[['set_property','time-pos',39.99]]);assert.equal(early.snapshot.pendingSeek,39.99);
early.message({event:'playback-restart'});await tick();assert.equal(early.snapshot.pendingSeek,null);assert.equal(early.snapshot.phase,'ready');await early.stop();
const cancelled=[],earlyClose=new MpvClient(()=>{},()=>{});earlyClose.command=async value=>{cancelled.push(value);return null;};earlyClose.seek(20);await earlyClose.stop();earlyClose.message({event:'file-loaded'});assert.equal(cancelled.length,0,'closing cancels a queued startup seek');
console.log('MPV control queue passed: latest intent, actual target, stale restart rejection, quality-safe errors.');
const relative=new MpvClient(()=>{},()=>{});relative.snapshot.phase='ready';relative.snapshot.properties['time-pos']=10;relative.command=async()=>null;
relative.seekBy(5);relative.seekBy(5);assert.equal(relative.snapshot.pendingSeek,20);relative.seekBy(-10);assert.equal(relative.snapshot.pendingSeek,10);assert.throws(()=>relative.seekBy(121));await relative.stop();
const attempts=[],failed=new MpvClient(()=>{},()=>{});failed.snapshot.phase='ready';
failed.command=async c=>{if(isSeek(c)){attempts.push(c[2]);if(c[2]===10)throw new Error('injected send error');}return 20;};
failed.seek(10);failed.seek(20);await tick();assert.deepEqual(attempts,[10,20]);assert.equal(failed.snapshot.pendingSeek,20);failed.message({event:'playback-restart'});await tick();assert.equal(failed.snapshot.pendingSeek,null);await failed.stop();
const eof=new MpvClient(()=>{},()=>{});eof.snapshot.phase='ready';eof.snapshot.properties.duration=100;eof.command=async()=>99.99;eof.seek(99.99);
eof.message({event:'property-change',name:'eof-reached',data:true});assert.notEqual(eof.snapshot.phase,'ended','EOF during positioning is not natural completion');eof.message({event:'playback-restart'});await tick();assert.equal(eof.snapshot.phase,'ended');assert.equal(eof.endReason,'seek');
eof.message({event:'property-change',name:'eof-reached',data:false});eof.message({event:'property-change',name:'eof-reached',data:true});assert.equal(eof.endReason,'natural');await eof.stop();
const slow=new MpvClient(()=>{},()=>{});slow.snapshot.phase='ready';Object.assign(slow.snapshot.properties,{'time-pos':40,pause:false,speed:1});slow.command=async c=>{if(c[0]==='get_property'){await new Promise(r=>setTimeout(r,650));return 40.6;}return null;};slow.seek(40);slow.message({event:'playback-restart'});await new Promise(r=>setTimeout(r,700));assert.equal(slow.snapshot.pendingSeek,null);assert.equal(slow.snapshot.seekCorrections,0,'witnessed target followed by elapsed playback is not overshoot');await slow.stop();
console.log('MPV iteration regression passed: atomic relative intents, failure ownership, EOF classification, delayed-clock verification.');
// New targets are dispatched after ACK, without waiting for the previous frame.
// A slow ACK still bounds the queue to one command plus the latest intent.
const latestCommands=[],latest=new MpvClient(()=>{},()=>{});let releaseAck;
latest.snapshot.phase='ready';latest.snapshot.properties['time-pos']=10;
latest.command=async c=>{latestCommands.push(c);if(isSeek(c)&&c[2]===15)await new Promise(r=>releaseAck=r);return c[0]==='get_property'?30:null;};
latest.seekBy(5);latest.seekBy(5);latest.seekBy(5);latest.seekBy(5);
assert.deepEqual(latestCommands.filter(isSeek).map(c=>c[2]),[15]);
releaseAck();await tick();
assert.deepEqual(latestCommands.filter(isSeek).map(c=>c[2]),[15,30],'latest intent need not wait for an obsolete playback-restart');
assert.equal(latest.snapshot.pendingSeek,30,'ACK is not decoded completion');
latest.message({event:'playback-restart'});await tick();assert.equal(latest.snapshot.pendingSeek,null);await latest.stop();
console.log('MPV ACK-gated latest-intent dispatch passed without decoded-frame serialization.');
// Native input stays in MPV. Its announced target is verified and measured,
// never reported as settled just because an input/IPC command was received.
const native=new MpvClient(()=>{},()=>{}),nativeCommands=[];let nativePosition=19.98;
native.nativeWindow=true;native.snapshot.phase='ready';Object.assign(native.snapshot.properties,{'time-pos':0,duration:20,pause:false});
native.command=async c=>{nativeCommands.push(c);return c[0]==='get_property'?nativePosition:null;};
native.message({event:'client-message',args:['avhub','seek-intent','19.5']});native.message({event:'seek'});
assert.equal(native.snapshot.pendingSeek,19.5);assert.equal(native.snapshot.seeks,1);
native.message({event:'playback-restart'});await tick();assert.equal(native.snapshot.pendingSeek,null);assert.equal(native.snapshot.lastSeekTarget,19.5);assert.equal(native.snapshot.lastSeekPosition,19.98);
assert.ok(native.snapshot.lastSeekMs!==null);assert.equal(nativeCommands.some(isSeek),false,'native intent is not reissued via Electron');
native.message({event:'property-change',name:'eof-reached',data:true});assert.equal(native.endReason,'natural','playing reaches EOF within one second of a near-end seek still autoplays');
native.message({event:'property-change',name:'eof-reached',data:false});native.snapshot.properties.pause=true;
nativePosition=19.99;native.message({event:'client-message',args:['avhub','seek-intent','20']});native.message({event:'seek'});
native.message({event:'property-change',name:'eof-reached',data:true});native.message({event:'playback-restart'});await tick();
assert.equal(native.endReason,'seek','paused manual seek to EOF does not autoplay');
assert.equal(native.snapshot.lastSeekTarget,19.99);await native.stop();
const nativeLatest=new MpvClient(()=>{},()=>{});let releaseNative;
nativeLatest.nativeWindow=true;nativeLatest.snapshot.phase='ready';nativeLatest.snapshot.properties.duration=100;
nativeLatest.command=async c=>{if(c[0]==='get_property')return new Promise(resolve=>releaseNative=resolve);return null;};
nativeLatest.message({event:'client-message',args:['avhub','seek-intent','10']});nativeLatest.message({event:'playback-restart'});
nativeLatest.message({event:'client-message',args:['avhub','seek-intent','30']});nativeLatest.message({event:'playback-restart'});
releaseNative(10);await tick();assert.equal(nativeLatest.snapshot.pendingSeek,30,'obsolete decoded time does not settle the latest native intent');
releaseNative(30);await tick();assert.equal(nativeLatest.snapshot.pendingSeek,null);assert.equal(nativeLatest.snapshot.lastSeekTarget,30);await nativeLatest.stop();
console.log('Native seek observation passed: real target query, native fast path, latest revision and natural EOF after near-end seek.');
const unloading=new MpvClient(()=>{},()=>{});unloading.snapshot.phase='ready';
unloading.message({event:'property-change',name:'time-pos',data:12.4});
unloading.message({event:'property-change',name:'track-list',data:[{id:3,type:'audio','ff-index':2}]});
unloading.message({event:'property-change',name:'aid',data:3});
unloading.message({event:'end-file',reason:'quit'});
unloading.message({event:'property-change',name:'time-pos',data:undefined});
unloading.message({event:'property-change',name:'track-list',data:[]});
unloading.message({event:'property-change',name:'aid',data:false});
assert.equal(unloading.snapshot.properties['time-pos'],undefined,'live snapshot does not pretend to keep decoding');
assert.equal(unloading.playbackProperties['time-pos'],12.4);assert.equal(unloading.playbackProperties.aid,3);
assert.equal(unloading.playbackProperties['track-list'].length,1,'native unload cannot overwrite final track selection');await unloading.stop();
console.log('Native unload persistence passed: final clock/track snapshot is separate from live decoded state.');
const timedNative=new MpvClient(()=>{},()=>{}),realSetTimeout=globalThis.setTimeout;let expireNative;
timedNative.nativeWindow=true;timedNative.snapshot.phase='ready';timedNative.snapshot.properties.duration=50;
try{
 globalThis.setTimeout=(fn,ms,...args)=>{if(ms===15000){expireNative=()=>fn(...args);return realSetTimeout(()=>{},60000);}return realSetTimeout(fn,ms,...args);};
 timedNative.message({event:'client-message',args:['avhub','seek-intent','20']});
 assert.equal(timedNative.snapshot.seekMode,'native');expireNative();
 assert.equal(timedNative.snapshot.pendingSeek,null);assert.equal(timedNative.snapshot.seekMode,null);assert.match(timedNative.snapshot.error,/尚未确认/);
 timedNative.message({event:'client-message',args:['avhub','seek-intent','30']});assert.equal(timedNative.snapshot.error,undefined);
}finally{globalThis.setTimeout=realSetTimeout;await timedNative.stop();}
console.log('Native seek timeout passed: bounded unfinished observation and clean retry.');
const closingNative=new MpvClient(()=>{},()=>{});closingNative.nativeWindow=true;
closingNative.message({event:'client-message',args:['avhub','closing']});assert.equal(closingNative.expectedNativeExit,true);
assert.equal(closingNative.closed,false,'native close intent never counts as OS exit');await closingNative.stop();

// A restart without loaded video/clock was observed before an AO failure.
// Never label an idle or failed initialization event as the first video frame.
const frame=new MpvClient(()=>{},()=>{});
frame.message({event:'playback-restart'});assert.equal(frame.snapshot.phase,'starting');assert.equal(frame.snapshot.firstFrameMs,null);
frame.message({event:'start-file'});frame.message({event:'file-loaded'});
frame.message({event:'property-change',name:'video-params',data:{w:3840,h:2160}});
frame.message({event:'property-change',name:'time-pos',data:0});
assert.equal(frame.snapshot.firstFrameMs,null,'metadata and a pre-file restart cannot prove a decoded frame');
frame.message({event:'property-change',name:'track-list',data:videoTracks});
frame.message({event:'playback-restart'});assert.equal(frame.snapshot.phase,'ready');assert.ok(frame.snapshot.firstFrameMs!==null);await frame.stop();
const lateClock=new MpvClient(()=>{},()=>{});lateClock.message({event:'file-loaded'});lateClock.message({event:'playback-restart'});
lateClock.message({event:'property-change',name:'track-list',data:videoTracks});
lateClock.message({event:'property-change',name:'video-params',data:{w:640,h:360}});assert.equal(lateClock.snapshot.firstFrameMs,null);
lateClock.message({event:'property-change',name:'time-pos',data:.04});assert.equal(lateClock.snapshot.phase,'ready','late video/clock observation retains the post-load restart');await lateClock.stop();
for(const [fileError,code,copy] of [
 ['audio output initialization failed','audio-output',/音频输出设备初始化失败/],
 ['video output initialization failed','video-output',/视频输出初始化失败/],
 ['loading failed','source',/原文件读取失败/],
 ['video decoding failed','decode',/未自动转码/],
 ['unknown E:\\private\\video.mkv','unknown',/未自动转码/],
]){
 const failed=new MpvClient(()=>{},()=>{});failed.message({event:'file-loaded'});failed.message({event:'playback-restart'});
 failed.message({event:'end-file',reason:'error',file_error:fileError});assert.equal(failed.snapshot.failureCode,code);assert.match(failed.snapshot.error,copy);
 assert.equal(failed.snapshot.firstFrameMs,null);assert.doesNotMatch(failed.snapshot.error,/private/);
 failed.message({event:'property-change',name:'video-params',data:{w:640,h:360}});failed.message({event:'property-change',name:'time-pos',data:1});
 assert.equal(failed.snapshot.phase,'error','unloaded failures cannot recover from stale property updates');
 failed.message({event:'property-change',name:'eof-reached',data:true});assert.equal(failed.snapshot.phase,'error','unload EOF is not natural completion after a fatal failure');
 assert.throws(()=>failed.seek(10),/重新打开/);await failed.stop();
}
console.log('Native startup evidence passed: loaded video + decoded restart + real clock; structured AO/VO/source failure classification.');

// A video frame is not proof that a selected audio output has opened. Check
// every event ordering without delays, silent null audio or a source reload.
const startingAudio=()=>{const c=new MpvClient(()=>{},()=>{});c.message({event:'start-file'});c.message({event:'file-loaded'});c.message({event:'property-change',name:'video-params',data:{w:3840,h:2160}});c.message({event:'property-change',name:'time-pos',data:0});c.message({event:'playback-restart'});return c;};
const audioTracks=[...videoTracks,{type:'audio',id:2,selected:true}];
const audio=startingAudio();
assert.equal(audio.snapshot.phase,'starting','idle/missing track metadata cannot declare A/V ready');
assert.ok(audio.snapshot.firstFrameMs!==null,'keep the actual video-restart evidence even while audio is not ready');
audio.message({event:'property-change',name:'track-list',data:audioTracks});
for(const ao of [undefined,'','null']){audio.message({event:'property-change',name:'current-ao',data:ao});assert.equal(audio.snapshot.phase,'starting');assert.equal(audio.snapshot.readyMs,null);}
const firstVideo=audio.snapshot.firstFrameMs;
audio.message({event:'property-change',name:'current-ao',data:'wasapi'});
assert.equal(audio.snapshot.phase,'ready');assert.ok(audio.snapshot.readyMs>=firstVideo);assert.equal(audio.snapshot.firstFrameMs,firstVideo);
assert.equal(audio.snapshot.sourceLoads,1);await audio.stop();
const failedAudio=startingAudio();failedAudio.message({event:'property-change',name:'track-list',data:audioTracks});
failedAudio.message({event:'end-file',reason:'error',file_error:'audio output initialization failed'});
assert.ok(failedAudio.snapshot.firstFrameMs!==null);assert.equal(failedAudio.snapshot.readyMs,null,'a video frame before AO failure is not A/V readiness');
failedAudio.message({event:'property-change',name:'current-ao',data:'wasapi'});assert.equal(failedAudio.snapshot.phase,'error');await failedAudio.stop();
const lateTracks=startingAudio();lateTracks.message({event:'property-change',name:'current-ao',data:'wasapi'});
assert.equal(lateTracks.snapshot.phase,'starting');lateTracks.message({event:'property-change',name:'track-list',data:audioTracks});assert.equal(lateTracks.snapshot.phase,'ready');await lateTracks.stop();
for(const tracks of [videoTracks,[...videoTracks,{type:'audio',id:2,selected:false}]]){
 const silentSource=startingAudio();silentSource.message({event:'property-change',name:'aid',data:false});silentSource.message({event:'property-change',name:'track-list',data:tracks});
 assert.equal(silentSource.snapshot.phase,'ready','video-only or explicitly disabled audio does not need an output');await silentSource.stop();
}
const idSelected=startingAudio();idSelected.message({event:'property-change',name:'aid',data:2});
idSelected.message({event:'property-change',name:'track-list',data:[...videoTracks,{type:'audio',id:2}]});assert.equal(idSelected.snapshot.phase,'starting');
idSelected.message({event:'property-change',name:'current-ao',data:'wasapi'});assert.equal(idSelected.snapshot.phase,'ready');await idSelected.stop();
console.log('Native A/V readiness passed: selected output, late track/AO events, no-audio sources, real frame vs A/V metrics, no silent null fallback.');
