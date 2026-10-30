// Explicit source/range; normal Electron without inspector during the baseline.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,statSync,openSync,readSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),source=process.argv[2];
const option=(name,fallback)=>Number(process.argv.find(value=>value.startsWith(`--${name}=`))?.split('=')[1]??fallback);
const start=option('start',0),end=option('end',0);
const softwareDecodeControl=process.argv.includes('--software-decode-control');
assert.ok(source&&path.isAbsolute(source));assert.ok(start>=0&&end>start&&end-start<=1200);
assert.ok(path.resolve(source).toLowerCase().startsWith('e:\\downloads\\'),'Explicit authorized read-only source required');
const folder=mkdtempSync(path.join(root,'build','real-segment-')),profile=path.join(folder,'profile');
const identity=()=>{
 const stat=statSync(source,{bigint:true}),file=openSync(source,'r'),hash=createHash('sha256');
 try{for(const offset of [0,Math.max(0,Number(stat.size)-1024**2)]){const buffer=Buffer.alloc(1024**2);const read=readSync(file,buffer,0,buffer.length,offset);hash.update(buffer.subarray(0,read));}}
 finally{closeSync(file);}
 return {size:String(stat.size),mtimeNs:String(stat.mtimeNs),sampledHeadTailSha256:hash.digest('hex'),sampledBytes:2*1024**2};
};
const before=identity();
const seed=spawnSync(process.env.AVHUB_PYTHON||'python',[path.join(root,'electron/test/seed-original-probe.py'),source,profile],{cwd:root,windowsHide:true,encoding:'utf8',timeout:45000});
assert.equal(seed.status,0,seed.stderr||seed.stdout);
const settings=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',`import json,sqlite3,sys
from pathlib import Path
p=Path(sys.argv[1]); source=Path(sys.argv[2]); d=sqlite3.connect(p/'library.db')
d.execute("UPDATE media SET progress=?,modified=?,name='authorized-source.mp4',title='只读播放诊断样本'",(float(sys.argv[3]),source.stat().st_mtime))
for key,value in dict(resumeBehavior='resume',playerEngine='chromium',playbackSpeed=1,hoverPreview=False,autoNext=False,privacyMode=False,audio=dict(volume=0,muted=True)).items():
 d.execute('INSERT OR REPLACE INTO preferences(key,value,updated_at) VALUES(?,?,0)',(key,json.dumps(value)))
d.commit();d.close()` ,profile,source,String(start)],{cwd:root,windowsHide:true,encoding:'utf8',timeout:15000,env:{...process.env,PYTHONUTF8:'1'}});
assert.equal(settings.status,0,settings.stderr);
const config={root,folder,profile,start,end,softwareDecodeControl,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),metadata:JSON.parse(seed.stdout.trim().split(/\r?\n/).at(-1))};
const configFile=path.join(folder,'run.json');writeFileSync(configFile,JSON.stringify(config));
const env={...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:folder,AVHUB_REAL_SEGMENT_CONFIG:configFile,AVHUB_SMOKE_TEST:'0'};
for(const key of ['AVHUB_HEADLESS_TEST','ELECTRON_RUN_AS_NODE','NODE_OPTIONS'])delete env[key];
const child=spawn(createRequire(import.meta.url)('electron'),[path.join(root,'electron/test/real-segment-playback.cjs'),...(softwareDecodeControl?['--disable-accelerated-video-decode']:[])],{cwd:folder,env,stdio:'inherit',windowsHide:true});
console.log('Read-only segment report:',path.join(folder,'segment.json'));
const safety=setTimeout(()=>{console.error('Owned diagnostic exceeded safety deadline');child.kill();},(end-start+240)*1000);
let exit;try{exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});}finally{clearTimeout(safety);}
const file=path.join(folder,'segment.json'),report=JSON.parse(readFileSync(file,'utf8'));
report.exit=exit;report.sourceIdentityVerified=JSON.stringify(before)===JSON.stringify(identity());
report.sourceIdentityMethod='size/mtimeNs and read-only SHA-256 of first/last 1 MiB; not full-file hashing';
report.cleanExit=exit.code===0&&report.completed&&report.errors.length===0;
writeFileSync(file,JSON.stringify(report,null,2));
assert.equal(report.sourceIdentityVerified,true);assert.equal(report.cleanExit,true,JSON.stringify(report.errors));
console.log(JSON.stringify({report:file,completed:report.completed,cleanExit:report.cleanExit,sourceIdentityVerified:report.sourceIdentityVerified}));
