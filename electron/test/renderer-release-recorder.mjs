// Test-only, one bootstrap debugger pause before measurement; sandbox stays on.
// Hook actual Electron native release callbacks, never synthesize completion.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export async function armRendererReleaseRecorder(desktop,page,preload){
 const cdp=await desktop.context().newCDPSession(page),scripts=[];
 cdp.on('Debugger.scriptParsed',script=>scripts.push(script));await cdp.send('Debugger.enable');
 const script=scripts.find(s=>s.url.replaceAll('\\','/').endsWith('/electron/dist/preload.js'));assert.ok(script,'Actual source preload script required');
 const line=readFileSync(preload,'utf8').split('\n').findIndex(line=>line.includes('let frame;'));assert.ok(line>=0);
 const {breakpointId}=await cdp.send('Debugger.setBreakpoint',{location:{scriptId:script.scriptId,lineNumber:line}});
 let contextId,resolveInstalled,rejectInstalled;const installed=new Promise((resolve,reject)=>{resolveInstalled=resolve;rejectInstalled=reject;});
 const contexts=[];cdp.on('Runtime.executionContextCreated',({context})=>contexts.push(context));await cdp.send('Runtime.enable');contextId=contexts.find(c=>c.name==='Electron Isolated Context')?.id;assert.ok(contextId);
 cdp.once('Debugger.paused',async({callFrames})=>{
  try{
   const result=await cdp.send('Debugger.evaluateOnCallFrame',{callFrameId:callFrames[0].callFrameId,expression:`(${install.toString()})(electron_1.sharedTexture.subtle)`,returnByValue:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));assert.equal(result.result.value,true);
   await cdp.send('Debugger.removeBreakpoint',{breakpointId});await cdp.send('Debugger.resume');await cdp.send('Debugger.disable');resolveInstalled();
  }catch(error){await cdp.send('Debugger.resume').catch(()=>{});rejectInstalled(error);}
 });
 return {installed,stop:async()=>{await installed;const result=await cdp.send('Runtime.evaluate',{contextId,expression:'globalThis.__rendererReleaseRecorder.stop()',returnByValue:true});assert.equal(result.exceptionDetails,undefined);return result.result.value;}};
}
function install(native){
 const capacity=4096,ring=new Array(capacity),worst={},delays=[],frames=new WeakMap();let written=0,stopped=false,currentId;
 const record=entry=>{if(stopped)return;ring[written++%capacity]=entry;if(!worst[entry.kind]||entry.ms>worst[entry.kind].ms)worst[entry.kind]=entry;
  if(entry.kind==='renderer-native-release-done'&&entry.ms>80){const capture={...entry,entries:Array.from({length:Math.min(written,128)},(_,i)=>ring[(written-Math.min(written,128)+i)%capacity])};if(delays.length<4)delays.push(capture);else{const smallest=delays.reduce((a,c,i)=>c.ms<delays[a].ms?i:a,0);if(entry.ms>delays[smallest].ms)delays[smallest]=capture;}}
 };
 const finish=native.finishTransferSharedTexture;
 native.finishTransferSharedTexture=function(transfer){const at=performance.now(),imported=finish.call(this,transfer),id=transfer.id;currentId=id;record({kind:'renderer-import',at,ms:performance.now()-at,textureId:id});
  const release=imported.release,getFrame=imported.getVideoFrame;
  imported.getVideoFrame=function(){const frame=getFrame.call(this);frames.set(frame,id);return frame;};
  imported.release=function(callback){const at=performance.now();record({kind:'renderer-native-release-start',at,ms:0,textureId:id});return release.call(this,()=>{record({kind:'renderer-native-release-done',at,ms:performance.now()-at,textureId:id});callback?.();});};return imported;
 };
 const close=VideoFrame.prototype.close;VideoFrame.prototype.close=function(){const at=performance.now(),result=close.call(this);record({kind:'renderer-frame-close',at,ms:performance.now()-at,textureId:frames.get(this)});return result;};
 const done=GPUQueue.prototype.onSubmittedWorkDone;GPUQueue.prototype.onSubmittedWorkDone=function(){const at=performance.now(),id=currentId;return done.call(this).then(value=>{record({kind:'renderer-gpu-done',at,ms:performance.now()-at,textureId:id});return value;});};
 let previous=performance.now();const interval=setInterval(()=>{const now=performance.now();if(now-previous>70)record({kind:'renderer-loop-late',at:previous+50,ms:now-previous-50});previous=now;},50);
 globalThis.__rendererReleaseRecorder={stop:()=>{clearInterval(interval);stopped=true;return {scope:'Bounded actual renderer release callbacks; bootstrap frame excluded; GPU completion is not scanout',timeOrigin:performance.timeOrigin,written,capacity,worst,delays,tail:Array.from({length:Math.min(written,capacity)},(_,i)=>ring[(written-Math.min(written,capacity)+i)%capacity])};}};return true;
}
