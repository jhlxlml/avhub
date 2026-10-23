// Real Electron acceptance. Only move generated files inside this owned fixture.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,renameSync,existsSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const build=path.join(root,'build');mkdirSync(build,{recursive:true});
const folder=mkdtempSync(path.join(build,'electron-external-removal-'));
const media=path.join(folder,'media'),held=path.join(folder,'held'),profile=path.join(folder,'profile');
mkdirSync(media);mkdirSync(held);
const source=path.join(media,'External.S01E01.mp4'),other=path.join(media,'External.S01E02.mp4');
const encoded=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',source],{windowsHide:true,timeout:30000});
assert.equal(encoded.status,0,encoded.stderr?.toString());copyFileSync(source,other);
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const original=digest(source),report={restarts:[],errors:[],checks:[]};let desktop,page;
const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{
 const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value;
},{url,method,body});
async function launch(){
 const started=performance.now();
 desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 report.restarts.push({readyMs:performance.now()-started});
}
async function refresh(){
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/scan'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'刷新媒体库',exact:true}).click();
 const job=await(await response).json();
 await expect.poll(async()=>{const state=await api('/api/scan');return state?.id===job.id?state.state:'';},{timeout:30000}).toBe('completed');
}
try{
 await launch();
 await api('/api/roots','POST',{path:media});await refresh();await expect(page.locator('.card')).toHaveCount(2);
 const item=(await api('/api/media?page=1&sort=name')).items.find(row=>row.name===path.basename(source));assert.ok(item);
 await expect.poll(async()=>{const value=await api(`/api/media/${item.id}`);return Boolean(value.thumbnail_url);},{timeout:30000}).toBe(true);
 const cover=path.join(profile,'thumbnails',`${item.id}.jpg`);assert.ok(existsSync(cover));const coverHash=digest(cover);
 await api(`/api/media/${item.id}`,'PATCH',{title:'保留的自定义标题'});
 await api(`/api/media/${item.id}/favorite`,'PUT',{favorite:true});
 await api(`/api/media/${item.id}/progress`,'PUT',{progress:4});
 const list=await api('/api/playlists','POST',{name:'外部删除验收',media_id:item.id});
 // Simulate Explorer removal without deleting any original or losing the sample.
 const parked=path.join(held,path.basename(source));renameSync(source,parked);
 await refresh();await expect(page.locator('.card')).toHaveCount(1);
 assert.equal((await api('/api/media?page=1&favorite=true')).total,0);
 assert.equal((await api('/api/media?page=1&view=continue')).total,0);
 const missing=await api(`/api/media/${item.id}`);assert.equal(missing.missing,1);assert.equal(missing.title,'保留的自定义标题');assert.equal(missing.progress,4);
 const detail=await api(`/api/playlists/${list.id}?page=1`);assert.equal(detail.items.length,1);assert.equal(detail.items[0].missing,1);assert.equal(detail.playable_count,0);
 assert.equal(digest(cover),coverHash,'Referenced offline covers remain available; refresh is not destructive cache cleanup');
 report.checks.push('external removal hidden from library/favorites/continue; playlist retained offline; cover and personal metadata retained');
 // Restore the very same file identity. A refresh must repair availability, not duplicate it.
 renameSync(parked,source);await refresh();await expect(page.locator('.card')).toHaveCount(2);
 const restored=await api(`/api/media/${item.id}`);assert.equal(restored.missing,0);assert.equal(restored.favorite,1);assert.equal(restored.progress,4);assert.equal(restored.title,'保留的自定义标题');
 assert.equal((await api(`/api/playlists/${list.id}?page=1`)).playable_count,1);
 report.checks.push('same-file restoration preserves ID, title, favorite, progress and playlist');
 // An entire unavailable root must not invalidate its members.
 const offline=path.join(folder,'offline-media');renameSync(media,offline);await refresh();
 assert.equal((await api('/api/media?page=1')).total,2);assert.ok((await api('/api/scan')).error_count>0);
 renameSync(offline,media);await refresh();
 report.checks.push('offline root retains index and reports a scan warning');
 await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
 await expect(page.getByRole('tab',{name:'播放偏好',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 // The explicit cache-only workflow must work in the desktop, not just API mocks.
 renameSync(source,parked);await refresh();await expect(page.locator('.card')).toHaveCount(1);
 await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
 await page.getByRole('tab',{name:'数据管理',exact:true}).click();
 const cleanup=page.getByRole('region',{name:'失效视频与封面',exact:true});
 await cleanup.getByRole('button',{name:'预览失效封面',exact:true}).click();
 await expect(cleanup).toContainText('本页可清理 1 张');
 await cleanup.getByRole('button',{name:'选中本页可清理项',exact:true}).click();
 await cleanup.screenshot({path:path.join(folder,'missing-artwork-preview.png')});
 await cleanup.getByRole('button',{name:'清理所选封面（1）',exact:true}).click();
 await page.getByRole('dialog',{name:'清理所选自动封面？',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
 assert.ok(existsSync(cover),'Cancellation must leave generated art untouched');
 await cleanup.getByRole('button',{name:'清理所选封面（1）',exact:true}).click();
 await page.getByRole('dialog',{name:'清理所选自动封面？',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
 await expect(cleanup).toContainText('已清理 1 张自动封面');assert.equal(existsSync(cover),false);
 const retained=await api(`/api/media/${item.id}`);assert.equal(retained.missing,1);assert.equal(retained.thumbnail_url,null);assert.equal(retained.favorite,1);assert.equal(retained.progress,4);
 assert.equal((await api(`/api/playlists/${list.id}?page=1`)).items[0].id,item.id);
 assert.equal(digest(parked),original);
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 renameSync(parked,source);await refresh();await expect(page.locator('.card')).toHaveCount(2);
 await expect.poll(async()=>Boolean((await api(`/api/media/${item.id}`)).thumbnail_url),{timeout:30000}).toBe(true);
 assert.ok(existsSync(cover));assert.equal((await api(`/api/media/${item.id}`)).progress,4);
 report.checks.push('explicit themed preview/cancel/confirm removes only missing automatic artwork; restoration regenerates it with personal data intact');
 assert.equal(digest(source),original);assert.equal(digest(other),original);
 await desktop.close();desktop=null;
 for(let i=0;i<3;i++){
  await launch();await expect(page.locator('.card')).toHaveCount(2);
  assert.equal((await api(`/api/media/${item.id}`)).progress,4);
  await desktop.close();desktop=null;
 }
 assert.deepEqual(report.errors,[]);report.completed=true;report.sourceUnchanged=true;
}catch(error){
 report.failure=String(error);
 if(page&&!page.isClosed()){
  report.failureState={url:page.url(),body:await page.locator('body').innerText().catch(()=>''),requests:await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({name:r.name,duration:r.duration}))).catch(()=>[])};
  await page.screenshot({path:path.join(folder,'failure.png')}).catch(()=>{});
 }
 throw error;
}finally{
 if(desktop)await desktop.close().catch(error=>report.errors.push(String(error)));
 writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify(report,null,2));
 console.log('External removal acceptance:',path.join(folder,'acceptance.json'));
}
