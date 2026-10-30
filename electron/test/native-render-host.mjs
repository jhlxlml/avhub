// Real libmpv control/D3D host test on generated owned fixtures. No Electron
// compositor or audible output proof: those require the separate desktop suite.
import assert from 'node:assert/strict';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});const folder=mkdtempSync(path.join(root,'build/native-render-host-'));
execFileSync(process.execPath,[path.join(root,'scripts/build-native-render.mjs')],{cwd:root,windowsHide:true,stdio:'inherit'});
const subtitle=path.join(folder,'test.srt'),source=path.join(folder,'test.mkv');writeFileSync(subtitle,'1\n00:00:00,000 --> 00:00:12,000\nAVHub real native subtitle\n');
const generated=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-i',subtitle,'-map','0:v','-map','1:a','-map','2:a','-map','3:s','-t','12','-c:v','libx264','-g','25','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-c:a','aac','-c:s','srt',source],{windowsHide:true,timeout:30000,encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
const identity=()=>({hash:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs});const before=identity();
const host=spawn(path.join(root,'build/native-render/AVHubNativeRender.exe'),[path.join(root,'build/libmpv-d3d11-input/runtime/libmpv-2.dll')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const waiters=new Map();let seq=0,stderr='',exit,failed;host.stderr.on('data',d=>stderr+=String(d));const exited=new Promise(resolve=>host.once('exit',(code)=>{exit=code;for(const p of waiters.values())p.reject(new Error('Host exited '+code+' '+stderr));waiters.clear();resolve(code);}));
const lines=createInterface({input:host.stdout});lines.on('line',line=>{const r=JSON.parse(line),pending=waiters.get(r.id);if(pending){waiters.delete(r.id);r.error?pending.reject(new Error(r.error)):pending.resolve(r.result);}});
host.stdin.on('error',e=>{for(const p of waiters.values())p.reject(e);waiters.clear();});
async function command(action,extra={}){const id=++seq;let timer;try{return await Promise.race([new Promise((resolve,reject)=>{waiters.set(id,{resolve,reject});host.stdin.write(JSON.stringify({id,action,...extra})+'\n');}),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Timeout '+action)),12000))]);}finally{clearTimeout(timer);waiters.delete(id);}}
async function snapshot(){const s=await command('snapshot');assert.equal(s.error,null,JSON.stringify(s));if(s.frame.waiting)await command('ack',{value:s.frame.serial});return s;}
async function until(check){const start=Date.now();let s;do{s=await snapshot();if(check(s))return s;await delay(25);}while(Date.now()-start<10000);throw new Error('Native condition timed out: '+JSON.stringify(s));}
const report={kind:'real-native-host-not-electron',folder,runtime:JSON.parse(readFileSync(path.join(root,'build/native-render/runtime.json'),'utf8')),sourceBefore:before};
try{
 await command('open',{path:source,width:640,height:360,depth:8,primaries:'bt709',transfer:'bt709',matrix:'bt709',hdr:false,startSec:2,autoplay:false});
 const opened=await until(s=>s.loaded&&s.properties['track-list']?.length===4);report.opened=opened;
 assert.equal(opened.properties.pause,true);assert.ok(Math.abs(opened.properties['time-pos']-2)<.1);assert.equal(opened.properties['video-params'].w,640);assert.ok(opened.properties['track-list'].every(t=>typeof t==='object'));
 const audioId=opened.properties['track-list'].filter(t=>t.type==='audio')[1].id,subtitleId=opened.properties['track-list'].find(t=>t.type==='sub').id;
 await command('mute',{value:true});await command('volume',{value:.3});await command('rate',{value:1.5});await command('track',{value:{type:'audio',id:audioId}});await command('track',{value:{type:'subtitle',id:subtitleId}});await command('subtitle-delay',{value:.5});
 const changed=await until(s=>s.properties.aid===audioId&&s.properties.sid===subtitleId&&s.properties['sub-delay']===.5);assert.equal(changed.properties.volume,30);assert.equal(changed.properties.mute,true);assert.equal(changed.properties.speed,1.5);
 await assert.rejects(command('track',{value:{type:'audio',id:999}}),/does not belong/);await assert.rejects(command('volume',{value:2}),/Invalid/);await assert.rejects(command('unknown'),/Unsupported/);
 report.seeks=[];for(const [i,point] of [7,1,10,4].entries()){await command('seek',{value:{seconds:point,seekId:i+1}});const s=await until(s=>s.frame.seekId===i+1&&Math.abs(s.frame.positionSec-point)<.1);report.seeks.push({point,frame:s.frame});}
 await command('subtitle-add',{value:subtitle});await until(s=>s.properties['track-list'].length===5);
 const screenshot=path.join(folder,'frame.png');await command('screenshot',{value:screenshot});assert.ok(statSync(screenshot).size>1000);const png=readFileSync(screenshot);assert.equal(png.readUInt32BE(16),640);assert.equal(png.readUInt32BE(20),360);await assert.rejects(command('screenshot',{value:screenshot}),/Invalid/);
 await command('play');await until(s=>s.properties.pause===false&&s.properties['time-pos']>4.1);await command('pause');const paused=await until(s=>s.properties.pause===true);report.paused=paused;
 // These acknowledgements simulate GPU-reader drain only. They are NOT claims
 // that the Electron compositor has received any of the native textures.
 await command('quiesce');await snapshot();await command('quit');assert.equal(await exited,0);
 assert.deepEqual(identity(),before);report.sourceAfter=identity();report.passed=true;
}catch(e){failed=e;report.passed=false;report.error=String(e.stack||e);if(exit===undefined)host.kill();await exited;}
finally{lines.close();report.exit=exit;report.stderr=stderr;writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(folder,'report.json'),exit}));}
if(failed)throw failed;
