import { contextBridge, ipcRenderer, sharedTexture } from 'electron';

// Kept in this sandbox preload: importing a local CommonJS helper would require
// relaxing sandbox rules. The renderer receives neither VideoFrame nor handles.
let renderSurface:{id:string;node:HTMLElement;canvas:HTMLCanvasElement;gpu?:Promise<any>;work:Promise<void>;closed:boolean;rotation:number;zoom:number;x:number;y:number;resize:ResizeObserver}|null=null;
const fitRenderSurface=(s:NonNullable<typeof renderSurface>)=>{const r=s.node.getBoundingClientRect(),swap=s.rotation%180!==0,w=s.canvas.width,h=s.canvas.height;if(!w||!h)return;const scale=Math.min(r.width/(swap?h:w),r.height/(swap?w:h)),z=2**s.zoom;Object.assign(s.canvas.style,{width:w*scale+'px',height:h*scale+'px',transform:`translate(-50%,-50%) translate(${s.x*(swap?h:w)*scale*z}px,${s.y*(swap?w:h)*scale*z}px) rotate(${s.rotation}deg) scale(${z})`});};
async function attachRenderSurface(id:string){
 if(renderSurface||!/^avhub-render-[a-f0-9-]{36}$/.test(id))throw new Error('原生画面表面不可用');const node=document.getElementById(id);if(!node)throw new Error('原生画面区域尚未挂载');
 await ipcRenderer.invoke('avhub:render-player','attach',id);const canvas=document.createElement('canvas');canvas.className='native-render-canvas';Object.assign(canvas.style,{position:'absolute',left:'50%',top:'50%',pointerEvents:'none'});node.prepend(canvas);
 const s:any={id,node,canvas,work:Promise.resolve(),closed:false,rotation:0,zoom:0,x:0,y:0,resize:new ResizeObserver(()=>fitRenderSurface(s))};renderSurface=s;s.resize.observe(node);return {ok:true};
}
async function detachRenderSurface(id:string){const s=renderSurface;if(!s||s.id!==id)throw new Error('原生表面已过期');await s.work;await ipcRenderer.invoke('avhub:render-player','detach',id);s.closed=true;s.resize.disconnect();const gpu=await s.gpu?.catch(()=>null);gpu?.context.unconfigure();gpu?.device.destroy();s.canvas.remove();renderSurface=null;return {ok:true};}
const renderShader=`struct V{@builtin(position)p:vec4f,@location(0)uv:vec2f};@vertex fn vertex(@builtin(vertex_index)n:u32)->V{var p=array(vec2f(-1,1),vec2f(-1,-3),vec2f(3,1));var v:V;v.p=vec4f(p[n],0,1);v.uv=p[n]*vec2f(.5,-.5)+vec2f(.5);return v;}@group(0)@binding(0)var video:texture_external;@group(0)@binding(1)var filtering:sampler;
@fragment fn fragment(v:V)->@location(0)vec4f{return textureSampleBaseClampToEdge(video,filtering,v.uv);}
fn carrierCodes(v:V)->vec3f{
 let carrier=textureSampleBaseClampToEdge(video,filtering,v.uv).rgb;
 return select(carrier/12.92,pow(max((carrier+vec3f(.055))/1.055,vec3f(0)),vec3f(2.4)),carrier>vec3f(.04045));
}
fn canvasColor(nits:vec3f)->vec4f{
 let linear=vec3f(dot(nits,vec3f(1.660491,-.587641,-.072850)),dot(nits,vec3f(-.124550,1.132900,-.008350)),dot(nits,vec3f(-.018151,-.100579,1.118730)))/203.0;
 // Extended sRGB canvas values, not Windows scRGB /80 values. Preserve
 // negative wide-gamut components and values above SDR white; no tone map.
 let encoded=select(linear*12.92,1.055*pow(max(linear,vec3f(0)),vec3f(1.0/2.4))-.055,linear>vec3f(.0031308));
 return vec4f(encoded,1);
}
@fragment fn fragmentPq(v:V)->@location(0)vec4f{
 let pq=carrierCodes(v);let e=pow(abs(pq),vec3f(32.0/2523.0));
 return canvasColor(sign(pq)*10000.0*pow(max(e-vec3f(3424.0/4096.0),vec3f(0))/(vec3f(2413.0/128.0)-vec3f(2392.0/128.0)*e),vec3f(16384.0/2610.0)));
}
@fragment fn fragmentHlg(v:V)->@location(0)vec4f{
 let codes=carrierCodes(v);let magnitude=abs(codes);
 let scene=sign(codes)*select(magnitude*magnitude/3.0,(exp((magnitude-vec3f(.559910729529562))/.17883277265695)+vec3f(.2846689093722))/12.0,magnitude>vec3f(.5));
 // BT.2100 nominal 1000-nit reference: inverse OETF and luminance OOTF.
 let luminance=max(dot(scene,vec3f(.2627,.6780,.0593)),0.0);
 return canvasColor(1000.0*scene*pow(luminance,.2));
}`;
sharedTexture.setSharedTextureReceiver(async({importedSharedTexture},metadata:any)=>{
 let frame:VideoFrame|undefined;const s=renderSurface;let ok=false;
 try{
  if(!s||s.closed||metadata.surface!==s.id||typeof metadata.session!=='string'||!Number.isSafeInteger(metadata.serial)||typeof metadata.token!=='string')throw new Error('原生帧表面不匹配');
  frame=importedSharedTexture.getVideoFrame();if(frame.displayWidth!==metadata.width||frame.displayHeight!==metadata.height)throw new Error('原生帧尺寸变化');
  // Keep actual carrier metadata distinct from source/output signal metadata.
  s.canvas.dataset.nativeTransfer=frame.colorSpace.transfer??'unknown';
  s.canvas.dataset.nativePrimaries=frame.colorSpace.primaries??'unknown';
  s.canvas.dataset.sourceTransfer=metadata.outputTransfer??frame.colorSpace.transfer??'unknown';
  // Electron supplies linear at runtime although the DOM TS enum omits it.
  if((metadata.outputTransfer==='pq'||metadata.outputTransfer==='hlg')&&(String(frame.colorSpace.transfer)!=='linear'||frame.colorSpace.primaries!=='bt709'))throw new Error('HDR 数值载体色彩不匹配');
  const run=(async()=>{
   if(!s.gpu){s.canvas.width=metadata.width;s.canvas.height=metadata.height;fitRenderSurface(s);s.gpu=(async()=>{
    const adapter=await (navigator as any).gpu?.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('WebGPU 不可用，不降为 8-bit');const device=await adapter.requestDevice(),context=s.canvas.getContext('webgpu') as any;if(!context)throw new Error('F16 画布不可用');
    context.configure({device,format:'rgba16float',usage:(globalThis as any).GPUTextureUsage.RENDER_ATTACHMENT,colorSpace:'srgb',toneMapping:{mode:'extended'},alphaMode:'opaque'});
    const module=device.createShaderModule({code:renderShader});const info=await module.getCompilationInfo();if(info.messages.some((m:any)=>m.type==='error'))throw new Error('原生画面着色器初始化失败');const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragment',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const pqPipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragmentPq',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    const hlgPipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragmentHlg',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    // Layouts are immutable for each pipeline; getBindGroupLayout creates a
    // new wrapper, so cache once instead of allocating one on every frame.
    device.lost.then(()=>{if(!s.closed)ipcRenderer.send('avhub:render-surface-error',{surface:s.id});});return {device,context,pipeline,layout:pipeline.getBindGroupLayout(0),pqPipeline,pqLayout:pqPipeline.getBindGroupLayout(0),hlgPipeline,hlgLayout:hlgPipeline.getBindGroupLayout(0),sampler:device.createSampler({magFilter:'linear',minFilter:'linear'})};
   })();}
   if(s.canvas.width!==metadata.width||s.canvas.height!==metadata.height){s.canvas.width=metadata.width;s.canvas.height=metadata.height;fitRenderSurface(s);}
   const g=await s.gpu;g.device.pushErrorScope('validation');const encoder=g.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:g.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
   const pipeline=metadata.outputTransfer==='pq'?g.pqPipeline:metadata.outputTransfer==='hlg'?g.hlgPipeline:g.pipeline,layout=metadata.outputTransfer==='pq'?g.pqLayout:metadata.outputTransfer==='hlg'?g.hlgLayout:g.layout;pass.setPipeline(pipeline);pass.setBindGroup(0,g.device.createBindGroup({layout,entries:[{binding:0,resource:g.device.importExternalTexture({source:frame,colorSpace:'srgb'})},{binding:1,resource:g.sampler}]}));pass.draw(3);pass.end();g.device.queue.submit([encoder.finish()]);await g.device.queue.onSubmittedWorkDone();const error=await g.device.popErrorScope();if(error)throw new Error(error.message);s.canvas.dataset.nativeFrame=String(metadata.serial);s.canvas.dataset.renderPath='d3d11-webgpu-rgba16float';
  })();s.work=run.catch(()=>{});await run;ok=true;
 }finally{frame?.close();importedSharedTexture.release();ipcRenderer.send('avhub:render-frame-done',{session:metadata?.session,serial:metadata?.serial,token:metadata?.token,ok});}
});

