// Real Electron acceptance. All mutations use newly-created GUID-named TEMP samples.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,copyFileSync,readFileSync,existsSync} from 'node:fs';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-batch-acceptance-'),media=path.join(workspace,'media');mkdirSync(media);
const prefix='AVHub-owned-batch-'+randomUUID(),files=[1,2,3].map(id=>path.join(media,`${prefix}-${id}.mp4`));
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=25','-t','3','-c:v','libx264','-pix_fmt','yuv420p',files[0]],{windowsHide:true,timeout:15000}).status,0);
copyFileSync(files[0],files[1]);copyFileSync(files[0],files[2]);const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex'),hashes=files.map(digest);
let desktop,page;
function restore(file){
  assert.ok(files.includes(file));
  const result=spawnSync('powershell',['-NoProfile','-NonInteractive','-Command',`$p=$env:AVHUB_OWNED_RESTORE_PATH; $s=New-Object -ComObject Shell.Application; $items=@($s.Namespace(10).Items() | Where-Object { $_.ExtendedProperty('System.Recycle.DeletedFrom') -eq [IO.Path]::GetDirectoryName($p) -and ($_.Name -eq [IO.Path]::GetFileName($p) -or $_.Name -eq [IO.Path]::GetFileNameWithoutExtension($p)) }); if($items.Count -ne 1){throw 'Owned item cannot be identified uniquely'}; $items[0].InvokeVerb('undelete')`],{env:{...process.env,AVHUB_OWNED_RESTORE_PATH:file},windowsHide:true,timeout:30000});assert.equal(result.status,0,String(result.stderr));
}
async function api(route){return page.evaluate(async route=>(await(await fetch(route)).json()),route);}
async function selectAll(expected=3){
  const bulk=page.getByRole('button',{name:'批量整理',exact:true});if(await bulk.getAttribute('aria-pressed')==='true')await bulk.click();await bulk.click();await page.getByRole('button',{name:'选中本页',exact:true}).click();await page.getByRole('button',{name:'所选移入回收站',exact:true}).click();await expect(page.getByRole('dialog',{name:'批量移入系统回收站',exact:true})).toContainText(`可回收 ${expected} 个`);
}
async function start(){await page.getByRole('button',{name:'回收 3 个视频',exact:true}).click();await page.getByRole('button',{name:'确认回收',exact:true}).click();}
try{
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:path.join(workspace,'data'),AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  await page.evaluate(async directory=>{await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});await fetch('/api/scan',{method:'POST'});},media);
  await expect.poll(async()=>(await api('/api/media?page=1')).total).toBe(3);await expect.poll(async()=>(await api('/api/scan')).state).toBe('completed');await page.reload();await expect(page.locator('.card img.thumbnail-ready')).toHaveCount(3,{timeout:15000});
  const rows=(await api('/api/media?page=1')).items,ids=rows.map(item=>item.id);
  // A same-origin renderer request without the native header cannot preview files.
  assert.equal(await page.evaluate(async ids=>(await fetch('/api/file-operations/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({media_ids:ids})})).status,ids),403);
  await selectAll(0);
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('checkbox',{name:'允许系统回收 '+media,exact:true}).click();await page.getByRole('button',{name:'开启权限',exact:true}).click();await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.evaluate(async ids=>{for(const id of ids){await fetch('/api/media/'+id+'/favorite',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:true})});await fetch('/api/media/'+id+'/progress',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({progress:1,updated_at:Date.now()})});}},ids);
  // Hold the current trusted operation before shell execution; stopping must not
  // cancel it or invoke the remaining files after it completes.
  await desktop.evaluate(({shell})=>{globalThis.actualTrash=shell.trashItem;globalThis.releaseBatch=null;shell.trashItem=async source=>{await new Promise(resolve=>{globalThis.releaseBatch=resolve;});return globalThis.actualTrash(source);};});
  await selectAll();await start();await expect.poll(()=>desktop.evaluate(()=>typeof globalThis.releaseBatch==='function')).toBe(true);await page.getByRole('button',{name:'停止后续任务',exact:true}).click();await desktop.evaluate(()=>globalThis.releaseBatch());
  const dialog=page.getByRole('dialog',{name:'批量移入系统回收站',exact:true});await expect(dialog).toContainText('已回收 1 · 失败 0 · 跳过 0 · 未执行 2');await dialog.getByRole('button',{name:'完成',exact:true}).click();
  const gone=files.filter(file=>!existsSync(file));assert.equal(gone.length,1);for(let i=0;i<3;i++)if(existsSync(files[i]))assert.equal(digest(files[i]),hashes[i]);restore(gone[0]);await expect.poll(()=>existsSync(gone[0])).toBe(true);
  const restoredId=rows.find(item=>item.path===gone[0]).id;await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recheck',id}),restoredId);await page.reload();
  // Now inject one refusal while the other two use the real Windows Recycle Bin.
  await desktop.evaluate(({shell},failure)=>{shell.trashItem=async source=>{if(source===failure)throw new Error('Owned synthetic system refusal');return globalThis.actualTrash(source);};},files[1]);
  await selectAll();await start();await expect(dialog).toContainText('已回收 2 · 失败 1 · 跳过 0');assert.equal(existsSync(files[1]),true);assert.equal(digest(files[1]),hashes[1]);assert.equal(existsSync(files[0]),false);assert.equal(existsSync(files[2]),false);
  for(const item of rows){const record=await api('/api/media/'+item.id);assert.equal(record.favorite,1);assert.equal(record.progress,1);}
  await dialog.getByRole('button',{name:'完成',exact:true}).click();for(const file of [files[0],files[2]])restore(file);for(let i=0;i<3;i++){await expect.poll(()=>existsSync(files[i])).toBe(true);assert.equal(digest(files[i]),hashes[i]);}
  await desktop.evaluate(({shell})=>{shell.trashItem=globalThis.actualTrash;});
  console.log('Real Electron batch recycling passed: native-only preview, default deny, directory opt-in, current-item completion on stop, untouched later files, real system recycle with partial failure, preserved metadata, uniquely identified TEMP-only restoration and unchanged bytes.');
}finally{if(desktop)await desktop.close();}
