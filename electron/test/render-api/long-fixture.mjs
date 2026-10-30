// Fixed, app-owned long timeline. Separate bounded cache, never user media.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,realpathSync,readdirSync,statSync,statfsSync,openSync,closeSync,linkSync,unlinkSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
export const longName='long-run/Precision-SDR10-Long-v1-3840x2160.mkv';
export function longFixture(root,original){
 const folder=path.join(root,'build/libmpv-render-spike/samples/long-run'),source=path.join(folder,path.basename(longName)),limit=1024**3;
 mkdirSync(folder,{recursive:true});assert.equal(realpathSync(folder).toLowerCase(),path.resolve(folder).toLowerCase(),'Redirected long-fixture cache');
 const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
 const packets=file=>{const p=spawnSync(path.join(root,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=pts_time,dts_time,data_hash','-of','json',file],{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout).packets;};
 const originalPackets=packets(original);assert.equal(originalPackets.length,150);
 function verify(file){const a=packets(file);assert.equal(a.length,24000);for(let i=0;i<a.length;i++){assert.equal(a[i].data_hash,originalPackets[i%150].data_hash,'Lossy/changed packet '+i);assert.ok(Math.abs(Number(a[i].pts_time)-Number(originalPackets[i%150].pts_time)-Math.floor(i/150)*6)<.002,'Invalid long PTS '+i);if(i&&a[i].dts_time!==undefined&&a[i-1].dts_time!==undefined)assert.ok(Number(a[i].dts_time)>Number(a[i-1].dts_time),'Non-increasing long DTS');}assert.ok(statSync(file).size<limit);}
 if(!existsSync(source)){
  const disk=statfsSync(folder),used=readdirSync(folder,{withFileTypes:true}).filter(f=>f.isFile()).reduce((n,f)=>n+statSync(path.join(folder,f.name)).size,0);
  assert.ok(disk.bavail*disk.bsize>=2*limit,'Long fixture needs 2 GiB free');assert.ok(used+statSync(original).size*160+32*1024**2<limit,'Long fixture cache exceeds 1 GiB');
  const lock=source+'.lock',temporary=source+'.'+process.pid+'.part.mkv',fd=openSync(lock,'wx');
  try{const p=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-stream_loop','159','-i',original,'-map','0:v:0','-c:v','copy','-t','960','-fs',String(limit),'-n',temporary],{windowsHide:true,timeout:180000});assert.equal(p.status,0,String(p.stderr));verify(temporary);linkSync(temporary,source);}finally{closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);unlinkSync(lock);}
 }
 verify(source);
 const proof={scope:'Generated 960-second continuous stream-copy timeline; repeating six-second content, not unique motion',durationSec:960,packets:24000,encodedPacketsByteExact:true,sourceSha256:hash(original),sha256:hash(source),bytes:statSync(source).size,cacheLimitBytes:limit};
 const metadata=source+'.verified.json';if(!existsSync(metadata))writeFileSync(metadata,JSON.stringify(proof,null,2),{flag:'wx'});else assert.deepEqual(JSON.parse(readFileSync(metadata)),proof,'Long fixture metadata changed');
 return source;
}
