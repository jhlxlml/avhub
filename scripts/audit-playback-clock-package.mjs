// Join actual M5 source-rebuild and delivered-ZIP evidence. No GUI simulation.
import assert from 'node:assert/strict';import path from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';import {extractFile} from '@electron/asar';
const root=path.resolve(import.meta.dirname,'..'),build=path.join(root,'build');
const owned=value=>{const absolute=path.resolve(root,value),relative=path.relative(build,absolute);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Owned build evidence required');return absolute;};
const read=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const artifact=read(path.join(build,'m5-playback-clock-artifact.json'));
const replay=owned(read(path.join(build,'application-build-replay-latest.json')).folder);
const front=read(path.join(replay,'replay-report.json')),backend=read(path.join(replay,'backend-replay-report.json'));
const verification=read(owned(backend.verificationReceipt));
assert.equal(front.passed,true);assert.equal(backend.passed,true);assert.equal(verification.passed,true);
assert.equal(front.buildId,artifact.build);assert.equal(verification.health.build_id,artifact.build);
assert.equal(verification.health.frozen,true);assert.equal(verification.exitCode,0);
const asar=path.join(owned(artifact.folder),'win-unpacked/resources/app.asar');
const modules=front.electronModules.map(({name,identical})=>{assert.equal(identical,true);const source=readFileSync(path.join(replay,'electron/dist',name));assert.deepEqual(extractFile(asar,path.join('electron','dist',name)),source);return {name,sha256:hash(source)};});
assert.ok(modules.some(m=>m.name==='playbackClock.js'));
const python=`import hashlib,json,sys,zipfile
from pathlib import Path
root=Path(sys.argv[1]);artifact=json.loads((root/'build/m5-playback-clock-artifact.json').read_text(encoding='utf-8'))
archive=Path(artifact['zip']);runtime=json.loads((root/'build/replayed-render-staging.json').read_text(encoding='utf-8'))
with archive.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==artifact['zipSha256']
with zipfile.ZipFile(archive) as source:
 prefix='AVHub-folder-portable-'+artifact['version']+'-x64/'
 native=[]
 for item in runtime['files']:
  name=prefix+'resources/native-render/'+item['path']
  assert hashlib.sha256(source.read(name)).hexdigest()==item['sha256'];native.append(item['path'])
 asar=source.read(prefix+'resources/app.asar')
 unpacked=Path(artifact['folder'])/'win-unpacked/resources/app.asar'
 assert hashlib.sha256(asar).digest()==hashlib.sha256(unpacked.read_bytes()).digest()
 meta=json.loads(source.read(prefix+'resources/backend/_internal/app/build-info.json'))
 assert meta['build_id']==artifact['build']
 assert source.read(prefix+'resources/licenses/AVHub-LICENSE.txt')==(root/'LICENSE').read_bytes()
print(json.dumps({'zipSha256':artifact['zipSha256'],'zipAsarMatchesUnpacked':True,'nativeFilesVerified':len(native),'backendBuild':meta['build_id'],'applicationLicenseMatches':True}))`;
const zip=JSON.parse(execFileSync('python',['-c',python,root],{windowsHide:true,encoding:'utf8',timeout:60000}));
const report={kind:'current-M5-frozen-source-and-delivered-ZIP-audit',passed:true,build:artifact.build,sourceSnapshot:front.source,frontendReplay:path.join(replay,'replay-report.json'),backendReplay:path.join(replay,'backend-replay-report.json'),actualBackendVerification:backend.verificationReceipt,electronModules:modules,zip,
 scope:'Compiled Electron JS matches ZIP ASAR; native staging members and backend identity match. Existing toolchain and pinned third-party binaries reused; no bit-exact backend reproduction or complete corresponding-source certification.',cleanEnvironment:false,thirdPartySourceClosureComplete:false,distributionReady:false,published:false};
writeFileSync(path.join(build,'m5-clock-source-zip-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,build:report.build,electronModules:modules.length,zip,report:'build/m5-clock-source-zip-audit.json'}));
