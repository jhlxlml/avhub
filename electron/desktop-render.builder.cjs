// M5 desktop integration candidate: ordinary launch, explicit settings opt-in.
// Reuses the complete runtime/material verification, without acceptance scripts.
const fs=require('node:fs'),path=require('node:path');
const local=require('./native-render.builder.cjs');
const {NativeRuntime}=require('./dist/nativeRuntime.js');
const root=path.resolve(__dirname,'..'),selection=process.env.AVHUB_MPV_DESKTOP_RUNTIME;
if(selection&&!/^mpv-desktop-runtime-[a-z0-9_]{8}$/.test(selection))throw new Error('Invalid source-built MPV runtime selection');
const independent=selection?path.join(root,'build',selection):path.join(root,'bin/mpv');
const independentManifest=selection?path.join(independent,'runtime.json'):path.join(__dirname,'mpv-runtime.json');
const markerResource=local.extraResources.find(item=>item.to==='local-render-acceptance.json');
if(!markerResource)throw new Error('Desktop integration requires the replayed native runtime');
const accepted=JSON.parse(fs.readFileSync(markerResource.from,'utf8'));
const folder=fs.mkdtempSync(path.join(__dirname,'../build/desktop-render-marker-'));
const marker=path.join(folder,'native-render-desktop.json');
fs.writeFileSync(marker,JSON.stringify({schema:1,purpose:'desktop-native-render',candidate:accepted.candidate,
 cohort:accepted.cohort,manifestSha256:accepted.manifestSha256},null,2));
module.exports={...local,
 directories:{...local.directories,output:path.join('build','desktop-render-'+accepted.candidate.slice(-6))},
 extraResources:[...local.extraResources.filter(item=>item.to!=='local-render-acceptance.json'),{from:marker,to:'native-render-desktop.json'},
  {from:independent,to:'mpv',filter:selection?['**/*']:['mpv.exe','LICENSE.GPL']},
  {from:independentManifest,to:'mpv/BUILD-INFO.json'}],
 extraFiles:local.extraFiles.filter(item=>!['Start-render-acceptance.cmd','LOCAL-ACCEPTANCE.txt'].includes(item.to)),
 win:{...local.win,artifactName:'AVHub-desktop-candidate-${version}-${arch}.${ext}'},
 // No publication. This integration still needs final packaged-app acceptance.
 publish:null,
 beforePack:async context=>{
  await local.beforePack(context);
  const status=await new NativeRuntime(()=>path.join(independent,'mpv.exe'),independentManifest).check(true);
  if(!status.available)throw new Error('Independent MPV runtime unavailable: '+status.reason);
  // Runtime integrity is not source/redistribution approval. The inherited
  // release-tag prohibition and publish:null remain in this local candidate.
 },
};
