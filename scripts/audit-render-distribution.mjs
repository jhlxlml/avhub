// Offline M5 inventory. Does not launch, copy, download, package or approve a runtime.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,readSync,closeSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function auditRenderDistribution(root){
 const files=[],integrityProblems=[],releaseBlockers=[];
 const json=name=>JSON.parse(readFileSync(path.join(root,name),'utf8'));
 function verify(name,sha256,size){
  const file=path.resolve(root,name);
  try{
   const info=lstatSync(file);
   if(!info.isFile()||info.isSymbolicLink()||realpathSync(file).toLowerCase()!==file.toLowerCase()||info.size>1024**3||size!==undefined&&info.size!==size)throw new Error('invalid file or size');
   const hash=createHash('sha256'),fd=openSync(file,'r'),chunk=Buffer.allocUnsafe(1024**2);
   try{let count;while((count=readSync(fd,chunk,0,chunk.length,null))>0)hash.update(chunk.subarray(0,count));}finally{closeSync(fd);}
   const actual=hash.digest('hex');if(actual!==sha256)throw new Error('checksum mismatch');
   files.push({path:name,size:info.size,sha256:actual});
  }catch(error){integrityProblems.push(`${name}: ${error.message}`);}
 }
 const candidate=json('ci/libmpv-d3d11-candidate.json'),host=json('build/native-render/runtime.json'),ffi=json('ci/render-ffi/runtime-manifest.json');
 if(host.protocol!==1||host.platform!=='win32-x64'||host.dllSha256!==candidate.dllSha256)integrityProblems.push('Host protocol/platform/DLL identity differs from fixed candidate');
 verify('build/native-render/AVHubNativeRender.exe',host.hostSha256);
 const sourceNames=['MpvCore.cs','D3dSurface.cs','RenderHost.cs','DisplayProbe.cs'].map(n=>'electron/native/render/'+n);
 if(!Array.isArray(host.sources)||host.sources.length!==sourceNames.length||host.sources.some((v,i)=>v.name!==sourceNames[i]))integrityProblems.push('Host source inventory differs');
 else host.sources.forEach(file=>verify(file.name,file.sha256));
 candidate.files.forEach(file=>verify('build/libmpv-d3d11-input/runtime/'+file.name,file.sha256,file.size));
 verify(candidate.supplementalHeader.path,candidate.supplementalHeader.sha256,candidate.supplementalHeader.size);
 if(ffi.version!=='3.3.4'||ffi.platform!=='win32-x64')integrityProblems.push('FFI version/platform differs from verified Electron cohort');
 ffi.files.forEach(file=>verify('build/libmpv-render-spike/ffi/'+file.name,file.sha256,file.size));
 if(candidate.distributionReady!==true)releaseBlockers.push('Pinned libmpv GPL dependency notices and corresponding source/build materials remain unapproved');
 // The pinned DLL's PE import table directly imports this loader, even when
 // playback selects D3D11. The six-file upstream dev archive does not ship it.
 // Do not certify another machine based on the developer's System32 copy.
 let loaderPrepared=false;
 if(existsSync(path.join(root,'build/vulkan-runtime-input/runtime/runtime.json'))){
  const pin=json('ci/vulkan-runtime.json'),loader=json('build/vulkan-runtime-input/runtime/runtime.json'),before=integrityProblems.length;
  if(loader.archiveSha256!==pin.archiveSha256||loader.sourceCommit!==pin.sourceCommit||loader.platform!=='windows-x64'||loader.files?.length!==3||loader.files[0].name!=='vulkan-1.dll'||loader.files[1].name!=='LICENSE.txt'||loader.files[2].name!=='VulkanRT-License.txt'||loader.files[1].sha256!==pin.licenseSha256||loader.files[2].sha256!==pin.archiveLicenseSha256)integrityProblems.push('Vulkan runtime identity differs from fixed input');
  else loader.files.forEach(file=>verify('build/vulkan-runtime-input/runtime/'+file.name,file.sha256,file.size));
  loaderPrepared=integrityProblems.length===before;
 }
 releaseBlockers.push(loaderPrepared?'App-local Vulkan loader is prepared; packaged clean-machine dependency resolution remains unverified':'Pinned libmpv directly imports vulkan-1.dll; a verified redistributable loader and clean-machine resolution are not prepared');
 if(host.productionDistributionReady!==true)releaseBlockers.push('Native host manifest is development-only');
 // These are concrete current source/configuration facts, not evidence that a
 // staged directory or a single readiness boolean would satisfy M5 acceptance.
 const player=readFileSync(path.join(root,'electron/src/renderPlayer.ts'),'utf8');
 const texture=readFileSync(path.join(root,'electron/src/renderTexture.ts'),'utf8');
 if(player.includes('build/native-render'))releaseBlockers.push('Native host/DLL resolver still uses workspace build directories');
 if(player.includes('if(app.isPackaged)throw'))releaseBlockers.push('Packaged application deliberately rejects this backend');
 if(texture.includes('build/libmpv-render-spike/ffi'))releaseBlockers.push('Texture bridge still loads FFI from the development test directory');
 const packaged=json('package.json').build;
 const bundled=(packaged.extraResources??[]).map(r=>r.to);
 if(!bundled.includes('native-render'))releaseBlockers.push('Electron extraResources does not contain a native-render runtime bundle');
 releaseBlockers.push('No packaged/clean-machine acceptance bound to this exact host, DLL and FFI cohort');
 let materialsSummary=null;
 if(existsSync(path.join(root,'third_party/libmpv-render-d3d11/materials.json'))){
  const materials=json('third_party/libmpv-render-d3d11/materials.json');
  if(materials.subject?.dllSha256!==candidate.dllSha256||materials.subject?.mpvSourceCommit!==candidate.sourceCommit)releaseBlockers.push('Build/source materials belong to another libmpv binary');
  else materialsSummary={recipeComponents:materials.components.length,transitiveDependenciesVerified:materials.transitiveDependenciesVerified,distributionReady:materials.distributionReady,scope:materials.scope};
 }
 return {schema:1,scope:'offline-development-inventory-not-packaged-acceptance',runtimeVerified:integrityProblems.length===0,loaderPrepared,distributionReady:false,materialsSummary,subject:{hostSha256:host.hostSha256,dllSha256:candidate.dllSha256,ffiVersion:ffi.version,sourceCommit:candidate.sourceCommit},files,integrityProblems,releaseBlockers};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const report=auditRenderDistribution(path.resolve(import.meta.dirname,'..'));
 console.log(JSON.stringify(report,null,2));
 if(!report.runtimeVerified||process.argv.includes('--release'))process.exitCode=1;
}
