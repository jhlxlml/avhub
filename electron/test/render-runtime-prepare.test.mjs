// Controlled service policy contracts; real hashes are tested separately.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),host=require('../dist/renderHostClient.js'),{RenderPlayer}=require('../dist/renderPlayer.js');
const setup=(t,values)=>{const calls=[],original=host.verifyRenderRuntime;host.verifyRenderRuntime=async()=>{calls.push('verify');};t.after(()=>{host.verifyRenderRuntime=original;});const player=new RenderPlayer({log:line=>calls.push(line)});player.api=async()=>{calls.push('preferences');return {values};};player.runtime=()=>({});return {player,calls};};
test('only an explicitly enabled embedded MPV preference prepares the runtime',async t=>{
 const {player,calls}=setup(t,{playerEngine:'chromium',nativeRenderEnabled:true});await player.prepareRuntime();assert.deepEqual(calls,['preferences']);
 player.api=async()=>({values:{playerEngine:'mpv',nativeRenderEnabled:false}});await player.prepareRuntime();assert.deepEqual(calls,['preferences']);
 player.api=async()=>({values:{playerEngine:'mpv',nativeRenderEnabled:true}});await player.prepareRuntime();assert.equal(calls[1],'verify');assert.match(calls[2],/^render-runtime-prepared /);
});
test('active or opening playback gets no competing background validation',async t=>{
 const {player,calls}=setup(t,{playerEngine:'mpv',nativeRenderEnabled:true});player.active={};await player.prepareRuntime();assert.deepEqual(calls,[]);
 player.active=null;player.opening=Promise.resolve();await player.prepareRuntime();assert.deepEqual(calls,[]);
 player.opening=null;player.api=async()=>{player.active={};return {values:{playerEngine:'mpv',nativeRenderEnabled:true}};};await player.prepareRuntime();assert.deepEqual(calls,[]);
});
test('background verification failure is not reported as prepared',async t=>{
 const {player,calls}=setup(t,{playerEngine:'mpv',nativeRenderEnabled:true});host.verifyRenderRuntime=async()=>{throw new Error('controlled integrity rejection');};await assert.rejects(player.prepareRuntime(),/integrity rejection/);assert.deepEqual(calls,['preferences']);
});
