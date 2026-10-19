// Real system-bin acceptance: only this generated GUID TEMP sample is mutated.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-recycle-shortcuts-'),media=path.join(workspace,'media');mkdirSync(media);
const source=path.join(media,`Owned shortcut ${randomUUID()}.mp4`);
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=25','-t','1','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true,timeout:15000}).status,0);
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();let desktop,page,api;
try{
 desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:path.join(workspace,'profile'),AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
 const registered=await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:20000}).toBe('completed');await expect.poll(async()=>{const status=await api('/api/thumbnails');return status.pending===0&&status.current==null;},{timeout:20000}).toBe(true);
 const item=(await api('/api/media?page=1')).items[0];await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'permissions',id,rename:false,recycle:true,permanentDelete:false}),registered.id);
 await api(`/api/media/${item.id}/favorite`,'PUT',{favorite:true});await api(`/api/media/${item.id}/progress`,'PUT',{progress:.5,updated_at:Date.now()});await page.reload();
 await page.getByRole('button',{name:'更多操作 '+item.title,exact:true}).click();await page.getByRole('menuitem',{name:'移入系统回收站',exact:true}).click();await page.getByRole('button',{name:'确认移入回收站',exact:true}).click();
 await expect(page.getByRole('button',{name:'恢复视频',exact:true})).toBeVisible();assert.equal(existsSync(source),false);await page.getByRole('button',{name:'恢复视频',exact:true}).click();await expect.poll(()=>existsSync(source)).toBe(true);assert.equal(hash(),before);await expect(page.locator('.toast')).toHaveCount(0);
 let recovered=await api(`/api/media/${item.id}`);assert.equal(recovered.favorite,1);assert.equal(recovered.progress,.5);assert.equal(recovered.file_state,'normal');
 const second=await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recycle',id}),item.id);assert.match(second.operation_id,/^[a-f0-9]{32}$/);assert.equal(existsSync(source),false);
 await page.getByRole('button',{name:'最近回收',exact:true}).click();const recent=page.getByRole('dialog',{name:'最近回收',exact:true});await expect(recent).toContainText(path.basename(source));await recent.getByRole('button',{name:'恢复',exact:true}).click();await expect.poll(()=>existsSync(source)).toBe(true);assert.equal(hash(),before);await expect(recent).toContainText('已恢复');
 await recent.getByRole('button',{name:'查看全部回收记录',exact:true}).click();const records=page.getByRole('dialog',{name:'回收记录',exact:true});await expect(records).toBeVisible();await records.getByRole('button',{name:'关闭回收记录',exact:true}).click();
 recovered=await api(`/api/media/${item.id}`);assert.equal(recovered.favorite,1);assert.equal(recovered.progress,.5);assert.equal((await api(`/api/file-permissions?ids=${registered.id}`))[0].permanentDelete,false);
 console.log('Native recycle shortcuts passed: GUID-owned sample, single toast restoration, recent restoration, exact operation IDs, byte/personal metadata preservation and permanent-delete permission remains off.');
}finally{
 // If a test assertion fails while the generated item is in the bin, restore
 // only a uniquely matching journal-owned record through the normal bridge.
 if(desktop&&api&&!existsSync(source)){
  const entries=(await api('/api/recycle-records?refresh=true')).items.filter(item=>item.source===source&&item.status==='available');assert.equal(entries.length,1);
  await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'restore-record',id}),entries[0].id);assert.equal(hash(),before);
 }
 if(desktop){let timer;try{await Promise.race([desktop.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned recycle shortcut exit timeout')),30000);})]);}finally{clearTimeout(timer);}}
}
