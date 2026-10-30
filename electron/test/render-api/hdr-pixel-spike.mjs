// Actual encoded PQ -> libmpv -> shared VideoFrame -> offscreen WebGPU pixels.
// No HDR video is presented to the display; never an HDR desktop acceptance.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {_electron,expect} from '@playwright/test';
import {fixture} from './framecode-fixtures.mjs';
import math from './hdr-math.cjs';
import colorMath from './hdr-color-reference.cjs';
import contracts from './source-contract.cjs';
const root=path.resolve(import.meta.dirname,'../../..'),folder=path.join(root,'build/libmpv-render-spike');mkdirSync(folder,{recursive:true});
const colorProbe=process.env.AVHUB_RENDER_HDR_COLOR_PROBE==='1';
const evidence=mkdtempSync(path.join(folder,'hdr-pixels-')),name=colorProbe?'HDR-PQ10-Color-v2-1024x256.mkv':'HDR-PQ10-1024x256.mkv',source=fixture(root,name);
function run(command,args,options={}){const r=spawnSync(command,args,{windowsHide:true,encoding:'utf8',timeout:30000,...options});assert.equal(r.status,0,String(r.stdout)+String(r.stderr));return r;}
run('python',[path.join(root,'scripts/prepare-libmpv-render.py'),'--candidate',process.env.AVHUB_RENDER_BACKEND==='d3d11'?'d3d11':'render','--offline','--verify-only']);
const probe=JSON.parse(run(path.join(root,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-read_intervals','%+#1','-show_streams','-show_frames','-of','json',source]).stdout),stream=contracts.mergeProbe(probe);
assert.throws(()=>contracts.sourceContract(stream,{floatingPoint:true,diagnosticSdr10:true}),/color\/HDR/);math.hdrProbeContract(stream,name);
if(colorProbe){const decodedFrame=run(path.join(root,'bin/ffmpeg.exe'),['-v','error','-i',source,'-frames:v','1','-pix_fmt','yuv420p10le','-f','rawvideo','pipe:1'],{encoding:null,maxBuffer:2*1024*1024}).stdout;assert.ok(decodedFrame.equals(colorMath.frame(1024,256)),'Cached color fixture changed input YUV bytes');}
const raw=run(path.join(root,'bin/ffmpeg.exe'),['-v','error','-i',source,'-frames:v','1','-vf','crop=iw:2:0:128','-pix_fmt','yuv420p10le','-f','rawvideo','pipe:1'],{encoding:null}).stdout;
assert.equal(raw.length,1024*6);
const reference=math.levels.map((nits,i)=>{const x=Math.floor((i+.5)*1024/10),y=raw.readUInt16LE(x*2),u=raw.readUInt16LE(4096+Math.floor(x/2)*2),v=raw.readUInt16LE(5120+Math.floor(x/2)*2);if(colorProbe){const expected=colorMath.encodeYuv(colorMath.colors[i]);assert.deepEqual([y,u,v],expected);const rgbPq=colorMath.decodeYuv([y,u,v]);return {requestedRgbNits:colorMath.colors[i],yuv:[y,u,v],rgbPq,pq:rgbPq[0],decodedNits:math.pqDecodeExtended(rgbPq[0])};}assert.equal(y,64+Math.round(876*math.pqEncode(nits)));assert.equal(u,512);assert.equal(v,512);const pq=(y-64)/876;return {requestedNits:nits,y,pq,rgbPq:[pq,pq,pq],decodedNits:math.pqDecode(pq)};});
run('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/platform:x64','/target:exe','/out:'+path.join(folder,'RenderHost.exe'),'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',...['RenderHost.cs','SharedSurface.cs','DisplayProbe.cs','RenderSurface.cs','D3dSurface.cs'].map(n=>path.join(import.meta.dirname,n))]);
const ui=path.join(folder,'ui');await build({configFile:false,root,base:'./',define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:ui,emptyOutDir:false,lib:{entry:path.join(import.meta.dirname,'controls.tsx'),name:'RenderSpike',formats:['iife'],fileName:()=> 'controls.js'}}});
writeFileSync(path.join(ui,'index.html'),'<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'unsafe-inline\'"></head><body><div id="root"></div><script src="./controls.js"></script></body></html>');
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();
const report={scope:'real Electron offscreen HDR numerical probe; no HDR video presented',sourceFrameByteExact:colorProbe?true:null,probeCompleted:false,numericalTransportPassed:false,hdrPlaybackCertified:false,hdrDisplayAcceptancePassed:false,m2GatePassed:false,reference,source:stream};let desktop,pid;
const rawProbe=process.env.AVHUB_RENDER_HDR_RAW_CARRIER==='1',linearProbe=!rawProbe&&process.env.AVHUB_RENDER_HDR_LINEAR_PROBE==='1';report.colorProbe=colorProbe;if(colorProbe&&!rawProbe)throw new Error('Color numerical fixture requires explicit raw carrier mode');report.outputProbe=rawProbe?'explicit-raw-pq-to-linear80':linearProbe?'scrgb-linear-80-nits':'pq';
console.log('HDR numerical evidence:',evidence);
try{
 const env={...process.env,AVHUB_RENDER_SHARED_TEXTURE:'1',AVHUB_RENDER_FP16:'1',AVHUB_RENDER_HDR_PIXEL_PROBE:'1',AVHUB_RENDER_SAMPLE:name};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;delete env.AVHUB_RENDER_INTERNAL_F16;if(rawProbe)delete env.AVHUB_RENDER_HDR_LINEAR_PROBE;
 desktop=await _electron.launch({args:[path.join(import.meta.dirname,'main.cjs')],cwd:folder,env,timeout:30000});
 await expect.poll(()=>desktop.evaluate(()=>Boolean(globalThis.__renderSpike)),{timeout:30000}).toBe(true);pid=await desktop.evaluate(()=>globalThis.__renderSpike.pid);report.runtime=await desktop.evaluate(()=>globalThis.__renderSpike.runtime);
 const page=desktop.windows().find(w=>w.url().endsWith('/index.html'));assert.ok(page);
 await expect.poll(async()=>{const raw=await page.locator('#hdr-pixel-probe').getAttribute('data-result').catch(()=>null);return raw?(JSON.parse(raw).nonFiniteComponents>0?2:JSON.parse(raw).samples.at(-1)[0]):0;},{timeout:20000}).toBeGreaterThan(.1);
 await desktop.evaluate(()=>globalThis.__renderSpike.command('pause',{value:true}));
 report.native=await desktop.evaluate(()=>globalThis.__renderSpike.command('snapshot'));report.nativeDisplay=await desktop.evaluate(()=>globalThis.__renderSpike.command('display'));
 const row=await desktop.evaluate(()=>globalThis.__renderSpike.command('precision-row'));assert.equal(row.values.length,1024);
 report.gpu=JSON.parse(await page.locator('#hdr-pixel-probe').getAttribute('data-result'));report.numericalReadCompleted=true;assert.equal(report.gpu.displayed,false);assert.equal(await page.locator('canvas').count(),0);
 report.nativeRgbSamples=reference.map((_,i)=>row.rgb.slice(Math.floor((i+.5)*1024/10)*3,Math.floor((i+.5)*1024/10)*3+3));report.nativeOutOfNominalRange=report.nativeRgbSamples.flat().filter(v=>v<0||v>1);
 report.nativeSamples=reference.map((r,i)=>({value:row.values[Math.floor((i+.5)*1024/10)],expected:linearProbe?r.decodedNits/80:r.pq}));
 report.nativeMaxCodeError=Math.max(...(colorProbe?report.nativeRgbSamples.flatMap((rgb,i)=>rgb.map((v,c)=>Math.abs(v-reference[i].rgbPq[c]))):report.nativeSamples.map(v=>Math.abs(v.value-v.expected))));if(!linearProbe)assert.ok(report.nativeMaxCodeError<=2/876,'Native PQ output changed luminance scale');
 assert.equal(report.gpu.nonFiniteComponents,0,'GPU import returned non-finite HDR samples');
 const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
 report.inferredSdrWhiteNits=reference.map((r,i)=>r.decodedNits/(rawProbe?report.gpu.samples[i][0]:linear(report.gpu.samples[i][0])));
 const whites=report.inferredSdrWhiteNits.slice(1),finite=whites.every(n=>Number.isFinite(n)&&n>0),spread=finite?Math.max(...whites)/Math.min(...whites)-1:null;
 report.referenceWhiteSpread=spread;report.extendedRange=report.gpu.samples.at(-1)[0]>1;
 report.numericalTransportPassed=finite&&spread<.03&&report.extendedRange;
 if(rawProbe){report.explicitReference=reference.map((_,i)=>{const at=Math.floor((i+.5)*1024/10)*3,codes=row.rgb.slice(at,at+3);assert.ok(codes.every(v=>Number.isFinite(v)&&Math.abs(v)<=1.01),'Unverified native PQ carrier range');const n=codes.map(math.pqDecodeExtended);return colorMath.bt2020To709(n).map(v=>v/80);});const errors=report.explicitReference.flatMap((rgb,i)=>rgb.map((v,c)=>Math.abs(report.gpu.samples[i][c]-v)/Math.max(Math.abs(v),.0001)));report.explicitMaxRelativeError=Math.max(...errors);report.numericalTransportPassed=report.nativeMaxCodeError<=2/876&&report.explicitMaxRelativeError<.002&&report.extendedRange;}
 if(colorProbe){report.negativeReferenceComponents=report.explicitReference.flat().filter(v=>v<-.01).length;report.negativeGpuComponents=report.gpu.samples.flat().filter(v=>v<-.01).length;assert.ok(report.negativeReferenceComponents>0);assert.equal(report.negativeGpuComponents,report.negativeReferenceComponents,'Wide gamut negatives were clipped');}
 report.transferStats=await desktop.evaluate(()=>globalThis.__renderSpike.quiesce());assert.equal(report.transferStats.imports,report.transferStats.released);report.probeCompleted=true;assert.equal(hash(),before);report.sourceUnchanged=true;
 await desktop.close();desktop=null;const check=spawnSync('powershell.exe',['-NoProfile','-Command',`if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue){exit 1}`],{windowsHide:true});assert.equal(check.status,0);report.cleanExit=true;
 assert.equal(report.numericalTransportPassed,true,'HDR offscreen import does not preserve one consistent absolute luminance scale');
}catch(error){report.error=String(error.stack||error);throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});report.sourceUnchanged=hash()===before;if(pid){const stopped=spawnSync('powershell.exe',['-NoProfile','-Command',`if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue){exit 1}`],{windowsHide:true});report.cleanExit=stopped.status===0;}writeFileSync(path.join(evidence,'acceptance.json'),JSON.stringify(report,null,2));}
