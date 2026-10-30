// Debug only the owned test renderer. Destroy its actual existing WebGPU device,
// not the system GPU, another app, or a newly-created unrelated device.
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
export async function deviceLossAcceptance(desktop,controls){
 try{
 await desktop.evaluate(async()=>{
  const s=globalThis.__renderSpike,d=s.controls.webContents.debugger,contexts=[];
  if(d.isAttached())throw new Error('An existing debugger session must not be replaced');
  d.attach('1.3');const state=globalThis.__renderSpikeDeviceLoss={injected:false,errors:[]};
  const listener=async(_,method,p)=>{
   if(method==='Debugger.scriptParsed'&&/preload\.cjs$/.test(p.url))contexts.push(p);
   if(method==='Debugger.paused'){
    try{const frame=p.callFrames.find(f=>f.functionName==='renderFloat16');if(!frame)throw new Error('Unexpected breakpoint scope');
     const result=await d.sendCommand('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'g.device.destroy(); true',returnByValue:true});
     if(result.exceptionDetails||result.result.value!==true)throw new Error('Owned WebGPU device destroy did not execute');state.injected=true;if(state.breakpointId)await d.sendCommand('Debugger.removeBreakpoint',{breakpointId:state.breakpointId});
    }catch(error){state.errors.push(String(error));}finally{await d.sendCommand('Debugger.resume').catch(()=>{});}
   }
  };
  d.on('message',listener);state.cleanup=()=>{d.removeListener('message',listener);if(d.isAttached())d.detach();};
  await d.sendCommand('Debugger.enable');
  const script=contexts.at(-1);if(!script)throw new Error('Owned preload script unavailable');
  const {scriptSource}=await d.sendCommand('Debugger.getScriptSource',{scriptId:script.scriptId});
  const line=scriptSource.split('\n').findIndex(v=>v.includes('const texture=g.context.getCurrentTexture()'));if(line<0)throw new Error('F16 draw boundary unavailable');
  const breakpoint=await d.sendCommand('Debugger.setBreakpoint',{location:{scriptId:script.scriptId,lineNumber:line,columnNumber:0}});state.breakpointId=breakpoint.breakpointId;
  await s.command('redraw');
 });
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpikeDeviceLoss.injected),{timeout:10000}).toBe(true);
  assert.deepEqual(await desktop.evaluate(()=>globalThis.__renderSpikeDeviceLoss.errors),[]);
  await expect(controls.getByRole('alert')).toContainText(/WebGPU|device/i);
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__renderSpike.hostExited())).toBe(true);
  await expect.poll(()=>desktop.evaluate(()=>{const s=globalThis.__renderSpike.transferStats;return s.imports-s.released;})).toBe(0);
  assert.equal(await desktop.evaluate(()=>globalThis.__renderSpike.main.isDestroyed()),false);
  await controls.getByRole('button',{name:'设置',exact:true}).click();await expect(controls.getByRole('menu')).toBeVisible();
  return {passed:true,scope:'Destroyed the actual owned F16 WebGPU device via its draw stack; not a physical GPU reset test',transfers:await desktop.evaluate(()=>({...globalThis.__renderSpike.transferStats}))};
 }finally{await desktop.evaluate(()=>globalThis.__renderSpikeDeviceLoss?.cleanup()).catch(()=>{});}
}
