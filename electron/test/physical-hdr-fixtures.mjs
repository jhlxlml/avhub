// Owned code-value charts for transport/seek testing, not mastered HDR footage.
// Reinterpret existing synthetic 10-bit code values with PQ/HLG declarations.
// Stream-copy only; verify decoded samples remain byte-identical to the chart.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,statfsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..');
const directory=mkdtempSync(path.join(root,'build/physical-hdr-fixtures-'));
assert.ok(statfsSync(directory).bavail*statfsSync(directory).bsize>512*1024**2);
const cli=path.join(root,'build/controlled-cli-runtime-oo95u495');
const source=path.join(root,'build/libmpv-render-spike/samples/Precision-SDR10-3840x2160.mkv');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const before=hash(readFileSync(source));
const run=(name,args)=>{const result=spawnSync(path.join(cli,name+'.exe'),args,{windowsHide:true,timeout:60000,maxBuffer:32*1024**2});assert.equal(result.status,0,String(result.stderr));return result.stdout;};
const pixels=file=>hash(run('ffmpeg',['-v','error','-i',file,'-frames:v','1','-pix_fmt','yuv420p10le','-f','rawvideo','pipe:1']));
const reference=pixels(source),fixtures=[];
for(const [name,transfer,vui] of [['PQ','smpte2084',16],['HLG','arib-std-b67',18]]){
 const filename=`Framecode-HDR-${name}-3840x2160.mkv`,file=path.join(directory,filename);
 run('ffmpeg',['-v','error','-i',source,'-map','0:v:0','-c:v','copy','-color_primaries','bt2020','-color_trc',transfer,'-colorspace','bt2020nc','-color_range','tv','-bsf:v',`hevc_metadata=colour_primaries=9:transfer_characteristics=${vui}:matrix_coefficients=9`,'-n',file]);
 const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));const stream=probe.streams[0];
 assert.equal(stream.width,3840);assert.equal(stream.height,2160);assert.equal(stream.pix_fmt,'yuv420p10le');assert.equal(stream.color_transfer,transfer);assert.equal(stream.color_primaries,'bt2020');assert.equal(stream.color_space,'bt2020nc');assert.equal(pixels(file),reference);
 fixtures.push({filename,sha256:hash(readFileSync(file)),firstDecodedYuvSha256:reference,probe});
}
assert.equal(hash(readFileSync(source)),before);
const receipt={kind:'owned-synthetic-code-value-HDR-charts',directory,source:{path:source,sha256:before},notMasteredHdrFootage:true,physicalColorCertification:false,fixtures};
writeFileSync(path.join(directory,'fixtures.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify({directory,receipt:path.join(directory,'fixtures.json')}));
