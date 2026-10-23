// Real Electron native permission writes. Only newly created TEMP directories.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-directory-controls-');
const artifacts=path.join(root,'build',path.basename(workspace));mkdirSync(artifacts,{recursive:true});
const media=path.join(workspace,'media');mkdirSync(media);writeFileSync(path.join(media,'owned-sentinel.txt'),'unchanged');
const report={build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),completed:false,errors:[],permissionCycles:0,removalCancellations:0};
let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:path.join(workspace,'profile'),AVHUB_APP_HOME:workspace,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const open=()=>page.getByRole('button',{name:'媒体库设置',exact:true}).click();
 const add=async()=>{await page.getByRole('textbox',{name:'目录路径',exact:true}).fill(media);await page.getByRole('button',{name:'添加目录',exact:true}).click();await expect(page.locator('.directory-setting-row')).toHaveCount(1);};
 await open();await add();console.log('Owned directory added');
 const row=page.locator('.directory-setting-row'),remove=row.getByRole('button',{name:/^移出媒体库 /});
 for(let i=0;i<6;i++){
  await remove.click();const confirm=page.getByRole('dialog',{name:'从媒体库移除目录？',exact:true});await expect(confirm).toBeVisible();
  if(i%2)await page.keyboard.press('Escape');else await confirm.getByRole('button',{name:'取消',exact:true}).click();
  await expect(confirm).toHaveCount(0);await expect(remove).toBeEnabled();await expect(remove).toBeFocused();report.removalCancellations++;console.log('Removal cancellation',i);
 }
 await row.getByRole('button',{name:/^文件权限 /}).click();
 for(let i=0;i<3;i++)for(const label of ['允许重命名','允许系统回收','允许永久删除']){
  console.log('Permission cycle',i,label);const checkbox=row.getByRole('checkbox',{name:`${label} ${media}`,exact:true});
  await expect(checkbox).toBeEnabled();await checkbox.click();
  const confirm=page.getByRole('dialog',{name:label==='允许永久删除'?'开启永久删除权限？':'开启文件整理权限？',exact:true});
  await expect(confirm).toBeVisible();await confirm.getByRole('button',{name:'取消',exact:true}).click();await expect(confirm).toHaveCount(0);await expect(checkbox).not.toBeChecked();await expect(checkbox).toBeEnabled();
  await checkbox.click();await confirm.getByRole('button',{name:'开启权限',exact:true}).click();await expect(checkbox).toBeChecked();await expect(checkbox).toBeEnabled();
  await checkbox.click();await expect(checkbox).not.toBeChecked();await expect(checkbox).toBeEnabled();report.permissionCycles++;
 }
 console.log('Permission cycles complete');for(let i=0;i<3;i++){
  await remove.click();await page.getByRole('dialog',{name:'从媒体库移除目录？',exact:true}).getByRole('button',{name:'移除目录',exact:true}).click();await expect(row).toHaveCount(0);await add();
 }
 await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.showInactive();});
 await page.getByRole('tab',{name:'数据管理',exact:true}).click();
 const data=page.getByRole('region',{name:'应用数据目录',exact:true});await expect(data.locator('.app-data-actions button')).toHaveCount(3);
 const boxes=await data.locator('.app-data-actions button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
 assert.ok(boxes.every(b=>b.y===boxes[0].y&&b.height===32&&Math.abs(b.width-boxes[0].width)<1));
 const states=page.getByRole('region',{name:'文件状态管理',exact:true}),select=states.getByRole('combobox'),refresh=states.getByRole('button',{name:'刷新状态',exact:true});
 const a=await select.boundingBox(),b=await refresh.boundingBox();assert.ok(Math.abs(a.y-b.y)<1);assert.equal(a.height,b.height);
 await page.screenshot({path:path.join(artifacts,'data-light.png')});
 assert.equal(readFileSync(path.join(media,'owned-sentinel.txt'),'utf8'),'unchanged');assert.deepEqual(readdirSync(media),['owned-sentinel.txt']);assert.deepEqual(report.errors,[]);
 report.completed=true;
}catch(error){report.failure=String(error);if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});throw error;}
finally{if(desktop)await desktop.close();writeFileSync(path.join(artifacts,'acceptance.json'),JSON.stringify(report,null,2));console.log('Directory controls acceptance:',artifacts);}
