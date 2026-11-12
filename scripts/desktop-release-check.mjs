// Resumable local verification journal. Never builds packages or writes remotely.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

export function releaseChecks(root,packageDirectory){
 const checks=[
  {id:'dual-runtime',args:['scripts/check-dual-mpv-runtime.mjs']},
  {id:'source-materials',python:true,args:['scripts/audit-dual-mpv-sources.py']},
  {id:'retained-build-evidence',python:true,args:['scripts/verify-local-build-evidence.py']},
 ];
 if(packageDirectory){
  const directory=path.resolve(root,packageDirectory);
  if(path.dirname(directory).toLowerCase()!==path.join(root,'build').toLowerCase())throw new Error('Use a package directory directly inside build/');
  checks.push({id:'current-package-proof',args:['electron/release-evidence.cjs','verify',root,'build/desktop-release-inputs.json']},
   {id:'final-package-bytes',args:['electron/release-evidence.cjs','artifact',root,'build/desktop-release-inputs.json',path.join(directory,'win-unpacked')]});
 }
 return checks;
}

export function runReleaseChecks(root,directory,checks,execute,identify){
 const absolute=path.resolve(directory),build=path.join(root,'build');
 if(path.dirname(absolute).toLowerCase()!==build.toLowerCase()||!/^release-check-[a-zA-Z0-9_-]+$/.test(path.basename(absolute)))throw new Error('Owned release-check-* directory required');
 fs.mkdirSync(absolute,{recursive:true});
 if(fs.realpathSync(absolute).toLowerCase()!==absolute.toLowerCase())throw new Error('Release journal cannot be a link');
 const file=path.join(absolute,'journal.json');
 const journal=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schema:1,attempts:[]};
 if(journal.schema!==1||!Array.isArray(journal.attempts))throw new Error('Unknown release journal');
 const attempt={startedAt:new Date().toISOString(),sourceBefore:identify(),checks:[],passed:false};
 journal.attempts.push(attempt);
 const save=()=>fs.writeFileSync(file,JSON.stringify(journal,null,2)+'\n');save();
 // A resume keeps previous failure evidence but revalidates all prerequisites;
 // cached PASS alone never proves that source or runtime bytes remain intact.
 for(const check of checks){
  const result=execute(check),exitCode=result.status??1;
  const log=`attempt-${journal.attempts.length}-${check.id}.log`;
  fs.writeFileSync(path.join(absolute,log),(result.stdout??'')+(result.stderr??'')+(result.error?.message??''));
  attempt.checks.push({id:check.id,exitCode,log,status:exitCode===0?'PASS':'FAIL'});save();
  if(exitCode!==0){attempt.finishedAt=new Date().toISOString();save();return attempt;}
 }
 attempt.sourceAfter=identify();attempt.sourceChanged=attempt.sourceBefore!==attempt.sourceAfter;
 attempt.passed=!attempt.sourceChanged;attempt.finishedAt=new Date().toISOString();save();return attempt;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
 const packageArg=args.find(value=>value.startsWith('--package-dir=')),output=args.find(value=>value.startsWith('--journal='));
 if(args.some(value=>value!=='--run'&&value!=='--plan'&&!value.startsWith('--package-dir=')&&!value.startsWith('--journal=')))throw new Error('Unknown release check option');
 const checks=releaseChecks(root,packageArg?.slice('--package-dir='.length));
 if(!args.includes('--run'))console.log(JSON.stringify({scope:packageArg?'source-and-exact-package':'source-only',checks,packagesBuilt:false,remoteWrites:false},null,2));
 else{
  const directory=output?path.resolve(root,output.slice('--journal='.length)):fs.mkdtempSync(path.join(root,'build/release-check-'));
  const require=createRequire(import.meta.url),proof=require('../electron/release-evidence.cjs');
  const attempt=runReleaseChecks(root,directory,checks,check=>spawnSync(check.python?(process.env.AVHUB_PYTHON??'python'):process.execPath,check.args,{cwd:root,windowsHide:true,encoding:'utf8',timeout:300000,maxBuffer:8*1024**2}),()=>proof.fingerprint(proof.sourceFiles(root)));
  console.log(JSON.stringify({passed:attempt.passed,journal:path.join(directory,'journal.json'),scope:packageArg?'source-and-exact-package':'source-only',releaseApproval:false,packagesBuilt:false,remoteWrites:false}));
  if(!attempt.passed)process.exitCode=1;
 }
}