ipcRenderer.on('avhub:quit-cancelled', () => window.dispatchEvent(new Event('avhub-quit-cancelled')));

contextBridge.exposeInMainWorld('avhubDesktop', {
  renderPlayer:(action:string,input?:unknown)=>ipcRenderer.invoke('avhub:render-player',action,input),
  attachRenderSurface,detachRenderSurface,
  transformRenderSurface:(id:string,value:{rotation:number;zoom:number;x:number;y:number})=>{const s=renderSurface;if(!s||s.id!==id||![0,90,180,270].includes(value.rotation)||![value.zoom,value.x,value.y].every(Number.isFinite)||value.zoom<0||value.zoom>3||Math.abs(value.x)>4||Math.abs(value.y)>4)throw new Error('画面变换无效');Object.assign(s,value);fitRenderSurface(s);},
  onRenderState:(callback:(value:any)=>void)=>{const fn=(_:Electron.IpcRendererEvent,v:any)=>callback(v);ipcRenderer.on('avhub:render-state',fn);return()=>ipcRenderer.removeListener('avhub:render-state',fn);},
  onRenderEvent:(callback:(value:any)=>void)=>{const fn=(_:Electron.IpcRendererEvent,v:any)=>callback(v);ipcRenderer.on('avhub:render-event',fn);return()=>ipcRenderer.removeListener('avhub:render-event',fn);},
  onRenderClosed:(callback:(value:any)=>void)=>{const fn=(_:Electron.IpcRendererEvent,v:any)=>callback(v);ipcRenderer.on('avhub:render-closed',fn);return()=>ipcRenderer.removeListener('avhub:render-closed',fn);},
  nativePlayer:(action:string,input?:unknown)=>ipcRenderer.invoke('avhub:native-player',action,input),
    onNativeShortcut:(callback:(value:{code:string;shiftKey:boolean;repeat:boolean})=>void)=>{
      const listener=(_event:Electron.IpcRendererEvent,value:{code:string;shiftKey:boolean;repeat:boolean})=>callback(value);
      ipcRenderer.on('avhub:native-shortcut',listener);return()=>ipcRenderer.removeListener('avhub:native-shortcut',listener);
    },
  onNativeState:(callback:(value:unknown)=>void)=>{
    const listener=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);
    ipcRenderer.on('avhub:native-state',listener);return()=>ipcRenderer.removeListener('avhub:native-state',listener);
  },
  onNativeEvent:(callback:(value:unknown)=>void)=>{
    const listener=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);
    ipcRenderer.on('avhub:native-event',listener);return()=>ipcRenderer.removeListener('avhub:native-event',listener);
  },
  onNativeClosed:(callback:(value:unknown)=>void)=>{
    const listener=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);
    ipcRenderer.on('avhub:native-closed',listener);return()=>ipcRenderer.removeListener('avhub:native-closed',listener);
  },
  saveExport:(request:{kind:'backup';jobId:string}|{kind:'diagnostics'|'playback-diagnostics'})=>ipcRenderer.invoke('avhub:save-export',request),
  cancelExport:()=>ipcRenderer.invoke('avhub:cancel-export'),
  revealExport:(id:string)=>ipcRenderer.invoke('avhub:reveal-export',id),
  openRelease:(tag:string,format?:'folder'|'single')=>ipcRenderer.invoke('avhub:open-release',tag,format),
  startupReady:()=>ipcRenderer.invoke('avhub:startup-ready'),
  startupProgress:(stage:string)=>ipcRenderer.invoke('avhub:startup-progress',stage),
  onMouseSeek:(callback:(direction:'back'|'forward')=>void)=>{
    const listener=(_event:Electron.IpcRendererEvent,direction:unknown)=>{if(direction==='back'||direction==='forward')callback(direction);};
    ipcRenderer.on('avhub:mouse-seek',listener);return()=>{ipcRenderer.removeListener('avhub:mouse-seek',listener);};
  },
  dataLocation:(action:'get'|'choose')=>ipcRenderer.invoke('avhub:data-location',action),
  chooseFolder:(purpose:'media'|'screenshots')=>ipcRenderer.invoke('avhub:choose-folder',purpose) as Promise<{path:string}|{cancelled:true}>,
  appCommand:(command:'data-folder'|'project-page')=>ipcRenderer.invoke('avhub:app-command',command) as Promise<{ok:boolean}>,
  screenshotAction:(id:string|null,action:'reveal'|'folder')=>ipcRenderer.invoke('avhub:screenshot-action',id,action) as Promise<{ok:boolean}>,
  mediaAction:(mediaId:number,action:'reveal'|'open')=>ipcRenderer.invoke('avhub:media-action',mediaId,action) as Promise<{ok:boolean}>,
  fileOperation:(value:{action:'rename'|'recycle'|'permissions'|'recycle-bin'|'recheck'|'forget'|'preview'|'release-preview'|'restore-record'|'delete-record'|'clear-record'|'preview-records'|'release-record-preview'|'recheck-record'|'resolve-source'|'cancel-preview';requestId?:string;id?:number|string;ids?:number[];recordIds?:string[];recordAction?:'restore'|'delete'|'clear';previewToken?:string;stem?:string;rename?:boolean;recycle?:boolean;permanentDelete?:boolean;decision?:'keep'|'reset';signature?:string;confirmed?:boolean})=>ipcRenderer.invoke('avhub:file-operation',value),
  getWindowState: () => ipcRenderer.invoke('avhub:window-state'),
  setWindowMode: (value: {purePlayback?:boolean;alwaysOnTop?:boolean;videoAspectRatio?:number}) => ipcRenderer.invoke('avhub:window-mode', value),
  windowAction: (action:'minimize'|'maximize'|'close') => ipcRenderer.invoke('avhub:window-action', action),
  onWindowStateChanged: (callback: (state: {purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean}) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: {purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean}) => callback(state);
    ipcRenderer.on('avhub:window-state-changed', listener);
    return () => ipcRenderer.removeListener('avhub:window-state-changed', listener);
  },
});
