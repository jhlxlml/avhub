// Real encoded metadata/bit-depth negative fixtures. Not an HDR playback test.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import contracts from './source-contract.cjs';
const root=path.resolve(import.meta.dirname,'../../..'),base=path.join(root,'build/libmpv-render-spike');mkdirSync(base,{recursive:true});const folder=mkdtempSync(path.join(base,'quality-guards-')),reports=[];
for(const hdr of [false,true]){
 const file=path.join(folder,hdr?'synthetic-pq10.mkv':'synthetic-sdr10.mkv');
 const encode=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=gray:s=64x64:r=1','-frames:v','1','-vf','format=yuv420p10le','-c:v','libx265','-preset','ultrafast','-threads','1','-x265-params',`pools=none:frame-threads=1:colorprim=${hdr?'bt2020':'bt709'}:transfer=${hdr?'smpte2084':'bt709'}:colormatrix=${hdr?'bt2020nc':'bt709'}`,file],{windowsHide:true,timeout:30000});assert.equal(encode.status,0,String(encode.stderr));
 const hash=()=>createHash('sha256').update(readFileSync(file)).digest('hex'),before=hash();
 const probe=spawnSync(path.join(root,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-read_intervals','%+#1','-show_streams','-show_frames','-of','json',file],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(probe.status,0,probe.stderr);
 const input=contracts.mergeProbe(JSON.parse(probe.stdout));assert.equal(input.pix_fmt,'yuv420p10le');assert.equal(input.color_transfer,hdr?'smpte2084':'bt709');
 let rejection;try{contracts.sourceContract(input);}catch(error){rejection=error.message;}assert.match(rejection,/bit depth/);assert.equal(hash(),before);reports.push({sample:path.basename(file),metadata:input,rejection,rendered:false,sourceUnchanged:true});
}
writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify({scope:'Negative source-contract tests, not HDR/10-bit playback certification',completed:true,reports},null,2));console.log(folder);
