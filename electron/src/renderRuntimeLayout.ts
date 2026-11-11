import path from 'node:path';
import {readFileSync,lstatSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {replayedRenderPin} from './replayedRenderPin';
import {mkvIndexRenderPin} from './mkvIndexRenderPin';

/** Explicit development candidate selection; packaged admission remains gated
 * by RenderPlayer until actual distribution/clean-machine acceptance passes. */
export function renderRuntimeLayout(root:string,packaged:boolean,resources:string,candidate?:string,localAcceptance=false,desktopEnabled=false){
 if(candidate&&!/^render-(?:runtime|selfbuilt|replayed)-candidate-[A-Za-z0-9]{6}$/.test(candidate))throw new Error('无效原生运行库测试目录');
 const replayedCandidate=Boolean(candidate?.startsWith('render-replayed-candidate-'));
 const selfBuiltCandidate=replayedCandidate||Boolean(candidate?.startsWith('render-selfbuilt-candidate-'));
 if(localAcceptance&&(!packaged||!replayedCandidate))throw new Error('本地成品验收选择无效');
 if(packaged&&selfBuiltCandidate&&!localAcceptance&&!desktopEnabled)throw new Error('自建原生候选尚未完成发行验收');
 if(packaged||candidate){
  const base=packaged?path.join(resources,'native-render'):path.join(root,'build',candidate!);
  return {host:path.join(base,'AVHubNativeRender.exe'),dll:path.join(base,'libmpv-2.dll'),manifest:path.join(base,'runtime.json'),root:path.join(base,'source'),ffiBase:path.join(base,'ffi'),ffiManifest:path.join(base,'ffi/runtime-manifest.json'),bundled:true,selfBuiltCandidate,replayedCandidate,localAcceptance,desktopEnabled};
 }
 return {host:path.join(root,'build/native-render/AVHubNativeRender.exe'),dll:path.join(root,'build/libmpv-d3d11-input/runtime/libmpv-2.dll'),manifest:path.join(root,'build/native-render/runtime.json'),root,ffiBase:path.join(root,'build/libmpv-render-spike/ffi'),ffiManifest:path.join(root,'ci/render-ffi/runtime-manifest.json'),bundled:false,localAcceptance:false,desktopEnabled:false};
}

/** Startup/session boundary shared by playback and texture import. A local
 * acceptance marker is a test opt-in, not a signature or release approval. */
export function resolveRenderRuntime(root:string,packaged:boolean,resources:string,candidate=process.env.AVHUB_RENDER_RUNTIME_CANDIDATE,acceptance=process.env.AVHUB_RENDER_LOCAL_ACCEPTANCE){
 if(!packaged)return renderRuntimeLayout(root,false,resources,candidate);
 const installedFile=path.join(resources,'native-render-desktop.json');
 if(existsSync(installedFile)){
  const info=lstatSync(installedFile);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw new Error('桌面原生运行库描述无效');
  const parsed:unknown=JSON.parse(readFileSync(installedFile,'utf8'));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('桌面原生运行库描述无效');
  const marker=parsed as Record<string,unknown>;
  if(marker.schema!==1||marker.purpose!=='desktop-native-render'||(marker.cohort!==replayedRenderPin.id&&marker.cohort!==mkvIndexRenderPin.id)||typeof marker.candidate!=='string'||!/^render-replayed-candidate-[A-Za-z0-9]{6}$/.test(marker.candidate)||typeof marker.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(marker.manifestSha256))throw new Error('桌面原生运行库描述不匹配');
  const runtime=renderRuntimeLayout(root,true,resources,marker.candidate,false,true);
  const manifest=lstatSync(runtime.manifest);if(!manifest.isFile()||manifest.isSymbolicLink()||manifest.size>65536||createHash('sha256').update(readFileSync(runtime.manifest)).digest('hex')!==marker.manifestSha256)throw new Error('桌面原生运行库清单不匹配');
  if(JSON.parse(readFileSync(runtime.manifest,'utf8')).cohort!==marker.cohort)throw new Error('Native runtime cohort mismatch');
  return runtime;
 }
 if(acceptance!=='1')return renderRuntimeLayout(root,true,resources);
 const file=path.join(resources,'local-render-acceptance.json');
 if(!existsSync(file))throw new Error('缺少本地原生验收标记，请使用专用验收包');
 const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw new Error('本地原生验收标记无效');
 const parsed:unknown=JSON.parse(readFileSync(file,'utf8'));
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('本地原生验收标记无效');
 const marker=parsed as Record<string,unknown>;
 if(marker.schema!==1||marker.purpose!=='local-render-acceptance'||(marker.cohort!==replayedRenderPin.id&&marker.cohort!==mkvIndexRenderPin.id)||marker.distributionReady!==false||typeof marker.candidate!=='string'||!/^render-replayed-candidate-[A-Za-z0-9]{6}$/.test(marker.candidate)||typeof marker.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(marker.manifestSha256))throw new Error('本地原生验收标记不匹配');
 const runtime=renderRuntimeLayout(root,true,resources,marker.candidate,true);
 const manifest=lstatSync(runtime.manifest);if(!manifest.isFile()||manifest.isSymbolicLink()||manifest.size>65536||createHash('sha256').update(readFileSync(runtime.manifest)).digest('hex')!==marker.manifestSha256)throw new Error('本地原生验收清单不匹配');
 if(JSON.parse(readFileSync(runtime.manifest,'utf8')).cohort!==marker.cohort)throw new Error('Native acceptance cohort mismatch');
 return runtime;
}
