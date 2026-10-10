// Native quit protection, with a simulated long commit and isolated empty DB.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
mkdirSync(path.join(root,'build'),{recursive:true});
const folder=mkdtempSync(path.join(root,'build','electron-data-commit-'));let desktop;
try{
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:folder,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'}});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置'}).waitFor();
  let identity='';page.on('response',async response=>{if(response.url().endsWith('/api/data-jobs/inspect')){try{identity=(await response.json()).id;}catch{}}});
  const origin=new URL(page.url()).origin;const payload=await(await page.context().request.get(`${origin}/api/backup`)).body();
  await page.getByRole('button',{name:'媒体库设置'}).click();await page.getByRole('tab',{name:'数据管理'}).click();
  await page.getByLabel('选择备份文件').setInputFiles({name:'empty.db',mimeType:'application/octet-stream',buffer:payload});await page.getByRole('button',{name:'校验并预览备份'}).click();
  await expect(page.getByRole('region',{name:'备份恢复预览'})).toBeVisible();assert.ok(identity);
  const state={id:identity,kind:'restore',state:'running',stage:'committing',done:0,total:0,cancellable:false,error:'',result:null};
  await page.route(`**/api/data-jobs/${identity}/restore`,route=>route.fulfill({status:202,json:state}));
  await page.route(`**/api/data-jobs/${identity}`,route=>route.fulfill({json:state}));
  await page.getByRole('button',{name:'恢复所选备份'}).click();await page.getByRole('dialog',{name:'恢复所选备份？',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
  await expect(page.getByText('提交恢复（不能取消）',{exact:true})).toBeVisible();
  await desktop.evaluate(({dialog})=>{dialog.showMessageBox=async(_window,options)=>{globalThis.__commitDialog=options;return {response:0,checkboxChecked:false};};});
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__commitDialog?.title)).toBe('正在提交媒体库恢复');
  assert.deepEqual(await desktop.evaluate(()=>globalThis.__commitDialog.buttons),['返回应用']);assert.equal(page.isClosed(),false);
  assert.ok(readFileSync(path.join(folder,'desktop.log'),'utf8').includes('quit-deferred-data-commit'));
  console.log('Native commit guard passed; returning to an idle test window.');
  // Remove the mocked UI commit; no real restore was performed in this test.
  page.once('dialog',dialog=>dialog.accept());
  await page.reload();await page.getByRole('button',{name:'媒体库设置'}).waitFor();
  const closed=desktop.waitForEvent('close',{timeout:20000}).then(()=>true,()=>false);
  await desktop.evaluate(({app,dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});setTimeout(()=>app.quit(),0);});
  assert.equal(await closed,true);desktop=null;
  console.log(JSON.stringify({passed:true,scope:'native quit protection with simulated commit, no source videos',report:folder}));
}catch(error){console.error('Native commit test failed:',error);throw error;
}finally{if(desktop){
  // Test-only: remove mocked renderer listeners before the graceful close.
  // Never bypass the production guard for an actual database installation.
  const page=desktop.windows()[0];
  if(page&&!page.isClosed()){
    page.on('dialog',dialog=>dialog.accept());
    await page.reload({timeout:10000}).catch(()=>{});
  }
  await desktop.evaluate(({app,dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});setTimeout(()=>app.quit(),0);}).catch(()=>{});
  await Promise.race([desktop.waitForEvent('close').catch(()=>{}),new Promise(resolve=>setTimeout(resolve,15000))]);
}}
