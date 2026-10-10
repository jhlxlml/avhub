// All mutations and the real system-recycle acceptance use unique TEMP samples.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),workspace=realpathSync(mkdtempSync(path.join(tmpdir(),'avhub-file-acceptance-')));
const data=path.join(workspace,'profile'),media=path.join(workspace,'media');mkdirSync(media);
const basename='AVHub-owned-'+randomUUID();let file=path.join(media,basename+'.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=25','-t','3','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true,timeout:15000}).status,0);
const subtitle=path.join(media,basename+'.zh.srt');writeFileSync(subtitle,'1\n00:00:00,000 --> 00:00:01,000\nOwned subtitle\n');const subtitleDigest=createHash('sha256').update(readFileSync(subtitle)).digest('hex');
const digest=filename=>createHash('sha256').update(readFileSync(filename)).digest('hex'),before=digest(file);let desktop,page;
async function launch(){desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();}
async function read(id){return page.evaluate(async id=>(await(await fetch('/api/media/'+id)).json()),id);}
try{
  await launch();await page.evaluate(async directory=>{await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});await fetch('/api/scan',{method:'POST'});},media);
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).total),{timeout:15000}).toBe(1);
  await expect.poll(()=>page.evaluate(async()=>{const scan=await(await fetch('/api/scan')).json();return scan.state;})).toBe('completed');
  const id=await page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).items[0].id);await page.reload();
  await page.locator('.media-more').click();await expect(page.getByRole('menuitem',{name:'重命名文件',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
  const refused=await page.evaluate(async id=>{const response=await fetch('/api/file-operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({media_id:id,action:'rename',stem:'forbidden'})});return response.status;},id);assert.equal(refused,403);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  for(const name of ['允许重命名','允许系统回收']){const checkbox=page.getByRole('checkbox',{name:name+' '+media,exact:true});await checkbox.click();await page.getByRole('dialog',{name:'开启文件整理权限？',exact:true}).getByRole('button',{name:'开启权限',exact:true}).click();await expect(checkbox).toBeChecked();await expect(page.getByRole('button',{name:'关闭设置',exact:true})).toBeEnabled();}
  console.log('Native directory opt-in confirmed for the owned TEMP media folder.');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.evaluate(async id=>{await fetch('/api/media/'+id+'/favorite',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:true})});await fetch('/api/media/'+id+'/progress',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({progress:1,updated_at:Date.now()})});await fetch('/api/playlists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'保留片单',media_ids:[id]})});},id);
  await expect.poll(()=>page.evaluate(async()=>{const status=await(await fetch('/api/thumbnails')).json();return status.current_media_id??null;})).toBe(null);
  await page.locator('.media-more').click();await page.getByRole('menuitem',{name:'重命名文件',exact:true}).click();await page.getByLabel('新文件名').fill('重命名⭐'+basename);
  await expect(page.locator('.file-action-target')).toContainText(basename+'.mp4');await expect(page.locator('.file-action-cover img')).toBeVisible();
  await page.getByRole('button',{name:'确认重命名',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const renamed=await read(id);assert.equal(renamed.id,id);assert.equal(renamed.title,'重命名⭐'+basename);assert.equal(renamed.favorite,1);assert.equal(renamed.progress,1);assert.equal(digest(renamed.path),before);
  assert.equal(renamed.external_subtitles[0].path,subtitle);assert.equal(digest(subtitle),subtitleDigest);
  const successToast=page.getByText('文件名和视频标题已同步更新',{exact:true});await expect(successToast).toBeVisible();await expect(successToast).toHaveCount(0,{timeout:6500});
  console.log('Native rename preserved bytes and media records.');
  const op=await page.evaluate(async()=>(await(await fetch('/api/file-operations')).json()).items[0].id);
  await assert.rejects(()=>page.evaluate(op=>window.avhubDesktop.fileOperation({action:'undo',id:op}),op),/文件操作参数无效/);
  await desktop.close();desktop=null;await launch();file=renamed.path;assert.equal(digest(file),before);assert.equal((await read(id)).title,'重命名⭐'+basename);
  await desktop.evaluate(({shell})=>{globalThis.realTrash=shell.trashItem;shell.trashItem=async()=>{throw new Error('Synthetic non-recyclable refusal');};});
  await assert.rejects(()=>page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recycle',id}),id),/Synthetic non-recyclable/);assert.equal(digest(file),before);assert.equal((await read(id)).file_state,'normal');
  await desktop.evaluate(({shell})=>{shell.trashItem=async()=>{const error=new Error('Owned synthetic permission refusal');error.code='EACCES';throw error;};});
  await assert.rejects(()=>page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recycle',id}),id),/系统拒绝访问/);assert.equal(digest(file),before);assert.equal((await read(id)).file_state,'normal');
  await desktop.evaluate(({shell})=>{shell.trashItem=globalThis.realTrash;});
  await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recycle',id}),id);assert.equal(existsSync(file),false);assert.equal((await read(id)).file_state,'recycled');
  assert.equal(await page.evaluate(async()=>(await(await fetch('/api/file-states?state=recycled')).json()).total),1);
  // Restore ONLY the uniquely-named owned sample. No other bin item is touched.
  const restored=spawnSync('powershell',['-NoProfile','-NonInteractive','-Command',`$p=$env:AVHUB_OWNED_RESTORE_PATH; $s=New-Object -ComObject Shell.Application; $items=@($s.Namespace(10).Items() | Where-Object { $_.ExtendedProperty('System.Recycle.DeletedFrom') -eq [IO.Path]::GetDirectoryName($p) -and ($_.Name -eq [IO.Path]::GetFileName($p) -or $_.Name -eq [IO.Path]::GetFileNameWithoutExtension($p)) }); if($items.Count -ne 1){throw 'Owned recycle item could not be identified uniquely'}; $items[0].InvokeVerb('undelete')`],{env:{...process.env,AVHUB_OWNED_RESTORE_PATH:file},windowsHide:true,timeout:30000});assert.equal(restored.status,0,String(restored.stderr));
  await expect.poll(()=>existsSync(file)).toBe(true);assert.equal(digest(file),before);
  await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recheck',id}),id);await expect.poll(async()=>(await read(id)).file_state).toBe('normal');assert.equal((await read(id)).favorite,1);assert.equal((await read(id)).progress,1);
  await assert.rejects(()=>page.evaluate(id=>window.avhubDesktop.fileOperation({action:'forget',id}),id),/只能清理普通缺失/);assert.equal(digest(file),before);
  await page.evaluate(()=>fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{autoNext:false}})}));
  await page.goto(new URL('/?video='+id,page.url()).href);const resume=page.getByRole('button',{name:'从头开始',exact:true});await expect(resume.or(page.getByRole('button',{name:'暂停',exact:true})).first()).toBeVisible();if(await resume.isVisible())await resume.click();await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2)).toBe(true);await page.locator('video').evaluate(v=>v.pause());const sourceBefore=await page.locator('video').evaluate(v=>v.currentSrc);
  // Native window-fullscreen acceptance. Web Fullscreen API containment and mouse
  // input are separately checked in the explicitly labelled renderer harness.
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(true));await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
  const quality=page.getByRole('button',{name:'画质',exact:true});await quality.focus();await quality.press('Enter');await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('720p');
  const confirmation=page.getByRole('dialog',{name:'启用有损兼容播放？',exact:true});await expect(confirmation).toBeVisible();await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);assert.equal(await page.locator('video').evaluate(v=>v.currentSrc),sourceBefore);
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(false));await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  const offline=path.join(workspace,'owned-offline.mp4');renameSync(file,offline);await page.evaluate(()=>fetch('/api/scan',{method:'POST'}));await expect.poll(async()=>(await read(id)).missing).toBe(1);
  await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();await page.getByRole('region',{name:'文件状态管理'}).getByRole('button',{name:'仅移除记录',exact:true}).click();
  await page.getByRole('dialog',{name:'仅移除缺失记录？',exact:true}).getByRole('button',{name:'移除记录',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/file-states')).json()).total)).toBe(0);assert.equal(digest(offline),before);assert.equal(digest(subtitle),subtitleDigest);
  console.log('Real Electron file management passed: default deny, native-header boundary, themed directory opt-in, rename/title persistence after restart, removed undo command, unchanged bytes and media ID/records, refusal without permanent fallback, real Windows recycle and uniquely identified TEMP-only restoration.');
}finally{if(desktop)await desktop.close();}
