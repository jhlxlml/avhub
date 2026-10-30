// Relocated resources/native-host harness. Not an Electron package or clean PC.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,cpSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url);
const {resolveRenderRuntime}=require('../dist/renderRuntimeLayout.js');
const {RenderHostClient,verifyRenderRuntime}=require('../dist/renderHostClient.js');
const stage=JSON.parse(readFileSync(path.join(root,'build/replayed-render-staging.json'),'utf8')).folder;
const folder=mkdtempSync(path.join(root,'build/render-local-resources-')),resources=path.join(folder,'resources');
mkdirSync(resources);cpSync(stage,path.join(resources,'native-render'),{recursive:true,errorOnExist:true,force:false});
const previousCandidate=process.env.AVHUB_RENDER_RUNTIME_CANDIDATE;
process.env.AVHUB_RENDER_RUNTIME_CANDIDATE=path.basename(stage);
const config=require('../native-render.builder.cjs');await config.beforePack();
const marker=config.extraResources.find(r=>r.to==='local-render-acceptance.json');assert.ok(marker);
copyFileSync(marker.from,path.join(resources,'local-render-acceptance.json'));
if(previousCandidate===undefined)delete process.env.AVHUB_RENDER_RUNTIME_CANDIDATE;else process.env.AVHUB_RENDER_RUNTIME_CANDIDATE=previousCandidate;
const runtime=resolveRenderRuntime(root,true,resources,undefined,'1');
const source=path.join(folder,'Owned.mp4');copyFileSync(path.join(root,'build/libmpv-render-spike/samples/Framecode-v2-640x360.mp4'),source);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),sourceHash=hash(source);
const report={kind:'relocated-native-resources-harness-not-packaged-electron',scope:'Actual copied native closure, D3D host and screenshot pixels; system-only PATH; compiler/toolchain not required at launch; same machine, no packaged Electron or clean-machine claim',runtime:await verifyRenderRuntime(runtime),sourceSha256:sourceHash,passed:false};
const originalPath=process.env.PATH;
process.env.PATH=[path.join(process.env.WINDIR,'System32'),process.env.WINDIR].join(path.delimiter);
const client=new RenderHostClient(runtime,{drain:async()=>{}});
async function until(predicate){
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){const s=await client.snapshot();assert.equal(s.error,null);if(s.frame.waiting)await client.acknowledge(s.frame.serial);if(predicate(s))return s;await delay(15);}
 throw new Error('Relocated native target timeout');
}
try{
 await client.open({path:source,contract:{width:640,height:360,depth:8,primaries:'bt709',transfer:'bt709',matrix:'bt709',range:'tv',hdr:false},startSec:0,autoplay:false});
 await until(s=>s.loaded&&s.properties['video-params']);
 await client.control('seek',{seconds:1.24,seekId:1});
 const state=await until(s=>s.frame.seekId===1&&Math.abs(s.frame.positionSec-1.24)<.1);report.target=state.frame;
 const file=path.join(folder,'target.png');await client.captureOwnedPng(file);const png=readFileSync(file);
 assert.equal(png.readUInt32BE(16),640);assert.equal(png.readUInt32BE(20),360);
 const decoded=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true,timeout:30000,maxBuffer:2*1024**2});
 assert.equal(decoded.status,0);assert.equal(decoded.stdout.length,640*360*3);
 let code=0;for(let b=0;b<16;b++){const at=(32*640+Math.floor((b+.5)*640/16))*3,r=decoded.stdout[at],g=decoded.stdout[at+1],blue=decoded.stdout[at+2];assert.ok(Math.abs(r-g)<12&&Math.abs(r-blue)<12&&(r<60||r>180));if(r>180)code+=2**b;}
 assert.equal(code,31);report.screenshot={width:640,height:360,frameCode:code};
 assert.equal(hash(source),sourceHash);report.checksPassed=true;
}catch(error){report.error=String(error.stack||error);throw error;}
finally{
 await client.close().then(()=>{report.helperAliveAfterClose=client.alive;},error=>{report.cleanupError=String(error);});
 if(originalPath===undefined)delete process.env.PATH;else process.env.PATH=originalPath;
 report.passed=report.checksPassed===true&&report.helperAliveAfterClose===false&&!report.cleanupError;
 writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(folder,'report.json')}));
 if(report.checksPassed)assert.equal(report.passed,true,'Relocated helper cleanup failed');
}
