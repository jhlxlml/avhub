// Real Electron control. No Playwright, inspector connection, GC or cache purge.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,createReadStream,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
import {nativeProcessMetrics} from './native-owned-process.mjs';

const root=path.resolve(import.meta.dirname,'../..'),source=process.argv[2];
assert.equal(process.platform,'win32','This real-media control requires Windows');
const number=(name,fallback)=>Number(process.argv.find(x=>x.startsWith(`--${name}=`))?.split('=')[1]??fallback);
const mediaId=number('media-id',0),cycles=number('cycles',12),idleSeconds=number('idle-seconds',60),seconds=number('seconds',0);
const walkPages=process.argv.includes('--walk'),phase=process.argv.find(x=>x.startsWith('--phase='))?.split('=')[1]??'mixed';
assert.ok(source&&path.isAbsolute(source),'Explicit authorized index path required');
assert.ok(Number.isSafeInteger(mediaId)&&mediaId>0);
assert.ok(Number.isSafeInteger(cycles)&&cycles>=2&&cycles<=100);
assert.ok(Number.isSafeInteger(idleSeconds)&&idleSeconds>=0&&idleSeconds<=300);
assert.ok(Number.isSafeInteger(seconds)&&seconds>=0&&seconds<=7200);
assert.ok(['scroll','mixed'].includes(phase));
const workspace=ownedTemporaryWorkspace('avhub-no-inspector-'),profile=path.join(workspace,'profile');mkdirSync(profile);
const clone=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',
`import os,sqlite3,json,shutil
from pathlib import Path
original=Path(os.environ['AVHUB_INDEX']).resolve(); target=Path(os.environ['AVHUB_CLONE']).resolve()
src=sqlite3.connect(original.as_uri()+'?mode=ro',uri=True); dst=sqlite3.connect(str(target/'library.db'));src.backup(dst);src.close()
prefix='E:'+chr(92)+'downloads'+chr(92)
dst.execute('DELETE FROM media WHERE lower(substr(path,1,?))<>lower(?)',(len(prefix),prefix));dst.execute('DELETE FROM roots WHERE id NOT IN (SELECT DISTINCT root_id FROM media)')
tables={r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
for t in ('thumbnail_jobs','file_operations','recycle_actions','source_changes','media_subtitle_links','scan_checkpoint','root_file_permissions'):
 if t in tables:dst.execute('DELETE FROM '+t)
dst.execute('INSERT OR REPLACE INTO thumbnail_control(id,paused) VALUES(1,1)');dst.execute('DELETE FROM playlist_items WHERE media_id NOT IN (SELECT id FROM media)')
copied=0
for mid,thumb,cover in dst.execute('SELECT id,thumbnail,custom_cover FROM media').fetchall():
 for key,value in [('thumbnail',thumb),('custom_cover',cover)]:
  if not value:continue
  candidate=(original.parent/value).resolve(); destination=(target/value).resolve()
  if not candidate.is_relative_to(original.parent) or not destination.is_relative_to(target) or candidate.suffix.lower() not in ('.jpg','.jpeg','.png','.webp') or not candidate.is_file():dst.execute('UPDATE media SET '+key+'=NULL WHERE id=?',(mid,));continue
  destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(candidate,destination);copied+=1
item=dst.execute('SELECT path,width,height,duration FROM media WHERE id=?',(int(os.environ['AVHUB_SAMPLE_ID']),)).fetchone()
assert item and item[0].lower().startswith(prefix.lower())
dst.commit();print(json.dumps({'videos':dst.execute('SELECT COUNT(*) FROM media').fetchone()[0],'covers':copied,'sample':dict(zip(('path','width','height','duration'),item))}));dst.close()`],
{cwd:root,env:{...process.env,PYTHONUTF8:'1',AVHUB_INDEX:source,AVHUB_CLONE:profile,AVHUB_SAMPLE_ID:String(mediaId)},encoding:'utf8',windowsHide:true,timeout:60000});
assert.equal(clone.status,0,clone.stderr);const fixture=JSON.parse(clone.stdout);assert.ok(fixture.videos>1000&&fixture.covers>100);
const identity=async()=>{const digest=createHash('sha256');for await(const chunk of createReadStream(fixture.sample.path))digest.update(chunk);const stat=statSync(fixture.sample.path);return {sha256:digest.digest('hex'),size:stat.size,mtime:stat.mtimeMs};};
const before=await identity();
const manifest={root,workspace,profile,mediaId,cycles,idleSeconds,seconds,walkPages,phase,fixture,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8'))};
const config=path.join(workspace,'run.json');writeFileSync(config,JSON.stringify(manifest,null,2));
const env={...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:workspace,AVHUB_SMOKE_TEST:'0',AVHUB_NO_INSPECTOR_CONFIG:config};
// Do not inherit headless or debugger switches from another harness.
delete env.AVHUB_HEADLESS_TEST;delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const child=spawn(createRequire(import.meta.url)('electron'),[path.join(root,'electron/test/desktop-memory-no-inspector.cjs')],{cwd:workspace,env,stdio:'inherit',windowsHide:true});
console.log('No-inspector report:',path.join(workspace,'memory.json'));
const timeout=setTimeout(()=>{console.error('Owned control exceeded its safety deadline');child.kill();},(seconds?seconds+idleSeconds+180:cycles*70+idleSeconds+120)*1000);
let result;
try{result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});}finally{clearTimeout(timeout);}
const file=path.join(workspace,'memory.json'),report=JSON.parse(readFileSync(file,'utf8'));
report.exit=result;report.sourceIdentityVerified=JSON.stringify(before)===JSON.stringify(await identity());
report.remainingOwnedMpv=nativeProcessMetrics(child.pid);report.cleanExit=result.code===0&&report.completed&&report.targetReached===true&&report.errors.length===0&&(seconds?report.cycles.length>=2:report.cycles.length===cycles)&&report.remainingOwnedMpv.length===0;
writeFileSync(file,JSON.stringify(report,null,2));
assert.equal(report.sourceIdentityVerified,true);assert.equal(report.cleanExit,true,JSON.stringify(report.errors));
console.log(JSON.stringify({completed:report.completed,cleanExit:report.cleanExit,sourceIdentityVerified:report.sourceIdentityVerified,cycles:report.cycles.length,report:file}));
