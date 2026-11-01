// Real dependency integration on owned byte fixtures. This does not package an
// application, sign an EXE, or certify a released/native desktop application.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const selected=process.env.AVHUB_TEST_BUILD_TOOLCHAIN;
if(selected)assert.match(selected,/^dependency-candidate-[a-z0-9_]+$/);
const toolRoot=selected?path.join(root,'build',selected):root;
const require=createRequire(path.join(toolRoot,'package.json'));
['app-builder-lib','@electron/asar','electron-winstaller','filelist','ejs','minimatch'].forEach(name=>assert.ok(fs.realpathSync(require.resolve(name)).toLowerCase().startsWith((path.join(toolRoot,'node_modules')+path.sep).toLowerCase()),'Dependency must come from selected toolchain: '+name));
const fixture=fs.mkdtempSync(path.join(root,'build/build-toolchain-'));
const source=path.join(fixture,'source');
const entries={
 'package.json':Buffer.from('{"name":"owned-byte-fixture","version":"1.0.0"}'),
 'electron/dist/main.js':Buffer.from('console.log("fixture");'),
 'electron/dist/main.js.map':Buffer.from('excluded map'),
 'app/static/index.html':Buffer.from('<title>owned fixture</title>'),
 'app/static/assets/中文 한글.js':Buffer.from('export const value="中文";'),
 'app/static/.hidden.json':Buffer.from('{"hidden":true}'),
 'native/中文 目录/runtime.dll':Buffer.from([0,1,2,3,255,0,17]),
 'notes/ignored.txt':Buffer.from('not an application file'),
};
Object.entries(entries).forEach(([name,bytes])=>{const file=path.join(source,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const selectedNames=Object.keys(entries).filter(name=>!name.endsWith('.map')&&!name.startsWith('notes/'));

test('builder file matching retains Unicode, dotfiles and ordered exclusions',()=>{
 const {FileMatcher}=require('app-builder-lib/out/fileMatcher.js');
 const matcher=new FileMatcher(source,path.join(fixture,'destination'),value=>value,['package.json','electron/dist/**/*','app/static/**/*','native/**/*','!**/*.map']);
 const filter=matcher.createFilter();
 assert.deepEqual(Object.keys(entries).filter(name=>{const file=path.join(source,name);return filter(file,fs.statSync(file));}).sort(),selectedNames.sort());
});

test('ASAR crawler, unpack rules and extraction preserve every source byte',async()=>{
 const asar=require('@electron/asar');
 const output=path.join(fixture,'crawler.asar');
 await asar.createPackageWithOptions(source,output,{dot:true,unpack:'**/*.dll'});
 Object.entries(entries).forEach(([name,bytes])=>assert.equal(digest(asar.extractFile(output,path.normalize(name))),digest(bytes),name));
 const dll='native/中文 目录/runtime.dll';
 assert.equal(asar.statFile(output,path.normalize(dll)).unpacked,true);
 assert.deepEqual(fs.readFileSync(path.join(output+'.unpacked',dll)),entries[dll]);
 assert.ok(asar.getRawHeader(output).headerSize>0);
});

test('actual builder stream pipeline retains transformed files and deterministic bytes',async()=>{
 const {AsarPackager}=require('app-builder-lib/out/asar/asarUtil.js');
 const asar=require('@electron/asar'),{FileMatcher}=require('app-builder-lib/out/fileMatcher.js');
 const unpack=new FileMatcher(source,source,value=>value,['**/*.dll']).createFilter();
 const files=selectedNames.map(name=>path.join(source,name)),metadata=new Map(files.map(file=>[file,fs.statSync(file)]));
 const transformed=Buffer.from('{"name":"owned-transformed-fixture","version":"1.0.0"}');
 const outputs=await Promise.all([0,1].map(async index=>{
  const resourcePath=path.join(fixture,'streams-'+index);fs.mkdirSync(resourcePath);
  const packager=new AsarPackager({info:{getWorkspaceRoot:async()=>fixture}},{defaultDestination:source,resourcePath,options:{smartUnpack:false},unpackPattern:unpack});
  await packager.pack([{src:source,destination:source,files,metadata,transformedFiles:new Map([[files.indexOf(path.join(source,'package.json')),transformed]])}]);
  const output=path.join(resourcePath,'app.asar');
  selectedNames.forEach(name=>assert.deepEqual(asar.extractFile(output,path.normalize(name)),name==='package.json'?transformed:entries[name],name));
  assert.equal(asar.statFile(output,path.normalize('native/中文 目录/runtime.dll')).unpacked,true);
  return digest(fs.readFileSync(output));
 }));
 assert.equal(outputs[0],outputs[1]);
});

test('FileList and EJS matching remain usable; actual installer temp helper cleans on exit',()=>{
 const ejs=require('ejs');
 const installerRequire=createRequire(require.resolve('electron-winstaller/package.json'));
 assert.equal(installerRequire('temp/package.json').name,'tmp');
 assert.equal(installerRequire('temp/package.json').version,'0.2.7');
 // filelist 1.x normalizes nested patterns to backslashes on Windows; that
 // already fails with its original minimatch 5. Exercise its supported root
 // matching API, not an unrelated pre-existing nested-pattern defect.
 const listScript=`const {FileList}=require(${JSON.stringify(require.resolve('filelist'))});console.log(JSON.stringify(new FileList('*.json').toArray()));`;
 const listResult=spawnSync(process.execPath,['-e',listScript],{cwd:source,encoding:'utf8',windowsHide:true});
 assert.equal(listResult.status,0,listResult.stderr);
 const listed=JSON.parse(listResult.stdout);assert.deepEqual(listed,['package.json']);
 assert.equal(ejs.render('<% files.forEach(file=>{ %><%= file %>|<% }) %>',{files:listed}),listed.join('|')+'|');
 const helper=require.resolve('electron-winstaller/lib/temp-utils.js');
 const script=`const fs=require('node:fs'),path=require('node:path');require(${JSON.stringify(helper)}).createTempDir('avhub-build-[literal]-').then(dir=>{fs.mkdirSync(path.join(dir,'中文 子目录'));fs.writeFileSync(path.join(dir,'中文 子目录/value.bin'),'owned');console.log(JSON.stringify(dir));});`;
 const child=spawnSync(process.execPath,['-e',script],{encoding:'utf8',windowsHide:true,timeout:5000});
 assert.equal(child.status,0,child.stderr);
 const owned=JSON.parse(child.stdout);
 assert.ok(path.basename(owned).startsWith('avhub-build-[literal]-'));
 assert.equal(fs.existsSync(owned),false);
 assert.ok(fs.existsSync(path.join(source,'package.json')),'cleanup must retain sibling fixtures');
});

test('unsupported legacy glob/rimraf chain is absent from the locked toolchain',()=>{
 const lock=JSON.parse(fs.readFileSync(path.join(toolRoot,'package-lock.json'),'utf8'));
 const packages=Object.entries(lock.packages);
 assert.ok(packages.some(([name,pkg])=>name.endsWith('/glob')&&pkg.version==='14.0.3'));
 assert.ok(packages.filter(([name])=>name.endsWith('/glob')).every(([,pkg])=>pkg.version==='14.0.3'));
 assert.equal(packages.some(([name])=>name.endsWith('/rimraf')),false);
 assert.ok(packages.filter(([name])=>name.endsWith('/minimatch')).every(([,pkg])=>pkg.version==='11.0.3'));
});

test('build-time adaptation is idempotent and refuses unknown bytes without overwriting',()=>{
 const guard=path.join(fixture,'patch-guard'),scripts=path.join(guard,'scripts'),installed=path.join(guard,'node_modules/electron-winstaller');
 fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(path.join(installed,'lib'),{recursive:true});fs.mkdirSync(path.join(guard,'node_modules/temp'),{recursive:true});
 fs.writeFileSync(path.join(guard,'package.json'),'{}');fs.writeFileSync(path.join(installed,'package.json'),'{"version":"5.4.0"}');fs.writeFileSync(path.join(guard,'node_modules/temp/package.json'),'{"name":"tmp","version":"0.2.7"}');
 const target=path.join(installed,'lib/temp-utils.js');fs.copyFileSync(require.resolve('electron-winstaller/lib/temp-utils.js'),target);
 const script=path.join(scripts,'patch-build-toolchain.cjs');fs.copyFileSync(path.join(root,'scripts/patch-build-toolchain.cjs'),script);
 const run=()=>spawnSync(process.execPath,[script],{encoding:'utf8',windowsHide:true,timeout:5000});
 const before=fs.readFileSync(target);assert.equal(run().status,0);assert.equal(run().status,0);assert.deepEqual(fs.readFileSync(target),before);
 fs.appendFileSync(target,'\n// unexpected third-party modification');const changed=fs.readFileSync(target),rejected=run();
 assert.equal(rejected.status,1);assert.match(rejected.stderr,/Unexpected electron-winstaller/);assert.deepEqual(fs.readFileSync(target),changed);
});

test('fixed glob stops scheduling directory reads after cancellation',async()=>{
 const asarRequire=createRequire(require.resolve('@electron/asar')),glob=asarRequire('glob');
 const tree=path.join(fixture,'walk');
 Array.from({length:8},(_,i)=>Array.from({length:8},(_,j)=>{const dir=path.join(tree,String(i),String(j));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'value.txt'),'owned');}));
 const controller=new AbortController(),reason=new Error('owned cancellation test');let reads=0;
 const traced={...fs,readdir(...args){reads++;if(reads===1)controller.abort(reason);return fs.readdir(...args);}};
 await assert.rejects(glob.glob('**/*',{cwd:tree,signal:controller.signal,fs:traced}),error=>error===reason);
 const atReject=reads;await new Promise(resolve=>setTimeout(resolve,40));
 assert.ok(atReject<=1,'aborted traversal must not fan out');assert.equal(reads,atReject,'no additional I/O after cancellation');
});

test('patched minimatch handles amplification pattern in a bounded subprocess',()=>{
 const script=`const {Minimatch}=require(${JSON.stringify(require.resolve('minimatch'))});const matcher=new Minimatch('a/**/../'.repeat(22)+'z',{optimizationLevel:2});matcher.match('a/z');`;
 const result=spawnSync(process.execPath,['--max-old-space-size=128','-e',script],{timeout:3000,windowsHide:true,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.error?.message);
});

console.log('Build dependency integration fixtures:',fixture);

test('actual build script preserves canonical timestamp through Windows PowerShell', {skip:process.platform!=='win32'},()=>{
 const receipt=path.join(fixture,'timestamp-input.json'),script=path.join(fixture,'timestamp-assignment.ps1'),expected='2026-10-31T07:59:42.374Z';
 fs.writeFileSync(receipt,JSON.stringify({application:{builtAt:expected}}));
 const runner=`param([string]$BuildScript,[string]$releaseInputsFile)
$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($BuildScript,[ref]$null,[ref]$errors)
if($errors.Count){throw 'Build script parse failed'}
$assignment=$ast.Find({param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$env:AVHUB_BUILD_TIMESTAMP'},$true)
if(-not $assignment){throw 'Frozen timestamp assignment missing'}
& ([scriptblock]::Create($assignment.Extent.Text))
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
Write-Output $env:AVHUB_BUILD_TIMESTAMP
`;fs.writeFileSync(script,runner);
 const shells=['powershell.exe'];
 const where=spawnSync('where.exe',['pwsh.exe'],{encoding:'utf8',windowsHide:true});
 if(where.status===0)shells.push(where.stdout.trim().split(/\r?\n/)[0]);
 // Like workflow commands, execute only this bounded assignment inline; do
 // not alter the machine's policy for unsigned .ps1 files.
 shells.forEach(shell=>{const result=spawnSync(shell,['-NoProfile','-Command',`& { ${runner} } -BuildScript $env:AVHUB_TEST_SCRIPT -releaseInputsFile $env:AVHUB_TEST_INPUT`],{env:{...process.env,AVHUB_TEST_SCRIPT:path.join(root,'scripts/build-windows.ps1'),AVHUB_TEST_INPUT:receipt},encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),expected);});
});
