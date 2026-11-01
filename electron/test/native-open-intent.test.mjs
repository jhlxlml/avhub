// Native IPC argument/dispatch contracts only. No process or trust certification.
import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Module=require('node:module'),load=Module._load,main={};
let NativePlayer;
try{Module._load=function(id,...args){return id==='electron'?{BrowserWindow:{fromWebContents:()=>main},app:{isPackaged:false}}:load.call(this,id,...args);};({NativePlayer}=require('../dist/nativePlayer.js'));}finally{Module._load=load;}
const {IndependentPlayer}=require('../dist/independentPlayer.js');
test('validated paused intent reaches both ordinary native presentations; omitted remains autoplay',async()=>{
 const player=new NativePlayer({main:()=>main,log:()=>{}});player.trusted=()=>{};player.status=async()=>({available:true});let mode='independent';player.api=async()=>({values:{mpvWindowMode:mode}});player.independent.prepareOpen=async()=>{};
 player.independent.open=async(...args)=>args;player.open=async(...args)=>args;
 assert.deepEqual(await player.handleInvoke({sender:{}},'open',{mediaId:1,start:4.16,paused:true}),[1,4.16,true]);
 assert.deepEqual(await player.handleInvoke({sender:{}},'open',{mediaId:1,start:4.16}),[1,4.16,false]);
 mode='embedded';assert.deepEqual(await player.handleInvoke({sender:{}},'open',{mediaId:1,start:4.16,paused:true}),[1,4.16,undefined,true]);
 for(const paused of ['true',1,null,{},[]])await assert.rejects(()=>player.handleInvoke({sender:{}},'open',{mediaId:1,start:0,paused}),/参数无效/);
});
test('independent programmatic seek is exact-session bounded and excluded during capture/stop',async()=>{
 const calls=[],player=new IndependentPlayer({log:()=>{}}),session={client:{session:'owned',seek:value=>calls.push(value)},closing:false,stopped:false};player.active=session;
 await player.invoke('seek',{session:'owned',value:12});assert.deepEqual(calls,[12]);
 for(const value of [-1,Infinity,NaN,1e9,'12',null])await assert.rejects(()=>player.invoke('seek',{session:'owned',value}),/参数无效/);
 await assert.rejects(()=>player.invoke('seek',{session:'old',value:12}),/会话已过期/);
 session.capture=Promise.resolve();await assert.rejects(()=>player.invoke('seek',{session:'owned',value:12}),/截图/);session.capture=null;session.stopped=true;await assert.rejects(()=>player.invoke('seek',{session:'owned',value:12}),/参数无效/);assert.deepEqual(calls,[12]);
});
