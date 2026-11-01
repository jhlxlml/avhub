// Ordinary desktop packaging requires prepared, hash-bound dual-MPV inputs.
// Loading a config never downloads, creates a tag, or publishes a release.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),build=path.join(root,'build');
const inputFile=path.resolve(root,process.env.AVHUB_DESKTOP_RELEASE_INPUTS||'build/desktop-release-inputs.json');
if(!fs.existsSync(inputFile))throw new Error('Prepare M5 dual-MPV release inputs first (scripts/prepare-desktop-release-inputs.py); refusing to omit native playback');
function owned(file){
 const absolute=path.resolve(root,file),relative=path.relative(build,absolute);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.realpathSync(absolute).toLowerCase()!==absolute.toLowerCase()||fs.lstatSync(absolute).isSymbolicLink())throw new Error('Release input must be owned by build/');
 return absolute;
}
owned(inputFile);const inputs=JSON.parse(fs.readFileSync(inputFile,'utf8'));
const proof=require('./release-evidence.cjs'),validated=proof.verifyReceipt(root,inputs);
// Package the exact accepted backend, not an unrelated default build folder.
process.env.AVHUB_RENDER_BACKEND_DIR=validated.binding.actualBackend;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function checked(record){const file=owned(record.path);if(!/^[a-f0-9]{64}$/.test(record.sha256)||hash(file)!==record.sha256)throw new Error('Release input changed: '+record.path);return file;}
const renderManifest=checked(inputs.render),mpvManifest=checked(inputs.independent);checked(inputs.sourceBundle);
for(const report of inputs.acceptance)checked(report);
const renderFolder=path.dirname(renderManifest),mpvFolder=path.dirname(mpvManifest);
process.env.AVHUB_RENDER_RUNTIME_CANDIDATE=path.basename(renderFolder);process.env.AVHUB_MPV_DESKTOP_RUNTIME=path.basename(mpvFolder);
const candidate=require('./desktop-render.builder.cjs'),base=require('../package.json').build;
const {renderRuntimeLayout}=require('./dist/renderRuntimeLayout.js');
const runtime=renderRuntimeLayout(root,false,'',path.basename(renderFolder));
const layout=JSON.parse(fs.readFileSync(path.join(renderFolder,'layout.json'),'utf8'));
const backend=candidate.extraResources.find(item=>item.to==='backend').from;
module.exports={...candidate,directories:base.directories,win:base.win,publish:null,
 beforePack:async()=>{
  proof.verifyReceipt(root,inputs);
  // Native inputs may survive frontend-only releases, but changed native source
  // must be rebuilt and re-accepted rather than shipping a mismatched helper.
  for(const source of JSON.parse(fs.readFileSync(renderManifest,'utf8')).sources)if(hash(path.join(root,source.name))!==source.sha256)throw new Error('Rebuild changed native helper source: '+source.name);
  await require('./verify-render-resources.cjs')({root,backend,runtime,layout,expectedManifestSha:inputs.render.sha256});
  const {NativeRuntime}=require('./dist/nativeRuntime.js');
  const state=await new NativeRuntime(()=>path.join(mpvFolder,'mpv.exe'),mpvManifest).check(true);if(!state.available)throw new Error(state.reason);
  const cli=path.join(backend,'_internal/licenses/FFmpeg-RUNTIME.json');if(!fs.existsSync(cli))throw new Error('Controlled CLI provenance required for desktop release packaging');
  // Recheck the proof files at the actual packaging boundary.
  checked(inputs.render);checked(inputs.independent);checked(inputs.sourceBundle);for(const report of inputs.acceptance)checked(report);
 },
 afterAllArtifactBuild:async context=>{
  const extra=candidate.afterAllArtifactBuild?await candidate.afterAllArtifactBuild(context):[];
  proof.verifyArtifact(root,inputs,path.join(context.outDir,'win-unpacked'));
  return extra;
 },
};
