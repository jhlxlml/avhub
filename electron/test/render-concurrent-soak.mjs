import {placeTestMedia} from './media-pool.mjs';
// Actual Electron + read-only original source; scanning/cover mutations are
// restricted to generated samples in this owned test workspace.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,createReadStream,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {playbackFixture} from './playback-fixtures.mjs';
const root=path.resolve(import.meta.dirname,'../..'),seconds=Number(process.argv[2]??1200),id=Number(process.argv[3]??1240);
assert.ok(Number.isInteger(seconds)&&seconds>=60&&seconds<=5400);assert.ok(Number.isSafeInteger(id)&&id>0);
const directory=mkdtempSync(path.join(root,'build/render-concurrent-soak-')),media=path.join(directory,'owned-scan-media');mkdirSync(media);
const basic=playbackFixture('basic');for(let n=0;n<12;n++)placeTestMedia(basic,path.join(media,'Cover '+n+'.mp4'));
const clone=spawnSync('python',['-X','utf8','-c',`import sqlite3,sys
from pathlib import Path
s=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True);t=sqlite3.connect(sys.argv[2]);s.backup(t);s.close()
t.execute('DELETE FROM media WHERE id<>?',(int(sys.argv[3]),))
for table in ('preferences','root_file_permissions','thumbnail_jobs'):t.execute('DELETE FROM '+table)
t.execute('UPDATE media SET progress=0,watched=0,custom_cover=NULL');t.commit();t.close()`,path.join(root,'AVHub-data/library.db'),path.join(directory,'library.db'),String(id)],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(clone.status,0,clone.stderr);
const identity=async file=>{const info=statSync(file),hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return {size:info.size,mtime:info.mtimeMs,sha256:hash.digest('hex')};};
const report={kind:'real-Electron-embedded-MPV-scan-cover-concurrency',seconds,id,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),runtimeCandidate:process.env.AVHUB_RENDER_RUNTIME_CANDIDATE,samples:[],seeks:[],errors:[],passed:false,limits:'Bounded single-machine original-media run; actual GPU receipts and native counters, not physical scanout or all-day leak certification.'};
let desktop,page,original;
try{
 desktop=await _electron.launch({args:[root],cwd:directory,env:{...process.env,AVHUB_DATA_DIR:directory,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{RenderHostClient}=require(app.getAppPath()+'/electron/dist/renderHostClient.js'),open=RenderHostClient.prototype.open;RenderHostClient.prototype.open=async function(...args){const result=await open.apply(this,args);globalThis.__concurrentClient=this;return result;};});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error(await response.text());return response.json();},{url,method,body});
 original=await api('/api/media/'+id);const before=await identity(original.path);report.sourceBefore=before;assert.ok(original.duration>60);
 const scanRoot=await api('/api/roots','POST',{path:media});await api('/api/thumbnails/pause','POST');await api('/api/scan?root_id='+scanRoot.id,'POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,mpvSeekPolicy:'fast',resumeBehavior:'restart',autoNext:false,hoverPreview:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>{window.__concurrent=null;window.__concurrentComplete=null;window.avhubDesktop.onRenderState(s=>{window.__concurrent=s;if(s.pendingSeek===null&&s.seekDiagnostics&&s.seekDiagnostics.seekId===s.presented?.seekId)window.__concurrentComplete=s;});});
 await page.getByRole('button',{name:'播放 '+original.title,exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__concurrent?.phase),{timeout:30000}).toBe('ready');await api('/api/thumbnails/resume','POST');
 const began=performance.now();let step=0,lastFrame=0,lastClock=null;
 while(performance.now()-began<seconds*1000){
  if(step%6===0){
   placeTestMedia(basic,path.join(media,'Discovered '+step+'.mp4'));await api('/api/scan?root_id='+scanRoot.id,'POST');
   const previous=await page.evaluate(()=>window.__concurrent.seekDiagnostics?.seekId??0),target=Math.round(original.duration*([.12,.55,.28,.72][Math.floor(step/6)%4])*100)/100;
   await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((slider,target)=>{slider.value=String(target);slider.dispatchEvent(new Event('input',{bubbles:true}));},target);
   await expect.poll(()=>page.evaluate(previous=>window.__concurrentComplete?.seekDiagnostics.seekId>previous,previous),{timeout:20000}).toBe(true);report.seeks.push(await page.evaluate(()=>window.__concurrentComplete.seekDiagnostics));lastClock=null;
  }
  await page.waitForTimeout(Math.min(10000,Math.max(1,seconds*1000-(performance.now()-began))));
  const s=await page.evaluate(()=>window.__concurrent),thumbnails=await api('/api/thumbnails'),scan=await api('/api/scan');
  assert.equal(s.phase,'ready');assert.equal(s.sourceLoads,1);assert.equal(s.properties.pause,false);assert.ok(s.presented.serial>lastFrame,'Actual GPU receipt must advance');if(lastClock!==null)assert.ok(s.positionSec>lastClock+.1,'Decoded source clock must advance');lastFrame=s.presented.serial;lastClock=s.positionSec;
  assert.ok(s.properties['hwdec-current']&&s.properties['hwdec-current']!=='no');assert.equal(thumbnails.yielding,true);assert.equal(thumbnails.failed,0);assert.ok(!thumbnails.error);assert.notEqual(scan.state,'failed');assert.equal(scan.error_count,0);
  const resources=await desktop.evaluate(async({app})=>({native:await globalThis.__concurrentClient.resources(),electron:app.getAppMetrics().map(p=>({type:p.type,privateKiB:p.memory.privateBytes,workingSetKiB:p.memory.workingSetSize,cpu:p.cpu.percentCPUUsage}))}));
  report.samples.push({elapsedMs:performance.now()-began,position:s.positionSec,frame:s.presented.serial,decoderDrops:s.properties['decoder-frame-drop-count'],outputDrops:s.properties['frame-drop-count'],transport:s.transport,resources,thumbnails,scan:{state:scan.state,error_count:scan.error_count}});
  if(step%6===5){
   await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__concurrent.properties.pause)).toBe(true);await expect.poll(async()=>(await api('/api/thumbnails')).yielding).toBe(false);
   await page.waitForTimeout(8000);const covers=await api('/api/thumbnails');report.samples.at(-1).pauseWindow={published:covers.published,pending:covers.pending};assert.equal(covers.failed,0);assert.ok(!covers.error);
   await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__concurrent.properties.pause)).toBe(false);lastClock=null;
   console.log(JSON.stringify({seconds:Math.round((performance.now()-began)/1000),frames:s.presented.serial,covers:covers.published,seeks:report.seeks.length}));
  }
  writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));step++;
 }
 report.elapsedMs=performance.now()-began;assert.ok(report.elapsedMs>=seconds*1000);assert.ok(report.samples.some(s=>s.pauseWindow?.published>0),'Actual pause windows must publish covers');assert.deepEqual(report.errors,[]);
 const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
 const early=report.samples.filter(s=>s.elapsedMs>=Math.min(120000,seconds*250)&&s.elapsedMs<seconds*500),late=report.samples.filter(s=>s.elapsedMs>=seconds*750);assert.ok(early.length&&late.length);
 report.resources={};for(const metric of ['nativePrivateBytes','nativeHandles','electronPrivateKiB','nativeGpuBytes']){
  const value=s=>metric==='nativePrivateBytes'?s.resources.native.privateBytes:metric==='nativeHandles'?s.resources.native.handles:metric==='nativeGpuBytes'?s.resources.native.gpuMemory.CurrentUsage:s.resources.electron.reduce((sum,p)=>sum+p.privateKiB,0);
  const first=median(early.map(value)),last=median(late.map(value));assert.ok(Number.isFinite(first)&&Number.isFinite(last));const growth=Math.max(0,last-first),limit=metric==='nativeHandles'?64:metric==='electronPrivateKiB'?256*1024:256*1024**2;report.resources[metric]={earlyMedian:first,lateMedian:last,positiveGrowth:growth,limit};assert.ok(growth<=limit,metric+' exceeded bounded growth budget');
 }
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active,{timeout:30000}).toBe(false);await page.waitForTimeout(2000);report.idle=await api('/api/thumbnails');report.sourceAfter=await identity(original.path);assert.deepEqual(report.sourceAfter,before);report.sourceUnchanged=true;
 await desktop.close();desktop=null;const log=readFileSync(path.join(directory,'desktop.log'),'utf8');assert.ok(log.includes('shutdown-complete'));report.closes=log.split('\n').filter(line=>line.includes('render-player-closed ')).map(line=>JSON.parse(line.slice(line.indexOf('render-player-closed ')+21)));assert.equal(report.closes.length,1);const closed=report.closes[0];assert.equal(closed.helperAlive,false);assert.equal(closed.sourceLeaseReleased,true);assert.equal(closed.transport.imports,closed.transport.released);assert.equal(closed.transport.leases,closed.transport.closedLeases);report.passed=true;
}catch(error){report.error=String(error.stack??error);throw error;}
finally{await desktop?.close();writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(path.join(directory,'report.json'));}
