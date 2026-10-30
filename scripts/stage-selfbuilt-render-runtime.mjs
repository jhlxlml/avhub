// Explicit local test layout, not an application package or release approval.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,mkdtempSync,copyFileSync,lstatSync,realpathSync,statfsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const args=process.argv.slice(2),replayed=args.length===1&&args[0]==='--replayed';
if(args.length&&!replayed)throw new Error('Expected no arguments or explicit --replayed');
const {selfBuiltRenderPin}=require('../electron/dist/selfBuiltRenderPin.js');
const pin=replayed?require('../electron/dist/replayedRenderPin.js').replayedRenderPin:selfBuiltRenderPin;
const declared=JSON.parse(readFileSync(path.join(root,replayed?'ci/replayed-render-runtime.json':'ci/self-built-render-runtime.json'),'utf8'));
if(JSON.stringify(pin)!==JSON.stringify(declared))throw new Error('Rebuild Electron: compiled candidate pin differs');
const build=path.join(root,'build'),source=JSON.parse(readFileSync(path.join(build,replayed?'libmpv-chain-replay-latest.json':'libmpv-windows-cross-latest.json'),'utf8')).folder;
const nativeFolder=path.join(build,path.posix.basename(source));
const native=JSON.parse(readFileSync(path.join(nativeFolder,'report.json'),'utf8'));
const tests=JSON.parse(readFileSync(path.join(nativeFolder,'windows-tests.json'),'utf8'));
const imports=JSON.parse(readFileSync(path.join(nativeFolder,'import-audit.json'),'utf8'));
if(!native.buildPassed||!tests.passed||!imports.windowsOsImportsResolved||native.source.revision!==pin.sourceRevision)throw new Error('Self-built cohort prerequisites incomplete');
const host=JSON.parse(readFileSync(path.join(build,'native-render/runtime.json'),'utf8'));
const ffi=JSON.parse(readFileSync(path.join(root,'ci/render-ffi/runtime-manifest.json'),'utf8'));
const files=[
 {from:path.join(build,'native-render/AVHubNativeRender.exe'),to:'AVHubNativeRender.exe',sha256:host.hostSha256},
 {from:path.join(nativeFolder,'install/bin/libmpv-2.dll'),to:'libmpv-2.dll',sha256:pin.dllSha256},
 ...pin.dependencies.map(file=>({from:path.join(nativeFolder,'install/bin',file.name),to:file.name,sha256:file.sha256})),
 ...host.sources.map(file=>({from:path.join(root,file.name),to:'source/'+file.name,sha256:file.sha256})),
 ...ffi.files.map(file=>({from:path.join(build,'libmpv-render-spike/ffi',file.name),to:'ffi/'+file.name,sha256:file.sha256})),
];
const materials={schema:1,scope:'local-SDR-candidate-materials-inventory-not-distribution-approval',subject:pin,sourceArchives:[],buildRecords:[],noticeGaps:[],distributionReady:false};
const stages=[nativeFolder,...Object.values(native.dependencyStages).map(value=>path.join(root,value))];
const ff=JSON.parse(readFileSync(path.join(stages[1],'report.json'),'utf8'));
if(ff.dav1dDependency)stages.push(path.join(root,ff.dav1dDependency));
const ids=new Set();
for(const stage of stages){
 const record=JSON.parse(readFileSync(path.join(stage,'report.json'),'utf8'));
 materials.buildRecords.push(path.relative(root,stage).replaceAll('\\','/')+'/report.json');
 files.push({from:path.join(stage,'report.json'),to:'materials/builds/'+path.basename(stage)+'.json'});
 const sources=record.sources??record.components??[record.source??{id:'ffmpeg',revision:record.sourceRevision}];
 for(const item of sources)if(item.id)ids.add(item.id);
}
for(const id of ids){
 const entries=readdirSync(path.join(build,'native-git-inputs')).filter(n=>n.startsWith(id+'-')&&n.endsWith('.json'));
 // Match the exact revision observed by the completed build, not a new ref.
 const records=entries.map(n=>JSON.parse(readFileSync(path.join(build,'native-git-inputs',n),'utf8')));
 const used=records.filter(record=>stages.some(stage=>{
  const info=JSON.parse(readFileSync(path.join(stage,'report.json'),'utf8'));
  return [...(info.sources??[]),...(info.components??[]),...(info.source?[info.source]:[]),...(info.sourceRevision?[{id:'ffmpeg',revision:info.sourceRevision}]:[])].some(item=>item.id===id&&item.revision===record.revision);
 }));
 if(used.length!==1)throw new Error('Ambiguous built source: '+id);
 const record=used[0],archive=path.join(root,record.archive);
 if(createHash('sha256').update(readFileSync(archive)).digest('hex')!==record.archiveSha256)throw new Error('Source archive changed: '+id);
 materials.sourceArchives.push(record);
 const tree=path.join(root,record.sourceFolder);let found=0;
 for(const sub of ['', 'docs']){
  const directory=path.join(tree,sub);if(!lstatSync(directory,{throwIfNoEntry:false})?.isDirectory())continue;
  for(const name of readdirSync(directory))if(/^(licen[cs]e|copying|copyright|notice|ftl|gpl)([._-]|$)/i.test(name)){
   const file=path.join(directory,name);if(!lstatSync(file).isFile())continue;
   files.push({from:file,to:'materials/notices/'+id+'/'+(sub?sub+'/':'')+name});found++;
  }
 }
 if(!found)materials.noticeGaps.push(id);
}
const supportFolder=path.join(build,'native-support-materials');
const support=JSON.parse(readFileSync(path.join(supportFolder,'report.json'),'utf8'));
const supportDlls=support.files.filter(file=>file.name.endsWith('.dll'));
if(support.cohort!==selfBuiltRenderPin.id||support.distributionReady!==false||supportDlls.length!==4||supportDlls.some(file=>!pin.dependencies.some(dep=>dep.name===file.name&&dep.sha256===file.sha256)))throw new Error('Support runtime provenance differs from candidate');
materials.supportRuntime={report:'materials/support-runtime.json',verifiedDlls:4,correspondingSourceComplete:false};
files.push({from:path.join(supportFolder,'report.json'),to:'materials/support-runtime.json'});
for(const file of support.files.filter(file=>file.noticeFile)){
 if(!/^notices\/(gcc-mingw-w64-base|mingw-w64-common)\/copyright$/.test(file.noticeFile))throw new Error('Unknown support notice path');
 files.push({from:path.join(supportFolder,file.noticeFile),to:'materials/'+file.noticeFile,sha256:file.sha256});
}
files.push({from:path.join(root,'LICENSE'),to:'materials/notices/avhub/LICENSE',sha256:support.projectLicense.sha256});
materials.noticeGaps.push('GCC/MinGW notices and runtime origins captured; exact corresponding-source delivery/review pending');
materials.releaseBlockers=['Corresponding-source bundle and notices review pending','New cohort Electron quality/function/endurance pending','Clean-machine and packaged acceptance pending'];
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
for(const file of files){
 const info=lstatSync(file.from);
 if(!info.isFile()||info.isSymbolicLink()||realpathSync(file.from).toLowerCase()!==path.resolve(file.from).toLowerCase()||info.size>256*1024**2)throw new Error('Invalid owned candidate input');
 const actual=hash(file.from);if(file.sha256&&actual!==file.sha256)throw new Error('Candidate input changed: '+file.to);
 file.sha256=actual;file.size=info.size;
}
const disk=statfsSync(build);if(disk.bavail*disk.bsize<files.reduce((n,f)=>n+f.size,0)+256*1024**2)throw new Error('Insufficient candidate space');
const folder=mkdtempSync(path.join(build,replayed?'render-replayed-candidate-':'render-selfbuilt-candidate-'));
for(const file of files){const destination=path.join(folder,file.to);mkdirSync(path.dirname(destination),{recursive:true});copyFileSync(file.from,destination,1);}
writeFileSync(path.join(folder,'runtime.json'),JSON.stringify({...host,dllSha256:pin.dllSha256,cohort:pin.id,dependencies:pin.dependencies,productionDistributionReady:false},null,2));
writeFileSync(path.join(folder,'ffi/runtime-manifest.json'),JSON.stringify(ffi,null,2));
writeFileSync(path.join(folder,'materials.json'),JSON.stringify(materials,null,2));
const layout={schema:1,folder,scope:pin.scope,distributionReady:false,files:files.map(({to,size,sha256})=>({path:to,size,sha256}))};
writeFileSync(path.join(folder,'layout.json'),JSON.stringify(layout,null,2));
writeFileSync(path.join(build,replayed?'replayed-render-staging.json':'selfbuilt-render-staging.json'),JSON.stringify(layout,null,2));
console.log(JSON.stringify({folder,files:files.length,sourceArchives:materials.sourceArchives.length,noticeGaps:materials.noticeGaps,distributionReady:false}));
