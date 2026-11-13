// Deterministic main-process interaction regression. No GPU or decoding claim.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Module=require('node:module'),load=Module._load;
let frameSaved,finishSave,failCapture;
const capture=async(_deps,_active,saved)=>{
 await new Promise((resolve,reject)=>{frameSaved=()=>{saved();resolve();};failCapture=reject;});
 await new Promise(resolve=>{finishSave=resolve;});
 return {filename:'owned-fixture.png'};
};
let RenderPlayer;
try{
 Module._load=function(id,...rest){
  if(id==='electron')return {app:{isPackaged:false}};
  if(id==='./nativeCapture')return {captureNativeFrame:capture};
  return load.call(this,id,...rest);
 };
 ({RenderPlayer}=require('../dist/renderPlayer.js'));
}finally{Module._load=load;}
const player=new RenderPlayer({windowState:()=>({})}),commands=[];
player.trusted=()=>({});player.publish=()=>{};
const state={session:'fixture',surface:'surface',generation:1,closing:false,error:'',props:{pause:false,'track-list':[{type:'video',id:1,selected:true,codec:'hevc'}]},presented:{serial:1,positionSec:4,seekId:0},pendingSeek:null,title:'Fixture',revision:0,firstFrame:25,lastSeek:185,seekDiagnostics:{confirmationMs:120},rotation:0,transform:{zoom:0,x:0,y:0},prefs:{},intent:true,client:{control:async action=>{commands.push(action);},snapshot:async()=>({properties:{pause:true}})}};
player.active=state;
const input={session:'fixture',generation:1};
const screenshot=player.invoke({},'screenshot',input);
const pause=player.invoke({},'command',{...input,action:'pause'});
await Promise.resolve();assert.deepEqual(commands,[],'transport waits for the protected frame read');
frameSaved();await pause;
assert.deepEqual(commands,['pause'],'pause completes before PNG publishing finishes');
assert.ok(state.capture,'duplicate screenshot remains blocked until the file is saved');
await assert.rejects(player.invoke({},'screenshot',input),/正在截图/);
finishSave();assert.equal((await screenshot).filename,'owned-fixture.png');
assert.equal(state.capture,undefined);

// Failure must unlock queued controls instead of leaving them pending forever.
const failed=player.invoke({},'screenshot',input);
const checked=assert.rejects(failed,/capture failed/);
const mute=player.invoke({},'command',{...input,action:'mute',value:true});
failCapture(new Error('capture failed'));await checked;await mute;
assert.equal(commands.at(-1),'mute');

state.props={'track-list':[{type:'video',id:8,selected:false,codec:'mjpeg',albumart:true},{type:'video',id:1,selected:true,codec:'hevc'}]};
const snapshot=await player.invoke({},'snapshot',input);
assert.equal(snapshot.properties['video-codec'],'hevc','report the selected video track, never cover art');
assert.equal(snapshot.lastSeekMs,120,'command-to-confirmation time is distinct from queued total');
assert.equal(snapshot.lastSeekTotalMs,185);
assert.equal(snapshot.bufferingEvents,undefined,'never invent cache measurements');
console.log('PASS: frame-read lock, transport during save, failed capture unlock, selected codec and honest seek diagnostics.');
