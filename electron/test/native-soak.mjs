// Bounded real Electron + MPV concurrency acceptance. Mutations only in owned
// fixtures. An explicitly supplied index/ID opts into read-only real playback.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {nativeProcessMetrics} from './native-owned-process.mjs';
const root=path.resolve(import.meta.dirname,'../..'),seconds=Number(process.argv[2]||120);
const index=process.argv[3],realId=Number(process.argv[4]);
assert.ok(Number.isSafeInteger(seconds)&&seconds>=60&&seconds<=3600);
mkdirSync(path.join(root,'build'),{recursive:true});const data=mkdtempSync(path.join(root,'build','native-soak-'));
const media=path.join(data,'media');mkdirSync(media);let source=path.join(media,'Owned native.mkv');
if(index){assert.ok(path.isAbsolute(index)&&Number.isSafeInteger(realId)&&realId>0);const clone=spawnSync('python',['-c',`import os,sqlite3,json
from pathlib import Path
source=sqlite3.connect(Path(os.environ['SOAK_INDEX']).resolve().as_uri()+'?mode=ro',uri=True)
target=sqlite3.connect(str(Path(os.environ['SOAK_DATA'])/'library.db'));source.backup(target);source.close()
id=int(os.environ['SOAK_ID']);row=target.execute('SELECT path FROM media WHERE id=?',(id,)).fetchone();assert row
target.execute('DELETE FROM media WHERE id<>?',(id,))
for table in ('preferences','root_file_permissions'):target.execute('DELETE FROM '+table)
target.execute('UPDATE media SET custom_cover=NULL,progress=0,watched=0');target.commit();target.close();print(json.dumps(row[0]))`],{env:{...process.env,SOAK_INDEX:index,SOAK_DATA:data,SOAK_ID:String(realId)},encoding:'utf8',windowsHide:true});assert.equal(clone.status,0,clone.stderr);source=JSON.parse(clone.stdout);}
const owned=path.join(media,'Owned background.mkv');
const generated=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t',index?'2':'150','-c:v','libx264','-preset','ultrafast','-g','50','-pix_fmt','yuv420p',index?owned:source],{windowsHide:true,timeout:60000});
assert.equal(generated.status,0,String(generated.stderr));
if(!index){const cut=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-i',source,'-t','2','-c','copy',owned],{windowsHide:true,timeout:30000});assert.equal(cut.status,0,String(cut.stderr));}
for(let i=0;i<8;i++)copyFileSync(owned,path.join(media,`Owned cover ${i}.mkv`));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');const before={hash:hash(source),mtime:statSync(source).mtimeMs};
let desktop,parentPid,cleanExit=false;const measurements=[],errors=[];
try{
  desktop=await _electron.launch({args:[root,'--no-sandbox'],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});parentPid=await desktop.evaluate(()=>process.pid);
  const main=await desktop.firstWindow();main.on('pageerror',e=>errors.push(e.message));await main.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  const api=(url,method='GET',body)=>main.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result;},{url,method,body});
  await api('/api/preferences','PATCH',{values:{audio:{volume:0,muted:true},playerEngine:'mpv',resumeBehavior:'restart'}});
  const registered=await api('/api/roots','POST',{path:media});const scanUrl=`/api/scan?root_id=${registered.id}`;await api(scanUrl,'POST');
  await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
  const rows=(await api('/api/media?page=1&page_size=48')).items,item=rows.find(row=>row.path===source),id=item.id,backgroundRows=rows.filter(row=>row.path.startsWith(media+path.sep));
  await main.goto(new URL(`/?video=${id}`,main.url()).href);
  await expect(main.getByText('MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:30000});
  const session=await main.evaluate(async()=>(await window.avhubDesktop.nativePlayer('snapshot')).session);
  await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer='));main.setContentSize(820,600);main.showInactive();main.setAlwaysOnTop(true);});
  const overlay=desktop.windows().find(p=>p.url().includes(`nativePlayer=${session}`));overlay.on('pageerror',e=>errors.push(e.message));
  const state=()=>overlay.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
  const command=(action,value)=>overlay.evaluate(({action,value,session})=>window.avhubDesktop.nativePlayer(action,{session,value}),{action,value,session});
  await expect.poll(async()=>(await state()).phase,{timeout:30000}).toBe('ready');
  const initialCapture=await command('screenshot'),initialFrameHash=hash(initialCapture.path);
  const started=performance.now();
  for(let step=0;performance.now()-started<seconds*1000;step++){
    const paused=step%6===5;await command('pause',paused);
    if(step%6===0){copyFileSync(owned,path.join(media,`Owned discovery ${step}.mkv`));await api(scanUrl,'POST');for(const row of backgroundRows.slice(0,4))await api(`/api/media/${row.id}/thumbnail/retry`,'POST',{});}
    if(step%3===1){await command('seek',10+(step*7)%Math.max(20,Math.min(item.duration-30,seconds+40)));await expect.poll(async()=>(await state()).pendingSeek,{timeout:20000}).toBe(null);}
    const begin=Number((await state()).properties['time-pos']);await delay(4000);
    const s=await state();assert.equal(s.phase,'ready');assert.ok(!s.error,s.error);assert.equal(s.sourceLoads,1,'seeks never reopen source');
    if(!paused)assert.ok(Number(s.properties['time-pos'])>begin+.1,'playback clock advances between decoded output checks');
    const processes=nativeProcessMetrics(parentPid);assert.equal(processes.length,1,'exactly one owned decoder');
    const diagnostics=await api('/api/diagnostics'),scan=await api('/api/scan'),thumbnails=await api('/api/thumbnails');
    assert.equal(scan.error_count,0);assert.equal(thumbnails.failed,0);
    measurements.push({elapsedMs:Math.round(performance.now()-started),paused,position:s.properties['time-pos'],seeks:s.seeks,seekCorrections:s.seekCorrections,lastSeekMs:s.lastSeekMs,lastSeekTotalMs:s.lastSeekTotalMs,sourceLoads:s.sourceLoads,bufferingEvents:s.bufferingEvents,bufferingMs:s.bufferingMs,dropped:s.properties['frame-drop-count']??null,decoderDropped:s.properties['decoder-frame-drop-count']??null,processes,background:diagnostics.background_reads,thumbnails:{yielding:thumbnails.yielding,published:thumbnails.published,pending:thumbnails.pending},scan:{state:scan.state,errors:scan.error_count}});
    if(step%6===5)console.log(JSON.stringify(measurements.at(-1)));
  }
  await command('pause',true);const finalCapture=await command('screenshot');assert.notEqual(hash(finalCapture.path),initialFrameHash,'native decoded test-pattern pixels changed');
  assert.ok(measurements.some(m=>m.thumbnails.yielding),'normal playback yields covers');
  assert.ok(measurements.some(m=>m.thumbnails.published>measurements[0].thumbnails.published),'pause windows allow cover publication');
  assert.deepEqual(errors,[]);assert.deepEqual({hash:hash(source),mtime:statSync(source).mtimeMs},before,'source remains byte-identical and read-only');
  await desktop.close();desktop=null;assert.deepEqual(nativeProcessMetrics(parentPid),[],'no orphan decoder after normal exit');cleanExit=true;
}catch(error){errors.push(String(error));throw error;}
finally{
  if(desktop)await desktop.close().catch(()=>{});
  writeFileSync(path.join(data,'native-soak.json'),JSON.stringify({seconds,sample:index?{readOnly:true,mediaId:realId}: 'Synthetic 640x360 H.264 MKV',embedded:true,cleanExit,errors,measurements,limitations:['Single machine/sample, not all codecs, HDR or all-day acceptance.','Clock/MPV restart observations plus decoded PNG output, not monitor scanout.','OS cache is not cleared; sampled working set and handle counts are not proof of leak freedom.','Pause windows intentionally allow cover decoding. Background budget currently covers metadata/cover reads, not every filesystem operation.','Test window shown and temporarily pinned; desktop occlusion is not measured.']},null,2));
  console.log('Native soak report:',path.join(data,'native-soak.json'));
}
