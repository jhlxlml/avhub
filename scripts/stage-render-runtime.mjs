// Build a local runtime directory for subsequent layout tests, not an EXE/ZIP.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,lstatSync,realpathSync,openSync,readSync,closeSync,statfsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditRenderDistribution} from './audit-render-distribution.mjs';

export function stageRenderRuntime(root){
 const audit=auditRenderDistribution(root);
 if(!audit.runtimeVerified)throw new Error('Runtime inventory failed: '+audit.integrityProblems.join('; '));
 const pin=JSON.parse(readFileSync(path.join(root,'ci/vulkan-runtime.json'),'utf8'));
 const loaderRoot=path.join(root,'build/vulkan-runtime-input/runtime');
 const loader=JSON.parse(readFileSync(path.join(loaderRoot,'runtime.json'),'utf8'));
 if(loader.platform!=='windows-x64'||loader.archiveSha256!==pin.archiveSha256||loader.sourceCommit!==pin.sourceCommit||loader.files?.length!==3||loader.files[0].name!=='vulkan-1.dll'||loader.files[1].name!=='LICENSE.txt'||loader.files[1].sha256!==pin.licenseSha256||loader.files[2].name!=='VulkanRT-License.txt'||loader.files[2].sha256!==pin.archiveLicenseSha256)throw new Error('Vulkan runtime not bound to pinned input');
 const host=JSON.parse(readFileSync(path.join(root,'build/native-render/runtime.json'),'utf8'));
 const ffi=JSON.parse(readFileSync(path.join(root,'ci/render-ffi/runtime-manifest.json'),'utf8'));
 const materials=JSON.parse(readFileSync(path.join(root,'third_party/libmpv-render-d3d11/materials.json'),'utf8'));
 if(materials.subject.dllSha256!==audit.subject.dllSha256)throw new Error('Source/notice materials belong to another libmpv runtime');
 const mappings=[
  ...audit.files.filter(f=>f.path==='build/native-render/AVHubNativeRender.exe').map(f=>({...f,to:'AVHubNativeRender.exe'})),
  ...audit.files.filter(f=>f.path==='build/libmpv-d3d11-input/runtime/libmpv-2.dll').map(f=>({...f,to:'libmpv-2.dll'})),
  ...audit.files.filter(f=>f.path.startsWith('electron/native/render/')).map(f=>({...f,to:'source/'+f.path})),
  ...audit.files.filter(f=>f.path.startsWith('build/libmpv-render-spike/ffi/')).map(f=>({...f,to:'ffi/'+f.path.slice('build/libmpv-render-spike/ffi/'.length)})),
  ...loader.files.map(f=>({...f,path:'build/vulkan-runtime-input/runtime/'+f.name,to:f.name==='vulkan-1.dll'?f.name:'licenses/vulkan-loader-'+f.name})),
  ...['LICENSE.GPL','Copyright'].map(n=>({path:'third_party/libmpv-render-d3d11/'+n,to:'licenses/libmpv-'+n})),
  ...materials.exactProjectSources.flatMap(source=>source.notices.map(file=>({...file,to:'licenses/'+source.id+'/'+path.basename(file.path)}))),
  {path:'third_party/libmpv-render-d3d11/materials.json',to:'licenses/build-materials.json'},
  {path:'third_party/libmpv-render-d3d11/build-observations.json',to:'licenses/build-observations.json'},
 ];
 // Verify every source before creating the candidate directory. Never borrow a
 // System32 DLL, follow redirected paths or overwrite a previous candidate.
 for(const item of mappings){
  const file=path.resolve(root,item.path),info=lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink()||realpathSync(file).toLowerCase()!==file.toLowerCase()||info.size>256*1024**2||item.size!==undefined&&item.size!==info.size)throw new Error('Invalid runtime source: '+item.path);
  const hash=createHash('sha256'),fd=openSync(file,'r'),chunk=Buffer.allocUnsafe(1024**2);
  try{let count;while((count=readSync(fd,chunk,0,chunk.length,null))>0)hash.update(chunk.subarray(0,count));}finally{closeSync(fd);}
  const sha256=hash.digest('hex');if(item.sha256&&item.sha256!==sha256)throw new Error('Runtime source changed: '+item.path);item.sha256=sha256;item.size=info.size;
 }
 const build=path.join(root,'build');if(realpathSync(build).toLowerCase()!==build.toLowerCase())throw new Error('Redirected build directory');
 const disk=statfsSync(build);if(disk.bavail*disk.bsize<mappings.reduce((sum,item)=>sum+item.size,0)+256*1024**2)throw new Error('Insufficient free space for native runtime candidate');
 const folder=mkdtempSync(path.join(build,'render-runtime-candidate-'));
 for(const item of mappings){const target=path.join(folder,item.to);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(root,item.path),target,1);}
 writeFileSync(path.join(folder,'runtime.json'),JSON.stringify({...host,productionDistributionReady:false,dependencies:loader.files.filter(f=>f.name.endsWith('.dll'))},null,2));
 writeFileSync(path.join(folder,'ffi/runtime-manifest.json'),JSON.stringify(ffi,null,2));
 const layout={schema:1,scope:'local-runtime-layout-candidate-not-packaged-acceptance',distributionReady:false,host:'AVHubNativeRender.exe',dll:'libmpv-2.dll',manifest:'runtime.json',sourceRoot:'source',ffiRoot:'ffi',ffiManifest:'ffi/runtime-manifest.json',subject:audit.subject,files:mappings.map(({to,size,sha256})=>({path:to,size,sha256})),releaseBlockers:audit.releaseBlockers};
 writeFileSync(path.join(folder,'layout.json'),JSON.stringify(layout,null,2));
 return {folder,layout};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(stageRenderRuntime(path.resolve(import.meta.dirname,'..')),null,2));
