import {developmentIndependentRuntime} from './development-independent-runtime.mjs';
// Development startup only. Reuse verified runtimes and rebuild changed native
// sources before launching the real desktop process.
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const sources=['MpvCore.cs','D3dSurface.cs','RenderHost.cs','DisplayProbe.cs'].map(name=>'electron/native/render/'+name);
const manifestFile=path.join(root,'build/native-render/runtime.json');
const manifest=existsSync(manifestFile)?JSON.parse(readFileSync(manifestFile,'utf8')):null;
const host=path.join(root,'build/native-render/AVHubNativeRender.exe');
if(!manifest||!existsSync(host)||hash(host)!==manifest.hostSha256||sources.some((name,i)=>manifest.sources?.[i]?.name!==name||manifest.sources[i].sha256!==hash(path.join(root,name)))){
 execFileSync(process.execPath,['scripts/build-native-render.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
}
let candidate=process.env.AVHUB_RENDER_RUNTIME_CANDIDATE;
if(!candidate&&existsSync(path.join(root,'build/libmpv-chain-replay-latest.json'))){
 const staging=path.join(root,'build/replayed-render-staging.json');
 let folder=existsSync(staging)?JSON.parse(readFileSync(staging,'utf8')).folder:null;
 if(folder){
  folder=path.resolve(folder);
  if(path.dirname(folder).toLowerCase()!==path.join(root,'build').toLowerCase()||!/^render-replayed-candidate-[A-Za-z0-9]{6}$/.test(path.basename(folder)))throw new Error('原生开发运行库目录无效');
 }
 const info=folder&&existsSync(path.join(folder,'runtime.json'))?JSON.parse(readFileSync(path.join(folder,'runtime.json'),'utf8')):null;
 if(!info||sources.some((name,i)=>info.sources?.[i]?.name!==name||info.sources[i].sha256!==hash(path.join(root,name)))){
  execFileSync(process.execPath,['scripts/stage-selfbuilt-render-runtime.mjs','--replayed'],{cwd:root,stdio:'inherit',windowsHide:true});
  folder=JSON.parse(readFileSync(staging,'utf8')).folder;
 }
 candidate=path.basename(folder);
}
// A locally accepted compatibility DLL does not admit a packaged release.
const indexApproval=path.join(root,'build/mkv-index-runtime-acceptance.json');
if(!process.env.AVHUB_RENDER_RUNTIME_CANDIDATE&&candidate&&existsSync(indexApproval)){
 const approved=JSON.parse(readFileSync(indexApproval,'utf8')),{mkvIndexRenderPin}=require('../electron/dist/mkvIndexRenderPin.js');
 if(approved.schema===1&&approved.passed===true&&approved.dllSha256===mkvIndexRenderPin.dllSha256){
  const indexStaging=path.join(root,'build/mkv-index-runtime-staging.json');
  let staged=existsSync(indexStaging)?JSON.parse(readFileSync(indexStaging,'utf8')):null;
  if(staged&&(path.dirname(path.resolve(staged.folder)).toLowerCase()!==path.join(root,'build').toLowerCase()||!/^render-replayed-candidate-[A-Za-z0-9]{6}$/.test(path.basename(staged.folder))))throw new Error('索引兼容开发运行库目录无效');
  const info=staged&&existsSync(path.join(staged.folder,'runtime.json'))?JSON.parse(readFileSync(path.join(staged.folder,'runtime.json'),'utf8')):null;
  if(!info||info.dllSha256!==mkvIndexRenderPin.dllSha256||sources.some((name,i)=>info.sources?.[i]?.sha256!==hash(path.join(root,name)))){
   execFileSync(process.execPath,['scripts/stage-mkv-index-runtime.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
   staged=JSON.parse(readFileSync(indexStaging,'utf8'));
  }
  candidate=path.basename(staged.folder);
  writeFileSync(path.join(root,'build/replayed-render-staging.json'),JSON.stringify(staged,null,2));
 }
}
const {renderRuntimeLayout}=require('../electron/dist/renderRuntimeLayout.js');
const {verifyRenderRuntime}=require('../electron/dist/renderHostClient.js');
const runtime=renderRuntimeLayout(root,false,'',candidate);
if(candidate||existsSync(runtime.dll)){
 await verifyRenderRuntime(runtime);
 console.log(candidate?'内嵌 MPV · 发行同系运行库 '+candidate:'内嵌 MPV · 开发运行库');
}else console.log('内嵌 MPV 运行库尚未准备，播放设置中可查看可用引擎。');
const independentCandidate=developmentIndependentRuntime(root,process.env.AVHUB_MPV_RUNTIME_CANDIDATE);
if(independentCandidate){
 const {independentRuntimeLayout}=require('../electron/dist/independentRuntimeLayout.js'),{NativeRuntime}=require('../electron/dist/nativeRuntime.js');
 const selected=independentRuntimeLayout(root,false,'',independentCandidate);
 const status=await new NativeRuntime(()=>selected.executable,selected.manifest).check(true);if(!status.available)throw new Error(status.reason);
 console.log('独立 MPV · 已校验开发运行库 '+independentCandidate);
}
if(process.argv.includes('--check'))process.exit(0);
const env={...process.env,...(candidate?{AVHUB_RENDER_RUNTIME_CANDIDATE:candidate}:{}),...(independentCandidate?{AVHUB_MPV_RUNTIME_CANDIDATE:independentCandidate}:{})};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),['.'],{cwd:root,env,stdio:'inherit',windowsHide:false});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
