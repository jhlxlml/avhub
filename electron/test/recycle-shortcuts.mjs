// Real system-bin acceptance: only this generated GUID TEMP sample is mutated.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-recycle-shortcuts-'),media=path.join(workspace,'media');mkdirSync(media);
mkdirSync(path.join(root,'build'),{recursive:true});const evidence=mkdtempSync(path.join(root,'build','recycle-shortcuts-'));
const readDelay=Number(process.argv.find(arg=>arg.startsWith('--read-delay-ms='))?.split('=')[1]||0);
assert.ok(Number.isInteger(readDelay)&&readDelay>=0&&readDelay<=9000);
const report={passed:false,phase:'startup',readDelayInjectedMs:readDelay,requests:[],errors:[],limitations:['Owned generated sample only; injected read delay is not measured Shell performance.']};
const deadline=async(promise,ms,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})]);}finally{clearTimeout(timer);}};
const source=path.join(media,`Owned shortcut ${randomUUID()}.mp4`);
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=25','-t','1','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true,timeout:15000}).status,0);
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();let desktop,page,api,failure;
try{
 desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:path.join(workspace,'profile'),AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const pending=new WeakMap();
 page.on('request',request=>{const url=new URL(request.url());if(!url.pathname.startsWith('/api/recycle-records'))return;const entry={route:url.pathname.replace(/[a-f0-9]{32}/g,':record'),method:request.method(),refresh:url.searchParams.get('refresh')==='true',started:performance.now()};if(report.requests.length<80){report.requests.push(entry);pending.set(request,entry);}});
 page.on('response',response=>{const entry=pending.get(response.request());if(entry)entry.status=response.status();});
 const finish=(request,error)=>{const entry=pending.get(request);if(entry){entry.elapsedMs=Math.round(performance.now()-entry.started);delete entry.started;if(error)entry.transportError=error;}};
 page.on('requestfinished',request=>finish(request));page.on('requestfailed',request=>finish(request,request.failure()?.errorText||'failed'));
 api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
 const registered=await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:20000}).toBe('completed');await expect.poll(async()=>{const status=await api('/api/thumbnails');return status.pending===0&&status.current==null;},{timeout:20000}).toBe(true);
 const item=(await api('/api/media?page=1')).items[0];await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'permissions',id,rename:false,recycle:true,permanentDelete:false}),registered.id);
 await api(`/api/media/${item.id}/favorite`,'PUT',{favorite:true});await api(`/api/media/${item.id}/progress`,'PUT',{progress:.5,updated_at:Date.now()});await page.reload();
 await page.getByRole('button',{name:'更多操作 '+item.title,exact:true}).click();await page.getByRole('menuitem',{name:'移入系统回收站',exact:true}).click();await page.getByRole('button',{name:'确认移入回收站',exact:true}).click();
 await expect(page.getByRole('button',{name:'恢复视频',exact:true})).toBeVisible();assert.equal(existsSync(source),false);await page.getByRole('button',{name:'恢复视频',exact:true}).click();await expect.poll(()=>existsSync(source)).toBe(true);assert.equal(hash(),before);await expect(page.locator('.toast')).toHaveCount(0);
 let recovered=await api(`/api/media/${item.id}`);assert.equal(recovered.favorite,1);assert.equal(recovered.progress,.5);assert.equal(recovered.file_state,'normal');
 const second=await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'recycle',id}),item.id);assert.match(second.operation_id,/^[a-f0-9]{32}$/);assert.equal(existsSync(source),false);
 report.phase='recent read';
 if(readDelay){let armed=true;await page.route('**/api/recycle-records?**',async route=>{if(armed&&route.request().method()==='GET'){armed=false;await delay(readDelay);}await route.continue();});}
 // Await the one real UI request, not another polling fetch or a 5-second text
 // guess. The production read has a 15-second deadline; this test allows it to
 // finish or report an error, then separately bounds rendering.
 const responsePromise=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/recycle-records'&&url.searchParams.get('refresh')==='true'&&response.request().method()==='GET';},{timeout:16000});
 const readStarted=performance.now();await page.getByRole('button',{name:'最近回收',exact:true}).click();
 const response=await responsePromise;assert.equal(response.status(),200);
 const payload=await deadline(response.json(),16000,'Recent record response body did not complete');
 report.recentReadMs=Math.round(performance.now()-readStarted);
 const recentDiagnostics=await deadline(api('/api/diagnostics'),5000,'Recent read diagnostics timed out');report.recentNative={bridge:recentDiagnostics.recycle_bridge,snapshot:recentDiagnostics.recycle_snapshot};
 const exact=payload.items.filter(value=>value.id===second.operation_id);assert.equal(exact.length,1);assert.equal(exact[0].status,'available');assert.equal(exact[0].name,path.basename(source));
 const recent=page.getByRole('dialog',{name:'最近回收',exact:true});await expect(recent).toContainText(path.basename(source),{timeout:3000});
 await expect(recent.getByRole('button',{name:'恢复',exact:true})).toBeEnabled();
 report.phase='recent restore';await recent.getByRole('button',{name:'恢复',exact:true}).click();await expect.poll(()=>existsSync(source),{timeout:30000}).toBe(true);assert.equal(hash(),before);await expect(recent).toContainText('已恢复',{timeout:15000});
 await recent.getByRole('button',{name:'查看全部回收记录',exact:true}).click();const records=page.getByRole('dialog',{name:'回收记录',exact:true});await expect(records).toBeVisible();await records.getByRole('button',{name:'关闭回收记录',exact:true}).click();
 recovered=await api(`/api/media/${item.id}`);assert.equal(recovered.favorite,1);assert.equal(recovered.progress,.5);assert.equal((await api(`/api/file-permissions?ids=${registered.id}`))[0].permanentDelete,false);
 report.passed=true;report.phase='completed';
}catch(error){failure=error;report.errors.push(String(error?.stack||error));
 if(page){await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});}
}finally{
 try{
 if(api){const diagnostics=await deadline(api('/api/diagnostics'),5000,'Diagnostic request timed out');report.native={bridge:diagnostics.recycle_bridge,snapshot:diagnostics.recycle_snapshot};}
 }catch(error){report.diagnosticError=String(error);}
 try{
 // If a test assertion fails while the generated item is in the bin, restore
 // only a uniquely matching journal-owned record through the normal bridge.
 if(desktop&&api&&!existsSync(source)){
  const entries=(await deadline(api('/api/recycle-records?refresh=true'),20000,'Owned cleanup read timed out')).items.filter(item=>item.source===source&&item.status==='available');assert.equal(entries.length,1);
  await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'restore-record',id}),entries[0].id);assert.equal(hash(),before);
 }
 }catch(error){failure??=error;report.errors.push('Owned cleanup: '+String(error));report.passed=false;}
 finally{
  try{if(desktop)await deadline(desktop.close(),30000,'Owned recycle shortcut exit timeout');}
  catch(error){failure??=error;report.errors.push(String(error));report.passed=false;}
  report.sourceUnchanged=existsSync(source)&&hash()===before;
  writeFileSync(path.join(evidence,'acceptance.json'),JSON.stringify(report,null,2));
 }
}
console.log('Native recycle shortcuts:',JSON.stringify({passed:report.passed,report:path.join(evidence,'acceptance.json')}));
if(failure)throw failure;
