// Controlled service failures, not decoder/GPU performance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {RenderPlayer}=createRequire(import.meta.url)('../dist/renderPlayer.js');
const check=async({frame,present,deadline=Infinity,firstFrame=1})=>{
 const logs=[],main={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false};
 const player=new RenderPlayer({main:()=>main,log:message=>logs.push(message)});
 const active={generation:1,closing:false,error:'',intent:true,props:{pause:false},firstFrame,firstFrameDeadline:deadline,pendingSeek:null,lastFrame:0,bridge:{setClockActive:()=>{},present},client:{frame,control:async()=>{},snapshot:async()=>({properties:{pause:true},error:null})}};
 player.active=active;player.publish=()=>{};player.pump(active);await active.poll;
 return {active,logs,failure:JSON.parse(logs.find(line=>line.startsWith('render-output-failure ')).slice('render-output-failure '.length))};
};
test('first decoded-frame timeout retains the actionable deadline diagnosis',async()=>{
 const result=await check({firstFrame:null,deadline:0,frame:async()=>({waiting:false,error:null})});
 assert.equal(result.failure.stage,'first-frame');assert.equal(result.failure.kind,'first-frame-timeout');assert.match(result.active.error,/30 秒内呈现首帧/);
});
test('GPU presentation failures are distinguished without leaking raw error paths',async()=>{
 const result=await check({frame:async()=>({waiting:true,serial:1,error:null}),present:async()=>{throw Error('private C:\\media\\secret.mp4');}});
 assert.equal(result.failure.stage,'gpu');assert.equal(result.failure.kind,'gpu-presentation');assert.match(result.active.error,/GPU 提交或释放失败/);assert.ok(!result.logs.join('').includes('secret'));
});
test('native read timeout and decoder error retain their different diagnostics',async()=>{
 const timeout=await check({frame:async()=>{throw Error('原生控制超时：frame');}});assert.equal(timeout.failure.kind,'command-timeout');assert.match(timeout.active.error,/控制响应超时/);
 const decoder=await check({frame:async()=>({waiting:false,error:'NATIVE_DECODE_-12'})});assert.equal(decoder.failure.nativeCode,'NATIVE_DECODE_-12');assert.match(decoder.active.error,/解码或画面读取失败/);
});

test('missing texture release remains actionable after GPU completion',async()=>{
 const result=await check({frame:async()=>({waiting:true,serial:1,error:null}),present:async()=>{throw Error('原生画面纹理引用释放超时');}});
 assert.equal(result.failure.stage,'gpu');assert.equal(result.failure.kind,'texture-release-timeout');assert.match(result.active.error,/纹理引用释放超时/);
});
