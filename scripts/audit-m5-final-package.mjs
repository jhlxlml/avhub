// Join actual final-package bytes to verified application/native/CLI materials.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {extractFile} from '@electron/asar';
const root=path.resolve(import.meta.dirname,'..'),folder=path.resolve(process.argv[2]??path.join(root,'build/m5-final-sdr-20261029'));
assert.ok(path.relative(path.join(root,'build'),folder).startsWith('m5-final-sdr-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const replay=read(path.join(root,'build/application-build-replay-latest.json')).folder;
const compiled=read(path.join(replay,'replay-report.json'));assert.equal(compiled.passed,true);
const currentBuild=read(path.join(root,'app/build-info.json')).build_id;assert.equal(compiled.buildId,currentBuild);
const deliveredSource=read(path.join(root,'build/application-source-review-latest.json')).folder;
const previousInputs=read(path.join(compiled.source,'source-review-inventory.json')).files;
const currentInputs=read(path.join(deliveredSource,'source-review-inventory.json')).files;
const buildInput=name=>name.startsWith('frontend/')||name.startsWith('app/')||name.startsWith('electron/src/')||name.startsWith('electron/native/')||['run.py','package.json','package-lock.json','requirements.txt','vite.config.ts','scripts/frontend-notices.mjs'].includes(name);
const identities=items=>items.filter(item=>buildInput(item.path)).map(({path,sha256})=>({path,sha256}));
assert.deepEqual(identities(currentInputs),identities(previousInputs),'delivered build inputs must match the independently rebuilt snapshot');
const asar=path.join(folder,'win-unpacked/resources/app.asar');
const modules=compiled.electronModules.map(({name,identical})=>{
 assert.equal(identical,true);const expected=readFileSync(path.join(replay,'electron/dist',name));
 assert.deepEqual(extractFile(asar,path.join('electron','dist',name)),expected);
 return {name,sha256:hash(expected)};
});
const python=String.raw`
import hashlib,json,sys,zipfile
from pathlib import Path
root=Path(sys.argv[1]);folder=Path(sys.argv[2]);replay=Path(sys.argv[3]);expected_build=sys.argv[4];archive=folder/'AVHub-folder-portable-0.2.16-x64.zip'
with archive.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
with zipfile.ZipFile(archive) as z:
 prefix=z.namelist()[0].split('/')[0]+'/'
 assert z.read(prefix+'resources/app.asar')==(folder/'win-unpacked/resources/app.asar').read_bytes()
 binding=json.loads((folder/'M5-BUILD-INPUTS.json').read_text(encoding='utf-8'))
 candidate=binding['nativeRuntime']
 assert hashlib.sha256(z.read(prefix+'resources/backend/AVHubServer.exe')).hexdigest()==binding['backendExecutableSha256']
 layout=json.loads((Path(candidate)/'layout.json').read_text(encoding='utf-8'))
 for item in layout['files']:
  data=z.read(prefix+'resources/native-render/'+item['path']);assert len(data)==item['size'];assert hashlib.sha256(data).hexdigest()==item['sha256']
 index=json.loads(z.read(prefix+'resources/backend/_internal/licenses/FFmpeg-RUNTIME.json'))
 assert index['sourceProfileSha256']==hashlib.sha256((root/'ci/controlled-ffmpeg.json').read_bytes()).hexdigest()
 for item in index['files']:
  name=prefix+'resources/backend/_internal/'+('bin/' if item['path'].endswith('.exe') else 'licenses/')+item['path']
  data=z.read(name);assert len(data)==item['size'];assert hashlib.sha256(data).hexdigest()==item['sha256']
 meta=json.loads(z.read(prefix+'resources/backend/_internal/app/build-info.json'));assert meta['build_id']==expected_build
 static_files=[file for file in (replay/'app/static').rglob('*') if file.is_file()]
 for file in static_files:assert z.read(prefix+'resources/backend/_internal/app/static/'+file.relative_to(replay/'app/static').as_posix())==file.read_bytes()
 sources=json.loads((root/'build/m5-source-delivery.json').read_text(encoding='utf-8'))
 with Path(sources['zip']).open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==sources['sha256']
 assert sources['allMembersVerified'];assert sources['controlledCliSourceArchives']==11;assert sources['nativeSourceArchives']==21
 assert z.read(prefix+'resources/licenses/AVHub-LICENSE.txt')==(root/'LICENSE').read_bytes()
print(json.dumps({'zipSha256':digest,'zipAsarMatches':True,'replayedFrontendFilesMatched':len(static_files),'nativeFilesMatched':len(layout['files']),'controlledCliFilesMatched':len(index['files']),'backendBuild':meta['build_id'],'sourceDeliverySha256':sources['sha256']}))`;
const payload=JSON.parse(execFileSync('python',['-c',python,root,folder,replay,currentBuild],{encoding:'utf8',windowsHide:true,timeout:90000}));
const report={kind:'actual-M5-final-package-source-and-payload-audit',passed:true,folder,applicationSourceReplay:path.join(replay,'replay-report.json'),deliveredSourceBuildInputsMatched:identities(currentInputs).length,
 electronModulesMatched:modules.length,electronModules:modules,payload,
 scope:'Current frozen source was rebuilt; actual frontend data, ASAR modules, 85 native members and controlled CLI payload match their evidence. Separate source delivery verified. Not a claim of clean-OS or bit-exact backend reproduction.',
 defaultEngineChanged:false,ordinaryProjectCliChanged:false,published:false};
writeFileSync(path.join(folder,'M5-PACKAGE-AUDIT.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,electronModules:modules.length,...payload}));
