// Natural-media Electron startup regression. The source and original index
// are read only; the cloned index and all generated state stay in build/.
// Completed frame receipts prove target progress. Different image hashes are
// not an independent reference-frame or physical-display quality comparison.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),index=path.resolve(process.argv[2]??''),id=Number(process.argv[3]);
assert.ok(process.argv[2]&&Number.isSafeInteger(id)&&id>0);
const data=mkdtempSync(path.join(root,'build/render-startup-reported-'));
const copy=spawnSync('python',['-c',`import os,sqlite3
from pathlib import Path
s=sqlite3.connect(Path(os.environ['REAL_SEEK_INDEX']).as_uri()+'?mode=ro',uri=True)
t=sqlite3.connect(str(Path(os.environ['REAL_SEEK_DATA'])/'library.db'));s.backup(t);s.close()
t.execute('DELETE FROM media WHERE id<>?',(int(os.environ['REAL_SEEK_ID']),))
for name in ('preferences','root_file_permissions'):t.execute('DELETE FROM '+name)
t.execute('UPDATE media SET progress=0,watched=0,custom_cover=NULL');t.commit();t.close()`],{env:{...process.env,REAL_SEEK_INDEX:index,REAL_SEEK_DATA:data,REAL_SEEK_ID:String(id)},windowsHide:true,encoding:'utf8',timeout:30000});
assert.equal(copy.status,0,copy.stderr);

let desktop,page;const report={kind:'real-electron-reported-native-startup',completed:false};
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 const media=await api(`/api/media/${id}`);assert.ok(path.resolve(media.path).toLowerCase().startsWith('e:\\downloads\\'));const before=statSync(media.path);report.source={codec:media.video_codec,width:media.width,height:media.height,size:before.size,mtime:before.mtimeMs};
 await desktop.evaluate((_,root)=>{const require=process.getBuiltinModule('node:module').createRequire(root+'/package.json'),cp=require('node:child_process'),{renderRuntimeLayout}=require(root+'/electron/dist/renderRuntimeLayout.js'),expected=renderRuntimeLayout(root,false,process.resourcesPath,process.env.AVHUB_RENDER_RUNTIME_CANDIDATE).host.toLowerCase(),spawn=cp.spawn;globalThis.__reportedNative=[];cp.spawn=function(file,args,options){const child=spawn.call(this,file,args,options);if(String(file).toLowerCase()===expected){const row={stderr:'',pid:child.pid};globalThis.__reportedNative.push(row);child.stderr.on('data',b=>{row.stderr=(row.stderr+b.toString()).slice(-8192);});child.once('exit',(code,signal)=>Object.assign(row,{code,signal}));}return child;};},root);
 await api('/api/thumbnails/pause','POST');await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,resumeBehavior:'restart',autoNext:false,hoverPreview:false,audio:{volume:0,muted:true}}});await page.reload();await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__reportedState=s));await page.getByRole('button',{name:'播放 '+media.title,exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__reportedState?.phase==='ready'?'ready':document.body.innerText.includes('原生播放启动失败')?'failed':'waiting'),{timeout:30000}).not.toBe('waiting');
 report.native=await desktop.evaluate(()=>globalThis.__reportedNative);report.state=await page.evaluate(()=>{const s=window.__reportedState;return s&&{phase:s.phase,videoSize:s.videoSize,presented:s.presented,properties:s.properties};});report.failureText=await page.locator('.native-error').allTextContents();assert.equal(report.state?.phase,'ready','Reported natural source did not start');
 await page.waitForTimeout(500);await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__reportedState.properties.pause)).toBe(true);report.frame=await page.evaluate(()=>window.__reportedState.presented);assert.ok(report.frame?.serial>0);
 const hashes=[];for(const target of [12.12,62.44]){await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((n,t)=>{n.value=String(t);n.dispatchEvent(new Event('input',{bubbles:true}));},target);await expect.poll(()=>page.evaluate(t=>window.__reportedState.pendingSeek===null&&Math.abs(window.__reportedState.presented.positionSec-t)<.15,target),{timeout:15000}).toBe(true);hashes.push(createHash('sha256').update(await page.locator('.native-render-canvas').screenshot()).digest('hex'));}assert.notEqual(hashes[0],hashes[1]);report.differentTargetImages=true;
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);const after=statSync(media.path);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);report.sourceStatUnchanged=true;report.completed=true;
}catch(error){report.error=String(error.stack||error);if(desktop)report.native=await desktop.evaluate(()=>globalThis.__reportedNative).catch(()=>null);throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({completed:report.completed,report:path.join(data,'report.json'),native:report.native}));}
