// An actual encoded counter in each source frame, independently decoded from
// the imported video pixels. No timestamp property is treated as a shown frame.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,statSync,statfsSync,readdirSync,openSync,closeSync,linkSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import contracts from './source-contract.cjs';
import hdrMath from './hdr-math.cjs';
import hdrColor from './hdr-color-reference.cjs';
import {longFixture,longName} from './long-fixture.mjs';
export const samples={
 [longName]:{width:3840,height:2160,codec:'hevc',precision10:true},
 'HDR-PQ10-Color-v2-1024x256.mkv':{width:1024,height:256,codec:'hevc',precision10:true,hdr:true,hdrColor:true},
 'HDR-PQ10-1024x256.mkv':{width:1024,height:256,codec:'hevc',precision10:true,hdr:true},
 'Framecode-v2-640x360.mp4':{width:640,height:360},
 'Framecode-v2-1920x1080.mp4':{width:1920,height:1080},
 'Framecode-v2-3840x2160.mp4':{width:3840,height:2160},
 'Framecode-v2-3840x2160-hevc.mkv':{width:3840,height:2160,codec:'hevc'},
 'Framecode-v3-3840x2160-av1.mkv':{width:3840,height:2160,codec:'av1'},
 'Precision-SDR10-2160x3840.mkv':{width:2160,height:3840,codec:'hevc',precision10:true},
 'Framecode-v3-1920x1080-av1.mkv':{width:1920,height:1080,codec:'av1'},
 'Precision-SDR10-1024x256.mkv':{width:1024,height:256,codec:'hevc',precision10:true},
 'Precision-SDR10-3840x2160.mkv':{width:3840,height:2160,codec:'hevc',precision10:true},
 'Precision-SDR10-Continuous-3840x2160.mkv':{width:3840,height:2160,codec:'hevc',precision10:true,continuous:true},
};
export function fixture(root,name='Framecode-v2-640x360.mp4'){
 const sample=samples[name];assert.ok(sample,'Only allowlisted generated fixtures may be used');
 if(name===longName)return longFixture(root,fixture(root,'Precision-SDR10-3840x2160.mkv'));
 const folder=path.join(root,'build/libmpv-render-spike/samples');mkdirSync(folder,{recursive:true});const source=path.join(folder,name);
 if(!existsSync(source)){
  const disk=statfsSync(folder),cached=readdirSync(folder,{withFileTypes:true}).filter(f=>f.isFile()).reduce((sum,f)=>sum+statSync(path.join(folder,f.name)).size,0);
  assert.ok(disk.bavail*disk.bsize>=512*1024*1024,'Insufficient space for fixture generation');assert.ok(cached+128*1024*1024<=512*1024*1024,'Fixture cache capacity reached');
  const lock=source+'.lock',temporary=source+'.'+process.pid+'.part'+path.extname(source);const fd=openSync(lock,'wx');
  try{
  const {width,height}=sample;const prim=sample.hdr?'bt2020':'bt709',transfer=sample.hdr?'smpte2084':'bt709',matrix=sample.hdr?'bt2020nc':'bt709';
  const encoder=sample.codec==='hevc'?['-c:v','libx265','-preset','ultrafast','-threads','4','-x265-params',`pools=4:frame-threads=1:colorprim=${prim}:transfer=${transfer}:colormatrix=${matrix}:log-level=error`+(sample.precision10?':lossless=1':'')]:sample.codec==='av1'?['-c:v','libaom-av1','-cpu-used','8','-row-mt','1','-threads','4','-crf','32']:['-c:v','libx264','-preset','ultrafast','-threads','4'];
  const headers=sample.codec==='hevc'?['-bsf:v',sample.hdr?'hevc_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9':'hevc_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1']:sample.codec==='av1'?['-bsf:v','av1_metadata=color_primaries=1:transfer_characteristics=1:matrix_coefficients=1:color_range=0']:['-bsf:v','h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1','-movflags','+write_colr'];
  const counter="geq=lum='if(mod(floor(N/pow(2,floor(X/(W/16)))),2),235,16)':cb=128:cr=128";
  const hdrExpression=hdrMath.levels.reduceRight((tail,n,i)=>`if(lt(X,${(i+1)*width/10}),${64+Math.round(876*hdrMath.pqEncode(n))},${tail})`,'940');
  const rawInput=sample.hdrColor?Buffer.concat(Array(50).fill(hdrColor.frame(width,height))):undefined;
  const inputs=sample.hdrColor?['-f','rawvideo','-pixel_format','yuv420p10le','-video_size',`${width}x${height}`,'-framerate','25','-color_primaries',prim,'-color_trc',transfer,'-colorspace',matrix,'-color_range','tv','-i','pipe:0']:sample.hdr?['-f','lavfi','-i',`nullsrc=s=${width}x${height}:r=25,format=yuv420p10le`,'-vf',`geq=lum='${hdrExpression}':cb=512:cr=512`]:sample.precision10?['-f','lavfi','-i',`nullsrc=s=${width}x${height}:r=25,format=yuv420p10le`,'-vf',"geq=lum='if(lt(Y,64),if(mod(floor(N/pow(2,floor(X/(W/16)))),2),940,64),64+floor(X*876/(W-1)))':cb=512:cr=512"]:['-f','lavfi','-i',`testsrc2=s=${width}x${height}:r=25`,'-f','lavfi','-i',`nullsrc=s=${width}x64:r=25`,'-filter_complex',`[1:v]${counter}[bits];[0:v][bits]overlay=0:0:shortest=1[v]`,'-map','[v]'];
  const result=sample.continuous?spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-stream_loop','29','-i',fixture(root,'Precision-SDR10-3840x2160.mkv'),'-map','0:v:0','-c:v','copy','-t','180','-n',temporary],{windowsHide:true,timeout:180000}):spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error',...inputs,'-t',sample.hdr?'2':'6',...encoder,'-g','50','-pix_fmt',sample.precision10?'yuv420p10le':'yuv420p','-color_primaries',prim,'-color_trc',transfer,'-colorspace',matrix,'-color_range','tv',...headers,'-n',temporary],{windowsHide:true,timeout:180000,input:rawInput});
  assert.equal(result.status,0,String(result.stderr));
  assert.ok(statSync(temporary).size<128*1024*1024,'Fixture exceeds cache budget');
  const probe=spawnSync(path.join(root,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-read_intervals','%+#1','-show_format','-show_streams','-show_frames','-of','json',temporary],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(probe.status,0,probe.stderr);const decoded=contracts.mergeProbe(JSON.parse(probe.stdout));const verified=sample.hdr?hdrMath.hdrProbeContract(decoded,name):contracts.sourceContract(decoded,sample.precision10?{floatingPoint:true,diagnosticSdr10:true}:{});assert.equal(verified.width,width);assert.equal(verified.height,height);
  if(sample.hdrColor){const pixels=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-i',temporary,'-frames:v','1','-pix_fmt','yuv420p10le','-f','rawvideo','pipe:1'],{windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});assert.equal(pixels.status,0,String(pixels.stderr));assert.ok(pixels.stdout.equals(hdrColor.frame(width,height)),'Encoded color fixture must retain every input YUV byte');}
  if(sample.continuous)verifyContinuous(root,fixture(root,'Precision-SDR10-3840x2160.mkv'),temporary);
  linkSync(temporary,source);
  }finally{closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);unlinkSync(lock);}
 }
 assert.ok(statSync(source).size<128*1024*1024,'Fixture exceeds cache budget');
 if(sample.continuous)verifyContinuous(root,fixture(root,'Precision-SDR10-3840x2160.mkv'),source);
 return source;
}
function verifyContinuous(root,original,source){
 const packets=file=>{const p=spawnSync(path.join(root,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=pts_time,dts_time,data_hash','-of','json',file],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout).packets;};
 const a=packets(original),b=packets(source);assert.equal(a.length,150);assert.equal(b.length,4500);
 for(let i=0;i<b.length;i++){assert.equal(b[i].data_hash,a[i%150].data_hash,'Stream-copy changed encoded packet '+i);assert.ok(Math.abs(Number(b[i].pts_time)-Number(a[i%150].pts_time)-Math.floor(i/150)*6)<.002,'Continuous PTS changed at '+i);if(i>0&&b[i].dts_time!==undefined&&b[i-1].dts_time!==undefined)assert.ok(Number(b[i].dts_time)>Number(b[i-1].dts_time),'DTS is not increasing');}
}
export function referenceFrames(root,source,width,requested=[0,31,52,109,128]){
 const indices=[...new Set(requested)].sort((a,b)=>a-b),expression=indices.map(n=>`eq(n,${n})`).join('+');
 const result=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-i',source,'-vf',`select='${expression}',format=rgb24,crop=iw:1:0:32`,'-fps_mode','passthrough','-frames:v',String(indices.length),'-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,String(result.stderr));assert.equal(result.stdout.length,width*3*indices.length);
 return Object.fromEntries(indices.map((n,row)=>{let value=0;for(let bit=0;bit<16;bit++){const at=row*width*3+Math.floor((bit+.5)*width/16)*3,r=result.stdout[at],g=result.stdout[at+1],b=result.stdout[at+2];assert.ok(Math.abs(r-g)<12&&Math.abs(r-b)<12&&(r<60||r>180),'Invalid source frame counter');if(r>=180)value+=2**bit;}assert.equal(value,/Continuous|Long-v1/.test(path.basename(source))?n%150:n,'Encoded counter must match independent source decoding');return [n,value];}));
}
export function referencePrecision(root,source,width,height){
 const result=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-i',source,'-frames:v','1','-vf',`crop=iw:2:0:${Math.floor(height/2)}`,'-pix_fmt','yuv420p10le','-f','rawvideo','pipe:1'],{windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,String(result.stderr));assert.equal(result.stdout.length,width*6);
 const values=[];for(let x=0;x<width;x++)values.push(result.stdout.readUInt16LE(x*2));
 for(let x=0;x<width;x++)assert.equal(values[x],64+Math.floor(x*876/(width-1)),'Independent decoded source ramp differs at '+x);
 const proof={decoder:'independent FFmpeg raw yuv420p10le',levels:new Set(values).size,min:Math.min(...values),max:Math.max(...values)};
 assert.equal(proof.levels,877);assert.equal(proof.min,64);assert.equal(proof.max,940);return proof;
}
export function sourceFingerprint(){
 const names=['RenderHost.cs','SharedSurface.cs','DisplayProbe.cs','main.cjs','preload.cjs','controls.tsx','source-contract.cjs','hdr-math.cjs','overlay-fixture.cjs','command-bridge.cjs','RenderSurface.cs','D3dSurface.cs','win32-handle-owner.cjs','render-ffi.cjs','../../../ci/render-ffi/runtime-manifest.json','../../../ci/libmpv-render-candidate.json','../../../ci/libmpv-d3d11-candidate.json','../../../third_party/libmpv-render-d3d11/render_d3d11.h'];
 return import('node:crypto').then(async({createHash})=>{const {readFileSync}=await import('node:fs');const hash=createHash('sha256');for(const name of names)hash.update(name).update(readFileSync(path.join(import.meta.dirname,name)));return hash.digest('hex');});
}
