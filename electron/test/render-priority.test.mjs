// Actual service activity policy/coalescing, controlled HTTP; not seek timing.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {RenderPlayer}=createRequire(import.meta.url)('../dist/renderPlayer.js');
const fixture=()=>{const calls=[],player=new RenderPlayer({log:()=>{}}),active={owner:'a'.repeat(32),mediaId:1,firstFrame:1,pendingSeek:null,closing:false,error:'',props:{pause:false,'eof-reached':false}};player.api=async(route,method,body)=>{calls.push({route,method,body});};return {player,active,calls};};
test('identical playing heartbeats renew the backend lease instead of expiring',async()=>{
 const {player,active,calls}=fixture();await player.activity(active,true);await player.activity(active,true);await player.activity(active,true);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.body.playing&&c.body.present&&!c.body.preparing));
 active.props.pause=true;await player.activity(active,true);assert.equal(calls.at(-1).body.playing,false);assert.equal(calls.at(-1).body.present,true);
});
test('paused seek is urgent, completed pause and errors release priority',async()=>{
 const {player,active,calls}=fixture();active.props.pause=true;active.pendingSeek=12;await player.activity(active,true);assert.equal(calls[0].body.preparing,true);assert.equal(calls[0].body.playing,true);
 active.pendingSeek=null;await player.activity(active,true);assert.equal(calls[1].body.preparing,false);assert.equal(calls[1].body.playing,false);
 active.error='real output failure';active.firstFrame=null;await player.activity(active,true);assert.equal(calls[2].body.preparing,false);
});
test('slow activity writes coalesce to final close without a late playing renewal',async()=>{
 const {player,active,calls}=fixture();let release;player.api=async(route,method,body)=>{calls.push({route,method,body});if(calls.length===1)await new Promise(resolve=>release=resolve);};
 const first=player.activity(active,true);await new Promise(resolve=>queueMicrotask(resolve));active.props.pause=true;const paused=player.activity(active,true);active.closing=true;const closing=player.activity(active,false);assert.equal(first,paused);assert.equal(first,closing);release();await closing;
 assert.equal(calls.length,2);assert.equal(calls[0].body.playing,true);assert.deepEqual(calls[1].body,{owner:active.owner,media_id:1,present:false,playing:false,preparing:false});
 await player.activity(active,true);assert.equal(calls.at(-1).body.present,false,'a closing session cannot recreate presence');
});
test('failed writes reject and a later heartbeat can recover',async()=>{
 const {player,active,calls}=fixture();player.api=async()=>{throw new Error('controlled activity failure');};await assert.rejects(player.activity(active,true),/controlled/);player.api=async(route,method,body)=>calls.push({route,method,body});await player.activity(active,true);assert.equal(calls.length,1);
});
