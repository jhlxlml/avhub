// Immutable test-media storage. Never link, chmod or rewrite original media.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const project=path.resolve(import.meta.dirname,'../..'),build=path.join(project,'build');
export const testMediaRoot=path.join(build,'test-media');
const owner='{"owner":"avhub-test-media","schema":1}\n';
const video=(seconds,gop,output,transport=false)=>['-f','lavfi','-i','testsrc2=s=1280x720:r=30','-f','lavfi','-i','sine=f=700:r=48000','-t',String(seconds),'-c:v','libx264','-preset','fast','-g',String(gop),...(transport?['-keyint_min',String(gop),'-sc_threshold','0']:[]),'-c:a','aac','-n',output];
const profiles={
 basic:{file:'Basic.mp4',codec:'h264',width:640,height:360,min:5.9,max:6.2,steps:[['-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','50','-keyint_min','50','-sc_threshold','0','-c:a','aac','-n','Basic.mp4']]},
 hevc4k:{file:'HEVC4K.mkv',codec:'hevc',width:3840,height:2160,min:959,max:966,steps:[['-f','lavfi','-i','testsrc2=s=3840x2160:r=25','-f','lavfi','-i','sine=f=700:r=48000','-t','6','-c:v','libx265','-preset','ultrafast','-pix_fmt','yuv420p10le','-g','240','-keyint_min','240','-sc_threshold','0','-x265-params','pools=4:frame-threads=2:log-level=error','-c:a','aac','-n','Clip.mkv'],['-f','concat','-safe','1','-i','repeat.txt','-c','copy','-n','HEVC4K.mkv']]},
 transport8:{file:'Transport.ts',codec:'h264',width:1280,height:720,min:8,max:8.2,steps:[video(8,240,'Transport.ts')]},
 longGop38:{file:'LongGop.mp4',codec:'h264',width:1280,height:720,min:37.9,max:38.2,steps:[video(38,240,'LongGop.mp4',true)]},
 transport38:{file:'Transport.ts',codec:'h264',width:1280,height:720,min:38,max:38.2,steps:[video(38,60,'Transport.ts',true)]},
 transportLong38:{file:'Transport.ts',codec:'h264',width:1280,height:720,min:38,max:38.2,steps:[video(38,240,'Transport.ts',true)]},
};
export function mediaHash(file){const hash=createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(8*1024**2);try{let length;while((length=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,length));}finally{fs.closeSync(fd);}return hash.digest('hex');}
function regular(file){const info=fs.lstatSync(file);assert.ok(info.isFile()&&!info.isSymbolicLink(),'Fixture must be a regular file');return info;}
function directory(file){assert.ok(fs.lstatSync(build).isDirectory()&&!fs.lstatSync(build).isSymbolicLink(),'No redirected build root');const absolute=path.resolve(file);assert.ok(absolute.startsWith(build+path.sep),'Test-media storage must stay in project build');for(let current=absolute;current!==build;current=path.dirname(current))if(fs.existsSync(current))assert.ok(fs.lstatSync(current).isDirectory()&&!fs.lstatSync(current).isSymbolicLink(),'No redirected fixture directories');return absolute;}

