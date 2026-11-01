// Byte/schema contracts on explicitly fake owned fixture files. These do NOT
// simulate successful native decoding or certify a real packaged application.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync} from 'node:fs';import path from 'node:path';
const proof=createRequire(import.meta.url)('../release-evidence.cjs'),workspace=path.resolve(import.meta.dirname,'../..');
function fixture(){
 const root=mkdtempSync(path.join(workspace,'build/release-evidence-contract-'));
 const put=(name,value)=>{const file=path.join(root,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file;};
 const build={version:'0.2.17',build_id:'1234567890abcdef',built_at:'2026-10-31T00:00:00.000Z'},binding={buildIdentity:build,actualBackend:'build/backend',nativeRoot:'build/native',independentRuntime:'build/mpv'};
 put('package.json',{version:build.version});put('app/build-info.json',build);put('electron/mpv-runtime.json',{});put('electron/dist/main.js','compiled fixture');put('app/static/index.html','frontend fixture');put('build/backend/_internal/app/static/index.html','frontend fixture');put('app/source.py','original source');
 for(const file of ['build/backend/AVHubServer.exe','build/backend/_internal/bin/ffmpeg.exe','build/backend/_internal/bin/ffprobe.exe','build/backend/_internal/licenses/FFmpeg-RUNTIME.json','build/native/AVHubNativeRender.exe','build/native/libmpv-2.dll','build/native/runtime.json','build/mpv/mpv.exe','build/mpv/runtime.json'])put(file,'NOT executable; contract fixture: '+file);
 put('electron/test/desktop-test-subject.mjs','identity collector contract fixture');
 const expected=proof.targetIdentity(root,binding),roles={independent:'native-independent',coexistence:'mpv-window-coexistence',render:'render-app-flow'};
 const reports=Object.fromEntries(Object.entries(roles).map(([role,script])=>{const scriptPath='electron/test/'+script+'.mjs';put(scriptPath,'contract fixture, not real execution');const subject={schema:1,kind:'packaged-desktop',markerPurpose:'desktop-native-render',version:expected.version,buildId:expected.buildId,payloadSha256:expected.payloadSha256,files:{...expected.files},applicationExeSha256:'a'.repeat(64),applicationAsarSha256:'b'.repeat(64),testScript:{path:scriptPath,sha256:proof.hash(path.join(root,scriptPath)),collectorSha256:proof.hash(path.join(root,'electron/test/desktop-test-subject.mjs'))}};return [role,{subject,completed:true,passed:true,cleanExit:true,cleanupCompleted:true,sourceUnchanged:true}];}));
 const item=name=>({path:name,sha256:proof.hash(path.join(root,name))});
 put('build/binding.json',binding);put('build/source.zip','NOT a ZIP: only Node seal contract; Python validates actual ZIP members');
 const acceptance=Object.entries(reports).map(([role,report])=>{const name='build/'+role+'.json';put(name,report);return {role,...item(name)};});
 const inputs={schema:2,kind:'avhub-dual-mpv-release-inputs',binding:item('build/binding.json'),application:expected,acceptedApplication:proof.validateOutcomes(reports,expected,root),render:item('build/native/runtime.json'),independent:item('build/mpv/runtime.json'),sourceBundle:item('build/source.zip'),acceptance};
 return {root,put,build,binding,expected,reports,inputs};
}
test('complete same-application contract is accepted; changed report bytes are refused',()=>{
 const f=fixture();assert.equal(proof.verifyReceipt(f.root,f.inputs).expected.buildId,f.build.build_id);f.put('build/render.json',{...f.reports.render,passed:false});assert.throws(()=>proof.verifyReceipt(f.root,f.inputs),/evidence changed/);
});
test('legacy schema and bare passed flags cannot attest current package',()=>{
 const f=fixture();assert.throws(()=>proof.verifyReceipt(f.root,{...f.inputs,schema:1}),/Schema 2/);const r=structuredClone(f.reports);delete r.render.subject;assert.throws(()=>proof.validateOutcomes(r,f.expected,f.root),/Actual ordinary packaged/);
});
test('v0.2.16, stale build, changed compiled payload and source harness are rejected',()=>{
 const f=fixture();for(const [key,value] of [['version','0.2.16'],['buildId','old-build'],['payloadSha256','0'.repeat(64)],['kind','source-desktop'],['markerPurpose','local-render-acceptance']])assert.throws(()=>proof.validateSubject(f.expected,{...f.reports.render.subject,[key]:value},f.root),/mismatch|required/);
});
test('wrong backend/native/CLI hashes, mixed executable/ASAR and wrong harness fail',()=>{
 const f=fixture();for(const key of Object.keys(f.expected.files))assert.throws(()=>proof.validateSubject(f.expected,{...f.reports.render.subject,files:{...f.expected.files,[key]:'0'.repeat(64)}},f.root),/runtime\/backend mismatch/);
 const mixed=structuredClone(f.reports);mixed.render.subject.applicationAsarSha256='c'.repeat(64);assert.throws(()=>proof.validateOutcomes(mixed,f.expected,f.root),/different application bytes/);
 const wrong=structuredClone(f.reports);wrong.render.subject.testScript=wrong.independent.subject.testScript;assert.throws(()=>proof.validateOutcomes(wrong,f.expected,f.root),/Wrong acceptance harness/);
});
test('current source/backend static changes invalidate the prepared receipt',()=>{
 const f=fixture();f.put('app/source.py','changed source');assert.throws(()=>proof.verifyReceipt(f.root,f.inputs),/sourceTreeSha256/);
 const g=fixture();g.put('build/backend/_internal/app/static/index.html','stale frontend');assert.throws(()=>proof.targetIdentity(g.root,g.binding),/frontend differs/);
 const h=fixture();h.put('build/backend/_internal/unlisted-runtime.dll','tampered runtime');assert.throws(()=>proof.verifyReceipt(h.root,h.inputs),/runtime\/backend mismatch/);
});
test('current package version/build must equal the frozen input, not test filename',()=>{
 const f=fixture();assert.throws(()=>proof.targetIdentity(f.root,{...f.binding,buildIdentity:{...f.build,version:'0.2.16'}}),/version\/build differs/);
});
test('post-build check verifies exact tested EXE/ASAR and all resource trees',()=>{
 const f=fixture(),directory='build/final';f.put(directory+'/AVHub.exe','app exe');f.put(directory+'/resources/app.asar','app asar');assert.throws(()=>proof.verifyArtifact(f.root,f.inputs,path.join(f.root,directory)),/application bytes differ/);
 const original=readFileSync(path.join(f.root,'build/source.zip'),'utf8');f.put('build/source.zip',original+'tampered');assert.throws(()=>proof.verifyReceipt(f.root,f.inputs),/evidence changed/);
});
test('sealed final byte layout succeeds, then an unlisted dependency change is caught',()=>{
 const f=fixture(),directory=path.join(f.root,'build/final');f.put('build/final/AVHub.exe','owned fake app');f.put('build/final/resources/app.asar','owned fake archive');
 for(const [from,to] of [['backend','backend'],['native','native-render'],['mpv','mpv']])cpSync(path.join(f.root,'build',from),path.join(directory,'resources',to),{recursive:true});
 f.put('build/final/resources/mpv/BUILD-INFO.json',readFileSync(path.join(f.root,'build/mpv/runtime.json'),'utf8'));
 const application={exeSha256:proof.hash(path.join(directory,'AVHub.exe')),asarSha256:proof.hash(path.join(directory,'resources/app.asar'))};
 for(const record of f.inputs.acceptance){const report=f.reports[record.role];Object.assign(report.subject,{applicationExeSha256:application.exeSha256,applicationAsarSha256:application.asarSha256});f.put(record.path,report);record.sha256=proof.hash(path.join(f.root,record.path));}
 f.inputs.acceptedApplication=application;assert.equal(proof.verifyArtifact(f.root,f.inputs,directory).passed,true);
 f.put('build/final/resources/backend/unlisted.dll','changed dependency');assert.throws(()=>proof.verifyArtifact(f.root,f.inputs,directory),/Final resource changed: backendTree/);
});

test('changed identity collector cannot reuse old successful reports',()=>{const f=fixture();f.put('electron/test/desktop-test-subject.mjs','changed collector');assert.throws(()=>proof.validateOutcomes(f.reports,f.expected,f.root),/identity collector changed/);});

test('unbuilt public or native source changes invalidate frozen source identity',()=>{
 for(const name of ['frontend/public/icon.svg','electron/native/render/Host.cs']){const f=fixture();f.put(name,'new source not used by old candidate');assert.throws(()=>proof.verifyReceipt(f.root,f.inputs),/sourceTreeSha256/);}
});
