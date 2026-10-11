// Real Electron acceptance. External changes below touch ONLY created TEMP videos.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,renameSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-identity-');
const media=path.join(workspace,'media');mkdirSync(media);const original=path.join(media,'Original.mp4'),renamed=path.join(media,'外部改名🩷.mp4');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function video(file,color){assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i',`color=c=${color}:s=320x180:r=25`,'-t','2','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true,timeout:15000}).status,0);}
video(original,'navy');const before=hash(original);const subtitle=path.join(media,'Original.zh.srt');writeFileSync(subtitle,'1\n00:00:00,000 --> 00:00:01,000\nOwned subtitle\n');const subHash=hash(subtitle);
let desktop;
try{
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:path.join(workspace,'profile'),AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
  const registered=await api('/api/roots','POST',{path:media});
  const scan=async()=>{await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:15000}).toBe('completed');};await scan();
  const id=(await api('/api/media?page=1')).items[0].id;
  await api(`/api/media/${id}`,'PATCH',{title:'我的标题',tags:['owned'],rating:5});await api(`/api/media/${id}/favorite`,'PUT',{favorite:true});await api(`/api/media/${id}/progress`,'PUT',{progress:1,updated_at:Date.now()});await api('/api/playlists','POST',{name:'身份验收片单',media_id:id});
  renameSync(original,renamed);await scan();const moved=await api(`/api/media/${id}`);
  assert.equal(moved.path,renamed);assert.equal(moved.title,'我的标题');assert.equal(moved.favorite,1);assert.equal(moved.progress,1);assert.equal(hash(renamed),before);assert.equal(hash(subtitle),subHash);assert.equal(moved.external_subtitles[0].path,subtitle);
  const replacement=path.join(workspace,'owned-replacement.mp4');video(replacement,'red');renameSync(replacement,renamed);const newer=hash(renamed),mtime=statSync(renamed).mtimeMs;await scan();
  const held=await api(`/api/media/${id}`);assert.equal(held.file_state,'review');assert.equal(held.progress,1);assert.equal((await api('/api/media?page=1')).total,0);
  await expect.poll(async()=>{const value=await api('/api/thumbnails');return value.current==null&&value.pending===0;},{timeout:15000}).toBe(true);
  await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  await expect(page.locator('.source-change-panel')).toContainText('文件身份已变化');await page.getByRole('button',{name:'作为新视频',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'作为新视频收录？',exact:true});await confirm.getByRole('button',{name:'重新收录',exact:true}).click();
  await expect(page.locator('.source-change-panel')).toContainText('暂无待确认');const fresh=(await api('/api/media?page=1')).items[0];
  assert.notEqual(fresh.id,id);assert.equal(fresh.favorite,0);assert.equal(fresh.progress,0);assert.deepEqual(fresh.tags,[]);assert.equal(hash(renamed),newer);assert.equal(statSync(renamed).mtimeMs,mtime);assert.equal(hash(subtitle),subHash);
  const permissions=(await api(`/api/file-permissions?ids=${registered.id}`))[0];assert.equal(permissions.rename,false);assert.equal(permissions.recycle,false);assert.equal(permissions.permanentDelete,false);
  // A timestamp/content-metadata change is ambiguous, even with the same file ID.
  // Only the user's explicit keep decision transfers personal metadata to it.
  await api(`/api/media/${fresh.id}/favorite`,'PUT',{favorite:true});await api(`/api/media/${fresh.id}/progress`,'PUT',{progress:.5,updated_at:Date.now()});
  const touched=spawnSync(process.env.AVHUB_PYTHON||'python',['-c','import os; p=os.environ["AVHUB_OWNED_TOUCH"];s=os.stat(p);os.utime(p,ns=(s.st_atime_ns,s.st_mtime_ns+2000000000))'],{env:{...process.env,AVHUB_OWNED_TOUCH:renamed},windowsHide:true});assert.equal(touched.status,0);
  await scan();await expect.poll(async()=>(await api('/api/thumbnails')).current).toBe(null);
  // Close and reopen Settings to reload its independent source-state panel.
  await expect(page.getByRole('button',{name:'关闭设置',exact:true})).toBeEnabled();await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  await expect(page.locator('.source-change-panel')).toContainText('源文件有变化');await page.getByRole('button',{name:'保留原媒体信息',exact:true}).click();await page.getByRole('dialog',{name:'保留原媒体信息？',exact:true}).getByRole('button',{name:'确认保留',exact:true}).click();
  await expect(page.locator('.source-change-panel')).toContainText('暂无待确认');const retained=await api(`/api/media/${fresh.id}`);assert.equal(retained.favorite,1);assert.equal(retained.progress,.5);assert.equal(hash(renamed),newer);
  await expect(page.getByRole('button',{name:'关闭设置',exact:true})).toBeEnabled();await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  console.log('Real Electron identity acceptance: external rename kept identity/personal metadata/subtitle bytes; replacement quarantined; themed explicit reset created fresh identity without source mutation. All filesystem permissions remained disabled.');
}finally{if(desktop)await desktop.close();}
