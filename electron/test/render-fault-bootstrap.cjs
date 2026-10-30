// Test-only preload for the owned Electron main process, never packaged.
exports.install=function(){
 if(process.type!=='browser')throw new Error('Fault hook is main-process-only');
 const path=require('node:path'),cp=require('node:child_process'),root=path.resolve(__dirname,'../..');
 const ownData=path.resolve(process.env.AVHUB_DATA_DIR||'');if(!ownData.startsWith(path.join(root,'build/render-app-faults-')))throw new Error('Fault hook requires its owned data directory');
 const {renderRuntimeLayout}=require('../dist/renderRuntimeLayout.js');
 const host=renderRuntimeLayout(root,false,process.resourcesPath,process.env.AVHUB_RENDER_RUNTIME_CANDIDATE).host.toLowerCase(),original=cp.spawn;
 cp.spawn=function(file,args,options){if(path.resolve(String(file)).toLowerCase()!==host)return original.call(this,file,args,options);const mode=globalThis.__avhubRenderFaultMode,target=mode==='spawn-fail'?path.join(ownData,'intentionally-missing-helper.exe'):file;const actualArgs=mode==='dll-missing'?[path.join(ownData,'intentionally-missing-libmpv.dll')]:args;const child=original.call(this,target,actualArgs,options);globalThis.__avhubRenderFaultChild=child;return child;};
};

// DevTools pauses the *existing preload render callback* and destroys exactly
// its current WebGPU device. No production debug IPC or synthetic lost event.
exports.loseDevice=async function(){
 const {BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
 const root=path.resolve(__dirname,'../..'),data=path.resolve(process.env.AVHUB_DATA_DIR||'');if(!data.startsWith(path.join(root,'build/render-app-faults-')))throw new Error('Owned fault profile required');
 const web=BrowserWindow.getAllWindows()[0].webContents,d=web.debugger;if(d.isAttached())throw new Error('Existing debugger must not be replaced');
 const scripts=[],line=fs.readFileSync(path.join(root,'electron/dist/preload.js'),'utf8').split('\n').findIndex(s=>s.includes("g.device.pushErrorScope('validation')"));if(line<0)throw new Error('Current render callback not found');
 d.attach('1.3');let timer,breakpoint;const listener=(_,method,p)=>{if(method==='Debugger.scriptParsed'&&/[/\\]preload\.js$/.test(p.url))scripts.push(p);};d.on('message',listener);
 try{await d.sendCommand('Debugger.enable');const script=scripts.find(s=>s.url.includes('electron'));if(!script)throw new Error('Owned preload script unavailable');
  const done=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Real device-loss breakpoint timeout')),10000);const paused=async(_,method,p)=>{if(method!=='Debugger.paused')return;d.removeListener('message',paused);try{const frame=p.callFrames.find(f=>f.location.scriptId===script.scriptId);if(!frame)throw new Error('Unexpected device-loss scope');const r=await d.sendCommand('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'g.device.destroy(); true',returnByValue:true});if(r.exceptionDetails||r.result?.value!==true)throw new Error('Existing GPU device not destroyed');resolve(true);}catch(e){reject(e);}finally{await d.sendCommand('Debugger.resume').catch(()=>{});}};d.on('message',paused);});
  breakpoint=(await d.sendCommand('Debugger.setBreakpoint',{location:{scriptId:script.scriptId,lineNumber:line}})).breakpointId;return await done;
 }finally{clearTimeout(timer);if(breakpoint)await d.sendCommand('Debugger.removeBreakpoint',{breakpointId:breakpoint}).catch(()=>{});d.removeListener('message',listener);d.detach();}
};
