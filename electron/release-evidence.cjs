// Shared preparation/packaging proof checks. No download, package or publish.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fingerprint=entries=>crypto.createHash('sha256').update(JSON.stringify(entries.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0))).digest('hex');
function tree(directory,prefix,filter=()=>true){
 if(!fs.existsSync(directory))return [];
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const file=path.join(directory,entry.name),name=prefix+'/'+entry.name;if(entry.isSymbolicLink())throw new Error('Symlink in release payload: '+name);return entry.isDirectory()?tree(file,name,filter):filter(name)?[[name,hash(file)]]:[];});
}
function compiledPayload(root,staticRoot){
 const files=[...tree(path.join(root,'electron/dist'),'electron/dist'),...tree(staticRoot,'app/static')];
 for(const name of ['app/build-info.json','electron/mpv-runtime.json'])files.push([name,hash(path.join(root,name))]);
 if(!files.some(([name])=>name==='electron/dist/main.js')||!files.some(([name])=>name==='app/static/index.html'))throw new Error('Complete compiled desktop/frontend payload required');
 return fingerprint(files);
}
function sourceFiles(root){
 const files=['frontend/src','frontend/public','electron/src','electron/native','electron/player','scripts'].flatMap(name=>tree(path.join(root,name),name,name=>!name.includes('/__pycache__/')));
 files.push(...tree(path.join(root,'app'),'app',name=>name.endsWith('.py')));
 files.push(...tree(path.join(root,'electron'),'electron',name=>name.split('/').length===2&&/\.(cjs|json)$/.test(name)));
 for(const name of ['package.json','package-lock.json','vite.config.ts','electron/tsconfig.json','requirements.txt','requirements-build.txt','run.py','LICENSE','.github/workflows/windows.yml'])if(fs.existsSync(path.join(root,name)))files.push([name,hash(path.join(root,name))]);
 return [...new Map(files.map(item=>[item[0],item])).values()].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
}
const resources={backend:'backend/AVHubServer.exe',host:'native-render/AVHubNativeRender.exe',libmpv:'native-render/libmpv-2.dll',renderManifest:'native-render/runtime.json',mpv:'mpv/mpv.exe',mpvManifest:'mpv/BUILD-INFO.json',ffmpeg:'backend/_internal/bin/ffmpeg.exe',ffprobe:'backend/_internal/bin/ffprobe.exe',cliManifest:'backend/_internal/licenses/FFmpeg-RUNTIME.json'};
function packagedFiles(directory){return {...Object.fromEntries(Object.entries(resources).map(([key,name])=>[key,hash(path.join(directory,name))])),backendTree:fingerprint(tree(path.join(directory,'backend'),'backend')),nativeTree:fingerprint(tree(path.join(directory,'native-render'),'native-render')),mpvTree:fingerprint(tree(path.join(directory,'mpv'),'mpv',name=>name!=='mpv/BUILD-INFO.json'))};}
function owned(root,file){const absolute=path.resolve(root,file),relative=path.relative(path.join(root,'build'),absolute);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.realpathSync(absolute).toLowerCase()!==absolute.toLowerCase()||fs.lstatSync(absolute).isSymbolicLink())throw new Error('Owned build evidence required: '+file);return absolute;}
function targetIdentity(root,binding){
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,build=JSON.parse(fs.readFileSync(path.join(root,'app/build-info.json'),'utf8'));
 if(build.version!==version||binding.buildIdentity?.version!==version||binding.buildIdentity?.build_id!==build.build_id)throw new Error('Frozen candidate version/build differs from current application; recapture matching acceptance, never reuse v0.2.16');
 const backend=owned(root,binding.actualBackend),native=owned(root,binding.nativeRoot),mpv=owned(root,binding.independentRuntime);
 if(fingerprint(tree(path.join(root,'app/static'),'app/static'))!==fingerprint(tree(path.join(backend,'_internal/app/static'),'app/static')))throw new Error('Frozen backend frontend differs from current compiled frontend');
 const files={backend:hash(path.join(backend,'AVHubServer.exe')),host:hash(path.join(native,'AVHubNativeRender.exe')),libmpv:hash(path.join(native,'libmpv-2.dll')),renderManifest:hash(path.join(native,'runtime.json')),mpv:hash(path.join(mpv,'mpv.exe')),mpvManifest:hash(path.join(mpv,'runtime.json')),ffmpeg:hash(path.join(backend,'_internal/bin/ffmpeg.exe')),ffprobe:hash(path.join(backend,'_internal/bin/ffprobe.exe')),cliManifest:hash(path.join(backend,'_internal/licenses/FFmpeg-RUNTIME.json'))};
 Object.assign(files,{backendTree:fingerprint(tree(backend,'backend')),nativeTree:fingerprint(tree(native,'native-render')),mpvTree:fingerprint(tree(mpv,'mpv',name=>name!=='mpv/BUILD-INFO.json'))});
 const sources=sourceFiles(root);
 return {schema:1,kind:'packaged-desktop',version,buildId:build.build_id,builtAt:build.built_at,payloadSha256:compiledPayload(root,path.join(backend,'_internal/app/static')),sourceTreeSha256:fingerprint(sources),sourceFiles:sources,files};
}
function validateSubject(expected,subject,root){
 if(!subject||subject.schema!==1||subject.kind!=='packaged-desktop'||subject.markerPurpose!=='desktop-native-render')throw new Error('Actual ordinary packaged desktop subject required; source/local-acceptance harness is not release proof');
 for(const key of ['version','buildId','payloadSha256'])if(subject[key]!==expected[key])throw new Error('Packaged acceptance application mismatch: '+key);
 for(const [key,digest] of Object.entries(expected.files))if(subject.files?.[key]!==digest)throw new Error('Packaged acceptance runtime/backend mismatch: '+key);
 if(!/^[a-f0-9]{64}$/.test(subject.applicationExeSha256)||!/^[a-f0-9]{64}$/.test(subject.applicationAsarSha256))throw new Error('Actual executable/ASAR digest required');
 if(!subject.testScript||!/^electron\/test\/[a-z0-9-]+\.mjs$/.test(subject.testScript.path)||hash(path.join(root,subject.testScript.path))!==subject.testScript.sha256)throw new Error('Acceptance test script changed; rerun current harness');
 if(hash(path.join(root,'electron/test/desktop-test-subject.mjs'))!==subject.testScript.collectorSha256)throw new Error('Acceptance identity collector changed; rerun current harness');
}
function validateOutcomes(reports,expected,root){
 const checks={independent:r=>r.completed&&r.cleanExit&&r.sourceUnchanged,coexistence:r=>r.passed&&r.cleanExit,render:r=>r.passed&&r.cleanupCompleted};
 const scripts={independent:'native-independent',coexistence:'mpv-window-coexistence',render:'render-app-flow'};let application;
 for(const role of Object.keys(checks)){const report=reports[role];if(!report||!checks[role](report))throw new Error('Actual successful '+role+' acceptance required');validateSubject(expected,report.subject,root);if(report.subject.testScript.path!==`electron/test/${scripts[role]}.mjs`)throw new Error('Wrong acceptance harness for '+role);const current={exeSha256:report.subject.applicationExeSha256,asarSha256:report.subject.applicationAsarSha256};if(application&&JSON.stringify(application)!==JSON.stringify(current))throw new Error('Acceptance reports ran different application bytes');application=current;}
 return application;
}
function verifyReceipt(root,inputs){
 if(inputs.schema!==2||inputs.kind!=='avhub-dual-mpv-release-inputs'||!Array.isArray(inputs.acceptance)||inputs.acceptance.length!==3)throw new Error('Schema 2 same-application release evidence required; regenerate stale inputs');
 const checked=record=>{const file=owned(root,record.path);if(!/^[a-f0-9]{64}$/.test(record.sha256)||hash(file)!==record.sha256)throw new Error('Release evidence changed: '+record.path);return file;};
 const binding=JSON.parse(fs.readFileSync(checked(inputs.binding),'utf8')),expected=targetIdentity(root,binding);
 for(const key of ['version','buildId','builtAt','payloadSha256','sourceTreeSha256'])if(inputs.application?.[key]!==expected[key])throw new Error('Current release subject changed: '+key);
 checked(inputs.render);checked(inputs.independent);checked(inputs.sourceBundle);if(inputs.render.sha256!==expected.files.renderManifest||inputs.independent.sha256!==expected.files.mpvManifest)throw new Error('Selected manifests do not match tested target');const reports=Object.fromEntries(inputs.acceptance.map(record=>[record.role,JSON.parse(fs.readFileSync(checked(record),'utf8'))]));
 const application=validateOutcomes(reports,expected,root);if(JSON.stringify(application)!==JSON.stringify(inputs.acceptedApplication))throw new Error('Accepted application byte binding changed');
 return {expected,binding,application};
}
function verifyArtifact(root,inputs,directory){
 const {expected,application}=verifyReceipt(root,inputs);const exe=path.join(directory,'AVHub.exe'),asar=path.join(directory,'resources/app.asar');
 if(hash(exe)!==application.exeSha256||hash(asar)!==application.asarSha256)throw new Error('Final application bytes differ from the actually tested candidate');
 const actual=packagedFiles(path.join(directory,'resources'));for(const [key,digest] of Object.entries(expected.files))if(actual[key]!==digest)throw new Error('Final resource changed: '+key);
 return {passed:true,version:expected.version,buildId:expected.buildId,application,...actual};
}
module.exports={hash,fingerprint,compiledPayload,sourceFiles,packagedFiles,targetIdentity,validateSubject,validateOutcomes,verifyReceipt,verifyArtifact};
if(require.main===module){
 const [command,root,input,extra]=process.argv.slice(2);
 if(command==='target')console.log(JSON.stringify(targetIdentity(root,JSON.parse(fs.readFileSync(input,'utf8')))));
 else if(command==='verify'){const {expected}=verifyReceipt(root,JSON.parse(fs.readFileSync(input,'utf8')));console.log(JSON.stringify({verified:true,version:expected.version,buildId:expected.buildId,payloadSha256:expected.payloadSha256,sourceTreeSha256:expected.sourceTreeSha256}));}
 else if(command==='artifact')console.log(JSON.stringify(verifyArtifact(root,JSON.parse(fs.readFileSync(input,'utf8')),extra)));
 else throw new Error('Use target/verify/artifact with explicit root and owned input JSON');
}
