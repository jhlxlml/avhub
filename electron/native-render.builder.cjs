// Explicit local acceptance configuration. Ordinary releases still use the
// existing package.json configuration. This file never starts a build itself.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const name=process.env.AVHUB_RENDER_RUNTIME_CANDIDATE;
if(!/^render-(?:runtime|selfbuilt|replayed)-candidate-[A-Za-z0-9]{6}$/.test(name||''))throw new Error('Set AVHUB_RENDER_RUNTIME_CANDIDATE to a verified local candidate directory name');
const folder=path.join(root,'build',name),layout=JSON.parse(fs.readFileSync(path.join(folder,'layout.json'),'utf8'));
const {renderRuntimeLayout}=require('./dist/renderRuntimeLayout.js');
const runtime=renderRuntimeLayout(root,false,'',name);
const {renderCandidatePolicy}=require('./render-candidate-policy.cjs');
const {replayedRenderPin}=require('./dist/replayedRenderPin.js');
const {mkvIndexRenderPin}=require('./dist/mkvIndexRenderPin.js');
const identity=renderCandidatePolicy(layout,JSON.parse(fs.readFileSync(runtime.manifest,'utf8')),runtime,[replayedRenderPin,mkvIndexRenderPin]);
const base=require('../package.json').build;
const backend=process.env.AVHUB_RENDER_BACKEND_DIR?path.resolve(root,process.env.AVHUB_RENDER_BACKEND_DIR):path.join(root,'build/backend-dist/AVHubServer');
const backendRelative=path.relative(path.join(root,'build'),backend);
if(backendRelative.startsWith('..')||path.isAbsolute(backendRelative))throw new Error('Local backend must be inside project build/');
let acceptanceResource=[];
let acceptanceMarker;
if(runtime.replayedCandidate){
 acceptanceMarker={schema:1,purpose:'local-render-acceptance',candidate:name,cohort:identity.cohort,
  manifestSha256:crypto.createHash('sha256').update(fs.readFileSync(runtime.manifest)).digest('hex'),distributionReady:false};
 const markerFolder=fs.mkdtempSync(path.join(root,'build/native-render-acceptance-marker-'));
 const marker=path.join(markerFolder,'local-render-acceptance.json');
 fs.writeFileSync(marker,JSON.stringify(acceptanceMarker,null,2));
 acceptanceResource=[{from:marker,to:'local-render-acceptance.json'}];
}
module.exports={
 ...base,
 directories:{...base.directories,output:path.join('build','native-render-acceptance-'+name.slice(-6))},
 extraResources:[...base.extraResources.map(entry=>entry.to==='backend'?{...entry,from:backend}:entry),...acceptanceResource,{from:folder,to:'native-render',filter:['**/*']}],
 extraFiles:[...(base.extraFiles||[]),...(runtime.replayedCandidate?[{from:'electron/local-render-acceptance.cmd',to:'Start-render-acceptance.cmd'},{from:'electron/local-render-acceptance.txt',to:'LOCAL-ACCEPTANCE.txt'}]:[])],
 win:{...base.win,artifactName:'AVHub-render-acceptance-${version}-${arch}.${ext}'},
 publish:null,
 beforePack:async()=>{
  if(process.env.GITHUB_REF?.startsWith('refs/tags/'))throw new Error('Local Render API acceptance configuration cannot publish a release tag');
  await require('./verify-render-resources.cjs')({root,backend,runtime,layout,expectedManifestSha:acceptanceMarker?.manifestSha256});
 },
};
