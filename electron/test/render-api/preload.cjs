const {contextBridge,ipcRenderer,sharedTexture}=require('electron');
const videoShader=`
   struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
   @vertex fn vertex(@builtin(vertex_index) n:u32)->Vertex {
    var positions=array(vec2f(-1,1),vec2f(-1,-3),vec2f(3,1));var v:Vertex;
    v.position=vec4f(positions[n],0,1);v.uv=positions[n]*vec2f(0.5,-0.5)+vec2f(0.5);return v;
   }
   @group(0) @binding(0) var video:texture_external;
   @group(0) @binding(1) var filtering:sampler;
   @fragment fn fragment(v:Vertex)->@location(0) vec4f {return textureSampleBaseClampToEdge(video,filtering,v.uv);}
  `;
let pendingProbe=null;
const renderMetrics={frames:0,gpuCompletions:0,rowReadbacks:0,alwaysReadbacks:0,requestedReadbacks:0,serviceMs:[]};
ipcRenderer.on('render-spike-probe',(_,id)=>{if(Number.isSafeInteger(id)&&id>0){pendingProbe=id;ipcRenderer.send('render-spike-probe-ready',id);}});
let gpuRenderer;
let hdrRenderer;
async function renderHdrDiagnostic(frame,rawCarrier,productionShader,transfer){
 if(frame.displayWidth!==1024||frame.displayHeight!==256)throw new Error('Unverified HDR probe size');
 if(!hdrRenderer)hdrRenderer=(async()=>{
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('HDR diagnostic WebGPU unavailable');const device=await adapter.requestDevice();
  const rawShader=videoShader.replace('return textureSampleBaseClampToEdge(video,filtering,v.uv);', 'let s=textureSampleBaseClampToEdge(video,filtering,v.uv);let p=select(s.rgb/12.92,pow(max((s.rgb+vec3f(0.055))/1.055,vec3f(0)),vec3f(2.4)),s.rgb>vec3f(0.04045));let e=pow(abs(p),vec3f(32.0/2523.0));let n=sign(p)*10000.0*pow(max(e-vec3f(3424.0/4096.0),vec3f(0))/(vec3f(2413.0/128.0)-vec3f(2392.0/128.0)*e),vec3f(16384.0/2610.0));let rgb=vec3f(dot(n,vec3f(1.660491,-0.587641,-0.072850)),dot(n,vec3f(-0.124550,1.132900,-0.008350)),dot(n,vec3f(-0.018151,-0.100579,1.118730)))/80.0;return vec4f(rgb,1);');
  const shader=device.createShaderModule({code:productionShader??(rawCarrier?rawShader:videoShader)});const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vertex'},fragment:{module:shader,entryPoint:productionShader?(transfer==='hlg'?'fragmentHlg':'fragmentPq'):'fragment',targets:[{format:'rgba32float'}]},primitive:{topology:'triangle-list'}});
  const texture=device.createTexture({size:[1024,256],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const buffer=device.createBuffer({size:1024*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  return {device,pipeline,texture,buffer,sampler:device.createSampler({magFilter:'nearest',minFilter:'nearest'})};
 })();
 const g=await hdrRenderer;g.device.pushErrorScope('validation');const encoder=g.device.createCommandEncoder();
 const pass=encoder.beginRenderPass({colorAttachments:[{view:g.texture.createView(),loadOp:'clear',storeOp:'store'}]});
 pass.setPipeline(g.pipeline);pass.setBindGroup(0,g.device.createBindGroup({layout:g.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:g.device.importExternalTexture({source:frame,colorSpace:'srgb'})},{binding:1,resource:g.sampler}]}));pass.draw(3);pass.end();
 encoder.copyTextureToBuffer({texture:g.texture,origin:{x:0,y:128}},{buffer:g.buffer,bytesPerRow:1024*16},{width:1024,height:1});
 g.device.queue.submit([encoder.finish()]);await g.buffer.mapAsync(GPUMapMode.READ);
 try{const values=new Float32Array(g.buffer.getMappedRange()),samples=Array.from({length:10},(_,i)=>Array.from(values.slice(Math.floor((i+.5)*1024/10)*4,Math.floor((i+.5)*1024/10)*4+3)));
  let node=document.getElementById('hdr-pixel-probe');if(!node){node=document.createElement('output');node.id='hdr-pixel-probe';node.textContent='HDR GPU 数值探测 · 不显示视频画面';document.body.append(node);}
  node.dataset.result=JSON.stringify({samples,nonFiniteComponents:samples.flat().filter(v=>!Number.isFinite(v)).length,outputEncoding:productionShader?'extended-srgb-203-nits':rawCarrier?'linear-bt709-80-nits':'implicit-srgb',videoColorSpace:frame.colorSpace.toJSON(),offscreen:true,displayed:false});
 }finally{g.buffer.unmap();}
 const error=await g.device.popErrorScope();if(error)throw new Error(error.message);
}
async function renderFloat16(frame,canvas,metadata){
 const started=performance.now(),probeId=pendingProbe;pendingProbe=null;const diagnostic=metadata.readbackMode==='always'||probeId!==null;
 if(!gpuRenderer)gpuRenderer=(async()=>{
  if(!navigator.gpu)throw new Error('WebGPU unavailable; no 8-bit fallback');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter');const device=await adapter.requestDevice();canvas.dataset.gpuAdapter=JSON.stringify({vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description});
  const context=canvas.getContext('webgpu');if(!context)throw new Error('No F16 WebGPU canvas');
  context.configure({device,format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC,colorSpace:'srgb',toneMapping:{mode:'extended'},alphaMode:'opaque'});
  const shader=device.createShaderModule({code:videoShader});
  const info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw new Error('F16 shader compilation failed');
  const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vertex'},fragment:{module:shader,entryPoint:'fragment',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
  const stride=Math.ceil(canvas.width*8/256)*256,buffer=device.createBuffer({size:stride*3,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  device.lost.then(reason=>ipcRenderer.send('render-spike-render-error','WebGPU device lost: '+reason.message));
  return {device,context,pipeline,layout:pipeline.getBindGroupLayout(0),sampler:device.createSampler({magFilter:'linear',minFilter:'linear'}),stride,buffer};
 })();
 const g=await gpuRenderer;g.device.pushErrorScope('validation');
 const texture=g.context.getCurrentTexture(),encoder=g.device.createCommandEncoder();
 const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
 const group=g.device.createBindGroup({layout:g.layout,entries:[{binding:0,resource:g.device.importExternalTexture({source:frame,colorSpace:'srgb'})},{binding:1,resource:g.sampler}]});
 pass.setPipeline(g.pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
 // Diagnostic rows only. These CPU reads are not the playback transport or a
 // performance claim; the displayed texture stays in GPU memory.
 if(diagnostic)for(const [i,y] of [32,Math.floor(canvas.height/2),canvas.height-33].entries())encoder.copyTextureToBuffer({texture,origin:{x:0,y}},{buffer:g.buffer,offset:i*g.stride,bytesPerRow:g.stride},{width:canvas.width,height:1});
 g.device.queue.submit([encoder.finish()]);
 if(diagnostic){await g.buffer.mapAsync(GPUMapMode.READ);
 try{
  const data=new Uint16Array(g.buffer.getMappedRange());const half=h=>{const e=(h>>10)&31,m=h&1023,s=h&32768?-1:1;return e===0?s*m*2**-24:e===31?NaN:s*(1+m/1024)*2**(e-15);};
  const values=[];for(let x=0;x<canvas.width;x++)values.push(half(data[g.stride/2+x*4]));
  // One diagnostic row only; never a CPU playback upload.
  if(!canvas.dataset.precisionRow&&new Set(values).size>512)canvas.dataset.precisionRow=JSON.stringify(values);
  const read=row=>{let code=0;for(let bit=0;bit<16;bit++){const at=row*g.stride/2+Math.floor((bit+.5)*canvas.width/16)*4,r=half(data[at]),green=half(data[at+1]),blue=half(data[at+2]);if(Math.abs(r-green)>.05||Math.abs(r-blue)>.05||r>.24&&r<.7)return null;if(r>=.7)code+=2**bit;}return code;};
  canvas.dataset.framecodeTop=JSON.stringify(read(0));canvas.dataset.framecodeBottom=JSON.stringify(read(2));
  const plateaus=Array.from({length:877},(_,level)=>{const first=Math.ceil(level*(canvas.width-1)/876),last=Math.min(canvas.width-1,Math.ceil((level+1)*(canvas.width-1)/876)-1);return values[Math.floor((first+Math.max(first,last))/2)];});
  const maxBackwardStep=plateaus.slice(1).reduce((m,v,i)=>Math.max(m,plateaus[i]-v),0);
  canvas.dataset.precision=JSON.stringify({array:'WebGPU-F16-buffer',levels:new Set(values).size,plateauLevels:new Set(plateaus).size,maxBackwardStep,min:Math.min(...values),max:Math.max(...values)});
 }finally{g.buffer.unmap();}
 renderMetrics.rowReadbacks++;if(probeId!==null)renderMetrics.requestedReadbacks++;else renderMetrics.alwaysReadbacks++;
 }else await g.device.queue.onSubmittedWorkDone();
 renderMetrics.gpuCompletions++;renderMetrics.frames++;renderMetrics.serviceMs.push(performance.now()-started);if(renderMetrics.serviceMs.length>512)renderMetrics.serviceMs.shift();
 canvas.dataset.renderMetrics=JSON.stringify({frames:renderMetrics.frames,gpuCompletions:renderMetrics.gpuCompletions,rowReadbacks:renderMetrics.rowReadbacks,requestedReadbacks:renderMetrics.requestedReadbacks});
 const error=await g.device.popErrorScope();if(error)throw new Error('WebGPU F16 validation: '+error.message);
 canvas.dataset.colorType='float16';canvas.dataset.renderPath='webgpu-rgba16float';
 if(probeId!==null)ipcRenderer.send('render-spike-probe-done',probeId,{nativeFrame:metadata.nativeFrame,top:JSON.parse(canvas.dataset.framecodeTop),precision:JSON.parse(canvas.dataset.precision),metrics:{...renderMetrics,serviceMs:[...renderMetrics.serviceMs]}});
}
ipcRenderer.on('render-spike-error',(_,message)=>{let node=document.getElementById('render-spike-error');if(!node){node=document.createElement('div');node.id='render-spike-error';node.setAttribute('role','alert');Object.assign(node.style,{position:'fixed',top:'80px',left:'20px',color:'white',background:'#8b2530',padding:'16px',zIndex:'1000'});document.body.append(node);}node.textContent=String(message).slice(0,512);});
if(process.argv.includes('--render-shared-texture')){
 sharedTexture.setSharedTextureReceiver(async({importedSharedTexture},metadata)=>{
  let frame;
  try{
   frame=importedSharedTexture.getVideoFrame();if(metadata.hdrDiagnostic){await renderHdrDiagnostic(frame,metadata.hdrRawCarrier,metadata.hdrProductionShader,metadata.hdrProductionTransfer);return;}if(frame.displayWidth!==metadata.width||frame.displayHeight!==metadata.height)throw new Error('Imported frame dimensions differ from source');let canvas=document.getElementById('native-shared-video');
   if(!canvas){canvas=document.createElement('canvas');canvas.id='native-shared-video';Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100%',height:'100%',objectFit:'contain',pointerEvents:'none'});document.body.prepend(canvas);}
   if(canvas.width!==frame.displayWidth)canvas.width=frame.displayWidth;if(canvas.height!==frame.displayHeight)canvas.height=frame.displayHeight;
   if(metadata.floatingPoint)await renderFloat16(frame,canvas,metadata);
   else{const ctx=canvas.getContext('2d',{colorSpace:'srgb',colorType:'unorm8',alpha:false});ctx.drawImage(frame,0,0);canvas.dataset.colorType=ctx.getContextAttributes().colorType;canvas.dataset.renderPath='canvas2d-unorm8';}
   canvas.dataset.frames=String(Number(canvas.dataset.frames||0)+1);canvas.dataset.nativeFrame=String(metadata.nativeFrame);canvas.dataset.videoFormat=frame.format;
  }catch(error){ipcRenderer.send('render-spike-render-error',String(error.message).slice(0,400));throw error;}finally{frame?.close();importedSharedTexture.release();}
 });
}
contextBridge.exposeInMainWorld('renderSpike',Object.freeze({command:(action,value)=>ipcRenderer.invoke('render-spike',action,value)}));
