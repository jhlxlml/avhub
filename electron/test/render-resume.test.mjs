// Command/state ordering contracts with fake native resources. Actual Electron
// frame/clock/cleanup acceptance is separate; no trust/hardware claim here.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Module=require('node:module'),load=Module._load;
let RenderPlayer;
try{Module._load=function(id,...args){return id==='electron'?{app:{isPackaged:false},BrowserWindow:{},dialog:{}}:load.call(this,id,...args);};({RenderPlayer}=require('../dist/renderPlayer.js'));}finally{Module._load=load;}

test('resume owns its clock before native play and publishes freshly read pause state',async()=>{
 const calls=[],main={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false},player=new RenderPlayer({main:()=>main});
 player.trusted=()=>main;player.publish=a=>calls.push('publish:'+a.props.pause);
 player.active={session:'s',generation:1,error:'',closing:false,firstFrame:1,pendingSeek:null,props:{pause:true},bridge:{setClockActive:value=>calls.push('clock:'+value)},client:{control:async action=>calls.push('command:'+action),snapshot:async()=>{calls.push('snapshot');return {properties:{pause:false}};}}};
 await player.invoke({},'command',{session:'s',generation:1,action:'play'});
 assert.deepEqual(calls,['clock:true','command:play','snapshot','clock:true','publish:false']);
});

test('pause releases clock and reports the actual paused state without waiting for polling',async()=>{
 const calls=[],main={},player=new RenderPlayer({main:()=>main});player.trusted=()=>main;player.publish=a=>calls.push('publish:'+a.props.pause);
 player.active={session:'s',generation:1,error:'',closing:false,firstFrame:1,pendingSeek:null,props:{pause:false},bridge:{setClockActive:value=>calls.push('clock:'+value)},client:{control:async action=>calls.push('command:'+action),snapshot:async()=>{calls.push('snapshot');return {properties:{pause:true}};}}};
 await player.invoke({},'command',{session:'s',generation:1,action:'pause'});
 assert.deepEqual(calls,['clock:false','command:pause','snapshot','publish:true']);assert.equal(player.active.intent,false);
});

test('play before a usable first frame or while seeking remains intent only',async()=>{
 for(const state of [{firstFrame:null,pendingSeek:null},{firstFrame:1,pendingSeek:4}]){
  const calls=[],main={},player=new RenderPlayer({main:()=>main});player.trusted=()=>main;player.publish=()=>calls.push('intent');
  player.active={...state,session:'s',generation:1,error:'',closing:false,props:{pause:true},bridge:{setClockActive:()=>calls.push('clock')},client:{control:async()=>calls.push('command'),snapshot:async()=>calls.push('snapshot')}};
  await player.invoke({},'command',{session:'s',generation:1,action:'play'});assert.deepEqual(calls,['intent']);assert.equal(player.active.intent,true);
 }
});

test('a stale paused pump cannot leave a successful resume published with an inactive clock',async()=>{
 let clock=false;const main={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false},player=new RenderPlayer({main:()=>main});player.trusted=()=>main;
 const bridge={setClockActive:value=>{clock=value;}};let published;
 player.publish=a=>{published={pause:a.props.pause,clock};};
 player.active={session:'s',generation:1,error:'',closing:false,firstFrame:1,pendingSeek:null,props:{pause:true},bridge,client:{control:async()=>{},snapshot:async()=>{bridge.setClockActive(false);return {properties:{pause:false}};}}};
 await player.invoke({},'command',{session:'s',generation:1,action:'play'});assert.deepEqual(published,{pause:false,clock:true});
});
