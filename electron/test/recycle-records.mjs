// Real desktop/system-bin acceptance. Every mutated item is created here in TEMP.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync,copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-recycle-records-');
const media=path.join(workspace,'media'),data=path.join(workspace,'profile');mkdirSync(media);
const files=['restore-中文🩷','delete','unrelated'].map(kind=>path.join(media,`AVHub-owned-${kind}-${randomUUID()}.mp4`));
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
for(const file of files)assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=25','-t','1','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true,timeout:15000}).status,0);
const hashes=files.map(digest);
function python(code,extra={}){
 const result=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',code],{cwd:root,env:{...process.env,PYTHONIOENCODING:'utf-8',...extra},encoding:'utf-8',windowsHide:true,timeout:60000});assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout.trim();
}
// Keep 64/128-bit IDs and nanosecond timestamps as strings across JS boundaries.
const stamps=files.map(file=>JSON.parse(python('import json,os; from app.file_operations import identity; print(json.dumps([str(v) for v in identity(os.environ["AVHUB_OWNED_FILE"])]))',{AVHUB_OWNED_FILE:file})));
const batch=[];
let desktop,page;
async function launch(){
 desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
}
try{
 await launch();
 await page.evaluate(async directory=>{await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});await fetch('/api/scan',{method:'POST'});},media);
 await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/scan')).json()).state),{timeout:20000}).toBe('completed');
 const entries=await page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).items);
 const ids=files.map(file=>entries.find(item=>item.path===file).id);
 const rootId=entries[0].root_id;
 await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'permissions',id,rename:false,recycle:true,permanentDelete:true}),rootId);
 await expect.poll(()=>page.evaluate(async()=>{const s=await(await fetch('/api/thumbnails')).json();return s.current==null&&s.pending===0;}),{timeout:20000}).toBe(true);
 await page.evaluate(async id=>{await fetch(`/api/media/${id}/favorite`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:true})});await fetch(`/api/media/${id}/progress`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({progress:0.5,updated_at:Date.now()})});},ids[0]);
 for(const id of ids.slice(0,2))await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recycle',id}),id);
 // This unrelated-to-AVHub-journal item proves the feature never clears a whole bin.
 await desktop.evaluate(async({shell},file)=>shell.trashItem(file),files[2]);
 await page.reload();await page.getByRole('button',{name:'回收记录',exact:true}).click();
 let panel=page.getByRole('dialog',{name:'回收记录',exact:true});
 await expect(panel.locator('.recycle-record-list>li')).toHaveCount(2,{timeout:30000});
 await expect(panel.locator('.is-available')).toHaveCount(2);
 await panel.getByRole('button',{name:'全选本页',exact:true}).click();await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(2);
 await panel.getByRole('button',{name:'反选本页',exact:true}).click();await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(0);
 await panel.getByRole('button',{name:'全选本页',exact:true}).click();await panel.getByRole('button',{name:'取消选择',exact:true}).click();await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(0);
 const records=await page.evaluate(async()=>(await(await fetch('/api/recycle-records')).json()).items);
 const restore=records.find(item=>item.media_id===ids[0]),remove=records.find(item=>item.media_id===ids[1]);
 assert.equal(await page.evaluate(async op=>(await fetch(`/api/recycle-records/${op}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',confirmed:true})})).status,remove.id),403);
 await assert.rejects(()=>page.evaluate(op=>window.avhubDesktop.fileOperation({action:'delete-record',id:op}),remove.id),/永久删除需要明确确认/);
 writeFileSync(files[0],'another isolated collision');
 await assert.rejects(()=>page.evaluate(op=>window.avhubDesktop.fileOperation({action:'restore-record',id:op}),restore.id),/同名/);
 assert.equal(readFileSync(files[0],'utf-8'),'another isolated collision');unlinkSync(files[0]);
 const restoreRow=panel.locator('li').filter({has:page.getByText(path.basename(files[0]),{exact:true})});await restoreRow.getByRole('button',{name:'恢复',exact:true}).click();
 await expect.poll(()=>existsSync(files[0]),{timeout:30000}).toBe(true);assert.equal(digest(files[0]),hashes[0]);
 await expect(panel.locator('.is-restored')).toHaveCount(1,{timeout:20000});
 const restored=await page.evaluate(async id=>(await(await fetch(`/api/media/${id}`)).json()),ids[0]);assert.equal(restored.favorite,1);assert.equal(restored.progress,0.5);assert.equal(restored.file_state,'normal');
 const deleteButton=panel.getByRole('button',{name:`永久删除 ${path.basename(files[1])}`,exact:true});
 await deleteButton.click();const confirm=page.getByRole('dialog',{name:'永久删除 1 个视频？',exact:true});await expect(confirm).toBeVisible();await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);
 await expect(deleteButton).toBeEnabled();await deleteButton.click();await confirm.getByRole('button',{name:'永久删除',exact:true}).click();
 await expect(panel.locator('.recycle-record-list>li')).toHaveCount(1,{timeout:30000});
 assert.equal(existsSync(files[1]),false);
 const remaining=JSON.parse(python('import json; from app.windows_recycle import WindowsRecycle; from app.file_operations import identity; w=WindowsRecycle(); print(json.dumps([[str(v) for v in identity(p)] for p in w.items()]))'));
 assert.equal(remaining.some(stamp=>JSON.stringify(stamp)===JSON.stringify(stamps[1])),false);
 assert.equal(remaining.some(stamp=>JSON.stringify(stamp)===JSON.stringify(stamps[2])),true);
 await page.screenshot({path:path.join(workspace,'recycle-records-dark.png')});
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';});await page.screenshot({path:path.join(workspace,'recycle-records-light.png')});
 await panel.getByRole('button',{name:'清除记录',exact:true}).click();await page.getByRole('dialog',{name:'清除回收历史？',exact:true}).getByRole('button',{name:'清除记录',exact:true}).click();
 await expect(panel.getByText('暂无回收记录',{exact:true})).toBeVisible({timeout:20000});assert.equal(digest(files[0]),hashes[0]);
 await panel.getByRole('button',{name:'关闭回收记录',exact:true}).click();await expect(panel).toHaveCount(0);
 // Six real, separately identifiable copies of an OWNED synthetic sample. This
 // measures native batch work, not a loading-indicator or mocked timing change.
 for(let i=0;i<6;i++){
   const file=path.join(media,`AVHub-owned-batch-${randomUUID()}.mp4`);copyFileSync(files[0],file);
   batch.push({file,stamp:JSON.parse(python('import json,os; from app.file_operations import identity; print(json.dumps([str(v) for v in identity(os.environ["AVHUB_OWNED_FILE"])]))',{AVHUB_OWNED_FILE:file}))});
 }
 await page.evaluate(()=>fetch('/api/scan',{method:'POST'}));await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/scan')).json()).state),{timeout:15000}).toBe('completed');
 await expect.poll(()=>page.evaluate(async()=>{const s=await(await fetch('/api/thumbnails')).json();return s.current==null&&s.pending===0;}),{timeout:20000}).toBe(true);
 const fresh=await page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).items);
 for(const item of batch)await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recycle',id}),fresh.find(value=>value.path===item.file).id);
 // Desktop UI batch confirmation and progress, in addition to direct bridge timing.
 await page.getByRole('button',{name:'回收记录',exact:true}).click();await expect(panel.locator('.is-available')).toHaveCount(6,{timeout:20000});
 await panel.getByRole('button',{name:'全选本页',exact:true}).click();await panel.getByRole('button',{name:'恢复所选',exact:true}).click();
 await page.getByRole('dialog',{name:'恢复 6 个视频？',exact:true}).getByRole('button',{name:'恢复所选',exact:true}).click();
 await expect(panel.locator('[data-state="success"]')).toHaveCount(6,{timeout:20000});await expect(panel.locator('.is-restored')).toHaveCount(6);
 for(const item of batch)assert.equal(digest(item.file),hashes[0]);
 await panel.getByRole('button',{name:'关闭回收记录',exact:true}).click();await expect(panel).toHaveCount(0);
 // Recycle the same OWNED samples again to measure a separate six-item API batch.
 for(const item of batch)await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recycle',id}),fresh.find(value=>value.path===item.file).id);
 const records2=(await page.evaluate(async()=>(await(await fetch('/api/recycle-records?refresh=true')).json()).items)).filter(item=>item.status==='available');
 const beforeStats=await page.evaluate(async()=>(await(await fetch('/api/diagnostics')).json()).recycle_bridge);
 const start=performance.now();const preview=await page.evaluate(ids=>window.avhubDesktop.fileOperation({action:'preview-records',recordIds:ids,recordAction:'restore'}),records2.map(item=>item.id));
 assert.equal(preview.records.filter(item=>item.eligible).length,6);
 for(const record of preview.records)await page.evaluate(({id,token})=>window.avhubDesktop.fileOperation({action:'restore-record',id,previewToken:token}),{id:record.id,token:preview.preview_token});
 await page.evaluate(token=>window.avhubDesktop.fileOperation({action:'release-record-preview',previewToken:token}),preview.preview_token);
 const elapsed=Math.round(performance.now()-start),afterStats=await page.evaluate(async()=>(await(await fetch('/api/diagnostics')).json()).recycle_bridge);
 assert.equal(afterStats.lists-beforeStats.lists,1);assert.ok(afterStats.starts-beforeStats.starts<=1);
 for(const item of batch)assert.equal(digest(item.file),hashes[0]);
 console.log(`Native batch evidence: 6 restores in ${elapsed} ms, namespace lists=${afterStats.lists-beforeStats.lists}, additional lease scans=${afterStats.lease_scans-beforeStats.lease_scans}, worker starts=${afterStats.starts-beforeStats.starts}. All restored byte hashes unchanged.`);
 // Inject ONLY metadata into the owned, stopped profile to represent the narrow
 // crash window after the native result and before its SQLite completion. This
 // is a restart harness, not an OS power-loss test. No native action is replayed.
 await desktop.close();desktop=null;
 python('import os,json,sqlite3; ids=json.loads(os.environ["AVHUB_OWNED_OPS"]); db=sqlite3.connect(os.environ["AVHUB_OWNED_DB"]); [db.execute("UPDATE recycle_actions SET state=\'dispatched\',error=\'\',finished_at=NULL WHERE recycle_id=?",(value,)) for value in ids]; [db.execute("UPDATE file_operations SET recycle_hidden=0,recycle_status=NULL WHERE id=?",(value,)) for value in ids]; db.execute("UPDATE media SET file_state=\'pending\',missing=1 WHERE id=(SELECT media_id FROM file_operations WHERE id=?)",(ids[0],));db.commit();db.close()',
   {AVHUB_OWNED_DB:path.join(data,'library.db'),AVHUB_OWNED_OPS:JSON.stringify([restore.id,remove.id])});
 await launch();
 panel=page.getByRole('dialog',{name:'回收记录',exact:true});
 const restartStats=await page.evaluate(async()=>(await(await fetch('/api/diagnostics')).json()).recycle_bridge);assert.equal(restartStats.starts,0);
 const recovered=await page.evaluate(async id=>(await(await fetch(`/api/media/${id}`)).json()),ids[0]);assert.equal(recovered.file_state,'normal');assert.equal(recovered.favorite,1);assert.equal(recovered.progress,.5);assert.equal(digest(files[0]),hashes[0]);
 await page.getByRole('button',{name:'回收记录',exact:true}).click();
 const reviewRow=panel.locator('li').filter({has:page.getByText(path.basename(files[1]),{exact:true})});await expect(reviewRow).toContainText('待核对',{timeout:20000});await expect(reviewRow.getByRole('button',{name:'核对结果',exact:true})).toBeVisible();
 await assert.rejects(()=>page.evaluate(id=>window.avhubDesktop.fileOperation({action:'delete-record',id,confirmed:true}),remove.id),/上次操作结果未确认/);
 await reviewRow.getByRole('button',{name:'核对结果',exact:true}).click();await expect(reviewRow).toContainText('回收站中未找到');assert.equal(existsSync(files[1]),false);
 await panel.getByRole('button',{name:'关闭回收记录',exact:true}).click();await expect(panel).toHaveCount(0);
 console.log('Owned Electron restart harness passed: metadata recovered without starting Shell; uncertain deletion was not replayed and required explicit read-only reconciliation.');
}finally{
 // Restore only surviving samples created by this test, by exact recorded identity.
 for(let i=0;i<files.length;i++)if(!existsSync(files[i]))python('import json,os; from pathlib import Path; from app.windows_recycle import WindowsRecycle; from app.file_operations import identity; w=WindowsRecycle(); expected=[int(v) for v in json.loads(os.environ["AVHUB_OWNED_STAMP"])]; matches=[p for p in w.items() if identity(p)==expected]; assert len(matches)<=1; [w.restore(p,Path(os.environ["AVHUB_OWNED_FILE"]),expected) for p in matches]',{AVHUB_OWNED_FILE:files[i],AVHUB_OWNED_STAMP:JSON.stringify(stamps[i])});
 assert.equal(existsSync(files[0]),true);assert.equal(existsSync(files[2]),true);
 for(const item of batch)if(!existsSync(item.file))python('import json,os; from pathlib import Path; from app.windows_recycle import WindowsRecycle; from app.file_operations import identity; w=WindowsRecycle(); expected=[int(v) for v in json.loads(os.environ["AVHUB_OWNED_STAMP"])]; matches=[p for p in w.items() if identity(p)==expected]; assert len(matches)<=1; [w.restore(p,Path(os.environ["AVHUB_OWNED_FILE"]),expected) for p in matches];w.close()',{AVHUB_OWNED_FILE:item.file,AVHUB_OWNED_STAMP:JSON.stringify(item.stamp)});
 if(desktop){let timer;try{await Promise.race([desktop.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned Electron cleanup timeout')),15000);})]);}finally{clearTimeout(timer);}}
}
console.log('Real Electron recycle records passed including clean exit: exact identity, conflict refusal, themed confirmation/cancel, restore preserves bytes/metadata, selected permanent delete, unrelated bin item untouched, history clear does not delete restored media.');
console.log('Owned acceptance workspace:',workspace);
