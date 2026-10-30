// Isolated M2 process bridge. No production preload, server, arbitrary command or URL.
const {app,BaseWindow,BrowserWindow,ipcMain,Menu,sharedTexture}=require('electron');
const {spawn,spawnSync}=require('node:child_process');
const {readFileSync,writeFileSync,mkdtempSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {createInterface}=require('node:readline');
const path=require('node:path');
const {createCommandBridge}=require(require('electron').app.isPackaged?path.join(process.resourcesPath,'spike/command-bridge.cjs'):'./command-bridge.cjs');
const root=app.isPackaged?path.join(process.resourcesPath,'spike'):path.resolve(__dirname,'../../..'),folder=app.isPackaged?root:path.join(root,'build/libmpv-render-spike');
const logFolder=mkdtempSync(path.join(folder,'run-logs-'));
if(process.env.AVHUB_RENDER_DWM_DIAGNOSTIC==='1')app.commandLine.appendSwitch('disable-direct-composition');
const backend=app.isPackaged?(JSON.parse(readFileSync(path.join(folder,'source-options.json'))).backend||'opengl'):(process.env.AVHUB_RENDER_BACKEND||'opengl');
if(!['opengl','d3d11'].includes(backend))throw new Error('Unverified render API');
const manifest=JSON.parse(readFileSync(path.join(root,app.isPackaged||backend==='opengl'?'ci/libmpv-render-candidate.json':'ci/libmpv-d3d11-candidate.json')));
const dll=app.isPackaged||backend==='opengl'?path.join(folder,'runtime/libmpv-2.dll'):path.join(root,'build/libmpv-d3d11-input/runtime/libmpv-2.dll');
const hostDll=process.env.AVHUB_RENDER_INJECT_START_FAILURE==='1'?dll+'.missing':dll;
if(createHash('sha256').update(readFileSync(dll)).digest('hex')!==manifest.dllSha256)throw new Error('DLL integrity');
const sharedMode=app.isPackaged||process.env.AVHUB_RENDER_SHARED_TEXTURE==='1';
const {sourceContract,mergeProbe,generatedSampleNames}=require(app.isPackaged?path.join(folder,'source-contract.cjs'):'./source-contract.cjs');
const sampleName=process.env.AVHUB_RENDER_SAMPLE||'Framecode-v2-640x360.mp4';
if(!generatedSampleNames.includes(sampleName))throw new Error('Only allowlisted generated media may enter this PoC');
const sample=app.isPackaged?path.join(folder,'Direct.mp4'):path.join(folder,'samples',sampleName);
let stream;
if(app.isPackaged){stream=JSON.parse(readFileSync(path.join(folder,'sample.json')));if(createHash('sha256').update(readFileSync(sample)).digest('hex')!==stream.sha256)throw new Error('Packaged fixture identity changed');}
else{const probe=spawnSync(path.join(root,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-read_intervals','%+#1','-show_format','-show_streams','-show_frames','-of','json',sample],{encoding:'utf8',windowsHide:true,timeout:15000});if(probe.status!==0)throw new Error('Cannot verify generated source');stream=mergeProbe(JSON.parse(probe.stdout));}
const sourceOptions=app.isPackaged?JSON.parse(readFileSync(path.join(folder,'source-options.json'))):{floatingPoint:process.env.AVHUB_RENDER_FP16==='1',diagnosticSdr10:process.env.AVHUB_RENDER_SDR10==='1'};
const hdrDiagnostic=process.env.AVHUB_RENDER_HDR_PIXEL_PROBE==='1';
if(hdrDiagnostic&&process.env.AVHUB_RENDER_HDR_RAW_CARRIER==='1'&&process.env.AVHUB_RENDER_HDR_LINEAR_PROBE==='1')throw new Error('Conflicting HDR diagnostic modes');
if(hdrDiagnostic&&(app.isPackaged||!sourceOptions.floatingPoint))throw new Error('HDR probe is development-only and requires F16');
const contract=hdrDiagnostic?require('./hdr-math.cjs').hdrProbeContract(stream,sampleName,process.env.AVHUB_RENDER_HDR_RAW_CARRIER==='1'?'raw-pq':process.env.AVHUB_RENDER_HDR_LINEAR_PROBE==='1'?'scrgb':'pq'):sourceContract(stream,sourceOptions);
const overlayTest=process.env.AVHUB_RENDER_OVERLAY_TEST==='1';
if(overlayTest&&hdrDiagnostic)throw new Error('SDR overlay probe cannot authorize HDR presentation');
const overlayFile=overlayTest?path.join(logFolder,'Overlay.ass'):'';
if(overlayTest)writeFileSync(overlayFile,require(app.isPackaged?path.join(folder,'overlay-fixture.cjs'):'./overlay-fixture.cjs'),{encoding:'utf8',flag:'wx'});
const {createHandleOwner,win32Api}=require(app.isPackaged?path.join(folder,'win32-handle-owner.cjs'):'./win32-handle-owner.cjs');
const ffi=sharedMode?require(app.isPackaged?path.join(folder,'render-ffi.cjs'):'./render-ffi.cjs').loadVerifiedFfi(path.join(folder,'ffi'),path.join(root,'ci/render-ffi/runtime-manifest.json')):null;
let main,controls,child,bridge,handleOwner,closing=false,hostExited=false,nativeExitCode=null,pollTimer,nativeFailure,admissionClosed=false,quiescing;const transfers=new Set();
const readbackMode=process.env.AVHUB_RENDER_READBACK_MODE||'on-demand';if(!['on-demand','always'].includes(readbackMode))throw new Error('Invalid readback mode');
let probeSequence=0,probePending;
const transferStats={imports:0,released:0,maxInFlight:0,importFailures:0};
function command(action,extra={}){if(nativeFailure)return Promise.reject(nativeFailure);if(!bridge||hostExited)return Promise.reject(new Error('Native command pipe unavailable'));return bridge.command(action,extra);}
function quiesce(){if(probePending){clearTimeout(probePending.timer);probePending.reject(new Error('Probe cancelled by shutdown'));probePending=null;}if(quiescing)return quiescing;admissionClosed=true;clearTimeout(pollTimer);quiescing=(async()=>{let timer;try{await Promise.race([Promise.all([...transfers]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('GPU references not released')),5000);})]);handleOwner?.close();writeFileSync(path.join(logFolder,'handle-cleanup.json'),JSON.stringify(handleOwner?.stats()??null));return {...transferStats};}finally{clearTimeout(timer);}})();return quiescing;}
function probeFrame(){if(contract.output.pixelFormat!=='rgbaf16'||hdrDiagnostic)return Promise.reject(new Error('This probe requires the SDR F16 presenter'));if(closing||admissionClosed||nativeFailure)return Promise.reject(new Error('Probe unavailable'));if(probePending)return probePending.promise;let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;}),id=++probeSequence;const timer=setTimeout(()=>{if(probePending?.id===id){probePending=null;reject(new Error('Pixel probe timeout'));}},5000);probePending={id,promise,resolve,reject,timer};controls.webContents.send('render-spike-probe',id);return promise;}
app.whenReady().then(async()=>{
 Menu.setApplicationMenu(null);
 app.setPath('userData',path.join(folder,'electron-user-data'));
 const preferences={preload:app.isPackaged?path.join(folder,'preload.cjs'):path.join(__dirname,'preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,additionalArguments:sharedMode?['--render-shared-texture']:[]};
 main=sharedMode?new BrowserWindow({width:1000,height:700,frame:false,backgroundColor:'#000',title:'AVHub Render API spike',webPreferences:preferences}):new BaseWindow({width:1000,height:700,frame:false,backgroundColor:'#000',title:'AVHub Render API spike'});
 const handle=main.getNativeWindowHandle(),parent=(handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();
 child=spawn(path.join(folder,'RenderHost.exe'),[hostDll,sample,process.env.AVHUB_RENDER_STANDALONE_DIAGNOSTIC==='1'?'0':parent,...(sharedMode?[backend==='d3d11'?'shared-d3d11':'shared',String(contract.width),String(contract.height),...(contract.output.pixelFormat==='rgbaf16'?['rgba16f']:[])]:[])],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,AVHUB_RENDER_OVERLAY_FILE:overlayFile}});
 if(sharedMode)handleOwner=createHandleOwner({pid:child.pid,api:win32Api(ffi),inFlight:()=>transfers.size});
 bridge=createCommandBridge({stream:child.stdin,onFailure:error=>{if(!closing)fail(error);}});
 let stderr='';child.stderr.on('data',d=>{stderr+=String(d);writeFileSync(path.join(logFolder,'host-stderr.log'),stderr);});
 createInterface({input:child.stdout}).on('line',line=>{try{bridge.accept(JSON.parse(line));}catch{}});
 child.on('error',error=>fail(error));child.on('exit',(code)=>{hostExited=true;nativeExitCode=code;globalThis.__renderSpikeExit=code;bridge.fail(new Error('Host exited '+code));if(!closing)fail(new Error('Host exited '+code));});
 controls=sharedMode?main:new BrowserWindow({parent:main,...main.getContentBounds(),frame:false,transparent:true,backgroundColor:'#00000000',skipTaskbar:true,resizable:false,hasShadow:false,webPreferences:preferences});
 ipcMain.on('render-spike-probe-ready',(event,id)=>{if(event.sender===controls.webContents&&probePending?.id===id)command('redraw').catch(error=>{if(probePending?.id===id){clearTimeout(probePending.timer);probePending.reject(error);probePending=null;}});});
 ipcMain.on('render-spike-probe-done',(event,id,result)=>{if(event.sender===controls.webContents&&probePending?.id===id){clearTimeout(probePending.timer);probePending.resolve(result);probePending=null;}});
 ipcMain.on('render-spike-render-error',(event,message)=>{if(event.sender===controls.webContents&&typeof message==='string')fail(new Error(message.slice(0,400)));});
 let syncing=Promise.resolve();
 // Native child dimensions are physical pixels, unlike Electron DIP bounds.
 function physicalLayout(){if(sharedMode)return;const {screen}=require('electron');const bounds=main.getContentBounds(),scale=screen.getDisplayMatching(bounds).scaleFactor;controls.setBounds(bounds);syncing=syncing.catch(()=>{}).then(()=>command('resize',{width:Math.round(bounds.width*scale),height:Math.round(bounds.height*scale)}));}
 main.on('resize',physicalLayout);main.on('move',physicalLayout);main.on('enter-full-screen',physicalLayout);main.on('leave-full-screen',physicalLayout);main.on('minimize',()=>controls.hide());main.on('restore',()=>{controls.showInactive();physicalLayout();});
 ipcMain.handle('render-spike',async(event,action,value)=>{
  if(event.sender!==controls.webContents)throw new Error('Untrusted sender');
  if(action==='fullscreen'){main.setFullScreen(!main.isFullScreen());return {ok:true};}
  if(action==='source')return contract;
  if(overlayTest&&['subtitle-probe','osd-probe'].includes(action)&&typeof value==='boolean')return command(action,{value});
  if(action==='snapshot'){const state=await command('snapshot');if(state.shared){const {handle,...safe}=state.shared;state.shared=safe;}return state;}
  if(action==='pause'&&typeof value==='boolean')return command(action,{value});
  if(action==='seek'&&Number.isFinite(value)&&value>=0&&value<=(contract.durationSec??86400))return command(action,{value});
  throw new Error('Unsupported command');
 });
 await controls.loadFile(path.join(folder,'ui/index.html'));if(nativeFailure)controls.webContents.send('render-spike-error','原生渲染宿主异常：'+String(nativeFailure.message).slice(0,400));
 globalThis.__renderSpike={command,quiesce,probeFrame,injectPipeFailure:()=>{child.stdin.destroy(new Error('Injected native command pipe failure'));return true;},main,controls,pid:child.pid,transferStats,handleStats:()=>handleOwner?.stats()??null,hostExited:()=>hostExited,runtime:{folder,logFolder,readbackMode,backend,dll,sample,contract,packaged:app.isPackaged,dllSha256:manifest.dllSha256}};physicalLayout();controls.show();main.focus();
 let lastFrame=0;
 async function pump(){
  if(closing||admissionClosed)return;
  try{const state=await command('snapshot'),s=state.shared;if((process.env.AVHUB_RENDER_TEST_CLOSE_BOUNDARY==='1'||process.env.AVHUB_RENDER_TEST_FAILURE_BOUNDARY==='1')&&globalThis.__holdNextSharedFrame&&s?.waiting&&s.frame>lastFrame){globalThis.__holdNextSharedFrame=false;globalThis.__heldSharedFrame=s.frame;globalThis.__heldLastImportedFrame=lastFrame;await new Promise(resolve=>{globalThis.__releaseHeldSnapshot=resolve;});globalThis.__releasedHeldSnapshot=true;}if(closing||admissionClosed)return;if(state.renderError)throw new Error('Native render failure: '+state.renderError);if(state.width&&state.height&&(Number(state.width)!==contract.width||Number(state.height)!==contract.height))throw new Error('Decoded dimensions changed; stop instead of resizing original content');if(s?.waiting&&s.frame>lastFrame){if(s.width!==contract.width||s.height!==contract.height)throw new Error('Texture dimensions differ from source');if(s.pixelFormat!==contract.output.pixelFormat||s.redBits!==(s.pixelFormat==='rgbaf16'?16:8))throw new Error('Native framebuffer precision differs from source contract');if(s.handleOwner!=='native-source')throw new Error('Unverified shared handle owner');lastFrame=s.frame;const handle=handleOwner.acquire(s.handle);let release;const done=new Promise(r=>release=r);transfers.add(done);
   let texture;try{if(globalThis.__injectImportFailure){globalThis.__injectImportFailure=false;throw new Error('Injected shared texture import failure');}texture=sharedTexture.importSharedTexture({textureInfo:{...contract.output,codedSize:{width:s.width,height:s.height},handle:{ntHandle:handle},timestamp:Math.round(Number(state.time||0)*1e6)},allReferencesReleased:()=>{transferStats.released++;transfers.delete(done);command('ack',{value:s.frame}).catch(()=>{});release();}});transferStats.imports++;transferStats.maxInFlight=Math.max(transferStats.maxInFlight,transfers.size);}catch(error){transferStats.importFailures++;transfers.delete(done);release();throw error;}
   try{await sharedTexture.sendSharedTexture({frame:controls.webContents.mainFrame,importedSharedTexture:texture},{nativeFrame:s.frame,width:s.width,height:s.height,floatingPoint:s.pixelFormat==='rgbaf16',readbackMode,hdrDiagnostic,hdrRawCarrier:process.env.AVHUB_RENDER_HDR_RAW_CARRIER==='1'});}finally{texture.release();}
  }}catch(error){if(!closing&&!admissionClosed)fail(error);return;}pollTimer=setTimeout(pump,5);
 }
 if(sharedMode)void pump();
 main.on('close',event=>{
  // Repeated X/Alt-F4 must not bypass GPU drain while the first close awaits.
  event.preventDefault();if(closing)return;closing=true;
  const started=Date.now();let finished=false,forcedTermination=false;
  quiesce().then(()=>command('quit')).catch(error=>writeFileSync(path.join(logFolder,'shutdown-error.log'),String(error))).finally(()=>{
   const finish=()=>{
    if(finished)return;finished=true;bridge?.dispose();
    writeFileSync(path.join(logFolder,'shutdown-evidence.json'),JSON.stringify({transferStats,handleOwner:handleOwner?.stats()??null,admissionClosed,hostExited,nativeExitCode,forcedTermination,elapsedMs:Date.now()-started,heldSharedFrame:globalThis.__heldSharedFrame??null,lastImportedFrameAtHold:globalThis.__heldLastImportedFrame??null}));
    if(!controls.isDestroyed())controls.destroy();if(!main.isDestroyed())main.destroy();app.quit();
   };
   if(hostExited){finish();return;}
   const timer=setTimeout(()=>{forcedTermination=true;if(!hostExited)child.kill();finish();},2000);
   child.once('exit',()=>{clearTimeout(timer);finish();});
  });
 });
});
function fail(error){if(nativeFailure)return;nativeFailure=error;admissionClosed=true;if(probePending){clearTimeout(probePending.timer);probePending.reject(error);probePending=null;}writeFileSync(path.join(logFolder,'main-error.log'),String(error.stack||error));clearTimeout(pollTimer);if(child&&!hostExited)child.kill();void quiesce().catch(cleanupError=>writeFileSync(path.join(logFolder,'handle-cleanup-error.log'),String(cleanupError))); if(controls&&!controls.isDestroyed())controls.webContents.send('render-spike-error','原生渲染宿主异常：'+String(error.message).slice(0,400));}
