// Rebuild frontend and Electron TS from a verified source-review snapshot.
// npm uses the exact lock and local cache, with dependency lifecycle scripts
// disabled. Backend/native binaries and clean-machine acceptance are separate.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),build=path.join(root,'build');
const source=JSON.parse(readFileSync(path.join(build,'application-source-review-latest.json'),'utf8')).folder;
const relative=path.relative(build,source);if(relative.startsWith('..')||path.isAbsolute(relative)||lstatSync(source).isSymbolicLink())throw new Error('Expected owned source review snapshot');
const inventoryFile=path.join(source,'source-review-inventory.json'),inventory=JSON.parse(readFileSync(inventoryFile,'utf8'));
const folder=mkdtempSync(path.join(build,'application-build-replay-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={kind:'verified-snapshot-frontend-and-electron-build-replay',source,folder,inventorySha256:hash(readFileSync(inventoryFile)),passed:false,dependencyLifecycleScriptsRun:false,cleanEnvironment:false,backendRebuiltFromSnapshot:false,nativeRuntimeRebuilt:false};
try{
 for(const item of inventory.files){
  const original=path.resolve(source,item.path),within=path.relative(source,original);
  if(within.startsWith('..')||path.isAbsolute(within)||!lstatSync(original).isFile())throw new Error('Invalid source member');
  const content=readFileSync(original);if(content.length!==item.size||hash(content)!==item.sha256)throw new Error('Source snapshot changed: '+item.path);
  const target=path.join(folder,item.path);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(original,target);
  if(hash(readFileSync(target))!==item.sha256)throw new Error('Source copy changed');
 }
 report.sourceCopiesVerified=true;
 const npm=process.env.npm_execpath??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 if(!existsSync(npm))throw new Error('npm CLI not found beside Node');
 for(const args of [['ci','--ignore-scripts','--offline','--no-audit','--no-fund'],['run','build'],['run','build:electron']]){
  console.log('Replay: npm '+args.join(' '));
  execFileSync(process.execPath,[npm,...args],{cwd:folder,env:{...process.env,...(inventory.buildIdentityReference.built_at?{AVHUB_BUILD_TIMESTAMP:inventory.buildIdentityReference.built_at}:{})},windowsHide:true,stdio:'pipe',timeout:180000});
 }
 const expected=inventory.buildIdentityReference,actual=JSON.parse(readFileSync(path.join(folder,'app/build-info.json'),'utf8'));
 report.buildId=actual.build_id;report.expectedBuildId=expected.build_id;
 if(actual.build_id!==expected.build_id||actual.version!==expected.version)throw new Error('Replayed source fingerprint differs');
 const originalNotices=JSON.parse(readFileSync(path.join(root,'app/static/third-party/frontend-notices.json'),'utf8'));
 const replayedNotices=JSON.parse(readFileSync(path.join(folder,'app/static/third-party/frontend-notices.json'),'utf8'));
 const identities=value=>value.packages.map(p=>({name:p.name,version:p.version,notices:p.notices}));
 if(JSON.stringify(identities(originalNotices))!==JSON.stringify(identities(replayedNotices)))throw new Error('Replayed frontend dependency notice identity differs');
 report.electronModules=readdirSync(path.join(folder,'electron/dist')).filter(n=>n.endsWith('.js')).map(name=>({name,identical:hash(readFileSync(path.join(folder,'electron/dist',name)))===hash(readFileSync(path.join(root,'electron/dist',name)))}));
 if(!report.electronModules.length||report.electronModules.some(item=>!item.identical))throw new Error('Replayed Electron JS differs from tested build');
 report.frontendNoticesMatch=true;report.generatedBuildTimestampMayDiffer=!inventory.buildIdentityReference.built_at;report.frozenBuildTimestamp=inventory.buildIdentityReference.built_at??null;report.passed=true;
}catch(error){report.error=String(error.stack||error);if(error.stderr)report.commandStderr=String(error.stderr).slice(-8000);throw error;}
finally{writeFileSync(path.join(folder,'replay-report.json'),JSON.stringify(report,null,2)+'\n');writeFileSync(path.join(build,'application-build-replay-latest.json'),JSON.stringify({folder,passed:report.passed},null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(folder,'replay-report.json')}));}