export function createMediaPool(base=testMediaRoot){
 fs.mkdirSync(build,{recursive:true});base=directory(base);fs.mkdirSync(base,{recursive:true});const marker=path.join(base,'.avhub-owner.json');
 if(!fs.existsSync(marker)){assert.equal(fs.readdirSync(base).length,0,'Refuse unowned nonempty media pool');fs.writeFileSync(marker,owner,{flag:'wx'});}regular(marker);assert.equal(fs.readFileSync(marker,'utf8'),owner);
 const verify=folder=>{directory(folder);const manifestFile=path.join(folder,'fixture.json');regular(manifestFile);assert.ok(fs.statSync(manifestFile).size<65536);const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  assert.ok(manifest.schema===1&&typeof manifest.id==='string'&&Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<8,'Invalid fixture manifest');
  assert.equal(manifest.id,path.basename(folder),'Fixture version mismatch');
  for(const entry of manifest.files){assert.ok(typeof entry.name==='string'&&entry.name===path.basename(entry.name)&&!entry.name.includes('..')&&Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&typeof entry.sha256==='string'&&/^[a-f0-9]{64}$/.test(entry.sha256),'Invalid fixture identity');const file=path.join(folder,entry.name),info=regular(file);assert.equal(info.size,entry.bytes,'Fixture size changed');assert.equal(mediaHash(file),entry.sha256,'Fixture checksum changed; do not silently regenerate');}
  assert.ok(manifest.files.some(entry=>entry.name===manifest.primary),'Invalid primary fixture');return path.join(folder,manifest.primary);
 };
 const reserve=bytes=>{let used=0;for(const entry of fs.readdirSync(base,{withFileTypes:true})){if(!entry.isDirectory())continue;const folder=path.join(base,entry.name);directory(folder);for(const item of fs.readdirSync(folder,{withFileTypes:true})){assert.ok(!item.isSymbolicLink(),'Redirected pool object');if(item.isFile())used+=fs.statSync(path.join(folder,item.name)).size;}}
  assert.ok(used+bytes<=24*1024**3,'Test media pool limit is 24 GiB; review idle versions explicitly');const disk=fs.statfsSync(base);assert.ok(disk.bavail*disk.bsize>bytes+1024**3,'Insufficient test-media headroom');
 };
 const publish=(stage,folder,id,primary,origin)=>{const files=fs.readdirSync(stage).filter(name=>/\.(mp4|mkv|ts|mov|avi|webm)$/i.test(name)).map(name=>{const file=path.join(stage,name),info=regular(file);return {name,bytes:info.size,sha256:mediaHash(file)};});assert.ok(files.length);files.forEach(entry=>fs.chmodSync(path.join(stage,entry.name),0o444));fs.writeFileSync(path.join(stage,'fixture.json'),JSON.stringify({schema:1,id,primary,origin,files},null,2)+'\n',{flag:'wx'});fs.renameSync(stage,folder);return verify(folder);};
 const probe=(file,profile)=>{const run=spawnSync(path.join(project,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,pix_fmt','-show_entries','format=duration','-of','json',file],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(run.status,0,run.stderr);const data=JSON.parse(run.stdout),stream=data.streams[0];assert.equal(stream.codec_name,profile.codec);assert.equal(stream.width,profile.width);assert.equal(stream.height,profile.height);assert.ok(Number(data.format.duration)>=profile.min&&Number(data.format.duration)<=profile.max,'Fixture duration mismatch');if(profile.codec==='hevc')assert.equal(stream.pix_fmt,'yuv420p10le');};
 const get=(name,adopt)=>{assert.ok(Object.hasOwn(profiles,name),'Unknown fixture profile');const profile=profiles[name],id=name+'-'+createHash('sha256').update(JSON.stringify({revision:1,profile})).digest('hex').slice(0,16),folder=path.join(base,id);if(fs.existsSync(folder))return verify(folder);
  reserve(name==='hevc4k'?2*1024**3:64*1024**2);const stage=fs.mkdtempSync(path.join(base,'.staging-'));
  if(adopt){const source=path.resolve(adopt);directory(path.dirname(source));regular(source);probe(source,profile);fs.linkSync(source,path.join(stage,profile.file));}
  else{if(name==='hevc4k')fs.writeFileSync(path.join(stage,'repeat.txt'),Array.from({length:160},()=>"file 'Clip.mkv'").join('\n'));for(const args of profile.steps){const run=spawnSync(path.join(project,'bin/ffmpeg.exe'),['-v','error',...args],{cwd:stage,windowsHide:true,encoding:'utf8',timeout:180000});assert.equal(run.status,0,run.stderr||String(run.error));}probe(path.join(stage,profile.file),profile);}
  reserve(0);return publish(stage,folder,id,profile.file,{kind:adopt?'adopted-owned-generated':'generated',recipe:profile});
 };
 const imported=(source,{ownedGenerated=false}={})=>{source=path.resolve(source);const info=regular(source);assert.ok(/\.(mp4|mkv|ts|mov|avi|webm)$/i.test(source),'Only video fixtures');const sha256=mediaHash(source),id='import-'+sha256,folder=path.join(base,id);if(fs.existsSync(folder))return verify(folder);reserve(info.size);const stage=fs.mkdtempSync(path.join(base,'.staging-')),name='Media'+path.extname(source).toLowerCase();
  if(ownedGenerated){directory(path.dirname(source));fs.linkSync(source,path.join(stage,name));}else fs.copyFileSync(source,path.join(stage,name),fs.constants.COPYFILE_EXCL);
  const after=regular(source);assert.equal(after.size,info.size);assert.equal(after.mtimeMs,info.mtimeMs);assert.equal(mediaHash(path.join(stage,name)),sha256,'Import changed while being copied');return publish(stage,folder,id,name,{kind:ownedGenerated?'owned-generated-reference':'original-read-only-snapshot',sourcePathHash:createHash('sha256').update(source).digest('hex'),sourceBytes:info.size,sourceMtimeMs:info.mtimeMs});
 };
 const place=(source,destination,{mutable=false,ownedGenerated=false}={})=>{destination=path.resolve(destination);directory(path.dirname(destination));assert.ok(!fs.existsSync(destination),'Never overwrite a test fixture');let canonical;
  if(path.resolve(source).startsWith(base+path.sep)){canonical=verify(path.dirname(source));assert.equal(path.resolve(source),canonical,'Place primary fixture only');}else canonical=imported(source,{ownedGenerated});
  if(mutable){fs.copyFileSync(canonical,destination,fs.constants.COPYFILE_EXCL);fs.chmodSync(destination,0o666);const now=new Date();fs.utimesSync(destination,now,now);}else{fs.linkSync(canonical,destination);fs.chmodSync(canonical,0o444);}
  const entry={schema:1,target:path.basename(destination),fixture:path.relative(base,canonical),sha256:mediaHash(canonical),bytes:fs.statSync(canonical).size,mode:mutable?'private-mutable-copy':'read-only-hardlink'};fs.appendFileSync(path.join(path.dirname(destination),'.avhub-test-media.jsonl'),JSON.stringify(entry)+'\n');return destination;
 };
 const list=()=>fs.readdirSync(base,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.')).map(entry=>{const primary=verify(path.join(base,entry.name)),info=fs.statSync(primary);return {id:entry.name,primary,bytes:info.size,links:info.nlink};});
 const generate=(args,options={})=>{assert.ok(Array.isArray(args)&&args.length>1&&args.every(arg=>typeof arg==='string'));const destination=path.resolve(args.at(-1));directory(path.dirname(destination));const extension=path.extname(destination).toLowerCase();assert.ok(/\.(mp4|mkv|ts|mov|avi|webm)$/.test(extension),'Unsupported fixture container');
  const inputs=[];const normalized=args.slice(0,-1).map((arg,index)=>{if(args[index-1]==='-i'&&fs.existsSync(arg)){const info=regular(arg),sha256=mediaHash(arg);inputs.push({file:arg,bytes:info.size,mtime:info.mtimeMs,sha256});return {inputSha256:sha256,extension:path.extname(arg).toLowerCase()};}return arg;});
  const id='recipe-'+createHash('sha256').update(JSON.stringify({revision:1,args:normalized,extension})).digest('hex'),folder=path.join(base,id);let canonical;
  if(fs.existsSync(folder))canonical=verify(folder);
  else{reserve(64*1024**2);const stage=fs.mkdtempSync(path.join(base,'.staging-')),name='Media'+extension;const run=spawnSync(path.join(project,'bin/ffmpeg.exe'),[...args.slice(0,-1),'-n',path.join(stage,name)],{windowsHide:true,encoding:'utf8',timeout:180000});assert.equal(run.status,0,run.stderr||String(run.error));
   for(const input of inputs){const info=regular(input.file);assert.equal(info.size,input.bytes);assert.equal(info.mtimeMs,input.mtime);assert.equal(mediaHash(input.file),input.sha256,'Fixture input changed during generation');}reserve(0);canonical=publish(stage,folder,id,name,{kind:'generated-recipe',args:normalized});}
  place(canonical,destination,options);return {status:0,stderr:'',stdout:'',fixture:canonical};
 };
 const checked=file=>{assert.ok(path.resolve(file).startsWith(base+path.sep),'Fixture outside media pool');const primary=verify(path.dirname(file));assert.equal(path.resolve(file),primary);return primary;};
 return {root:base,get,adopt:(name,source)=>get(name,source),imported,place,list,checked,generate};
}
let shared;
export function sharedMedia(){return shared??=createMediaPool();}
export function placeTestMedia(source,destination,options){return sharedMedia().place(source,destination,options);}
export function generateTestMedia(args,options){return sharedMedia().generate(args,options);}
