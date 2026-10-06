import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {migrationConfig,readDataLocation,writeDataLocation,configName} from '../dist/dataLocation.js';
const root=path.resolve(import.meta.dirname,'../..');
const folder=mkdtempSync(path.join(root,'build','data-location-test-')),home=path.join(folder,'app'),custom=path.join(folder,'custom');mkdirSync(home);mkdirSync(custom);
const source=path.join(folder,'unit-source'),destination=path.join(folder,'unit-target');mkdirSync(source);mkdirSync(destination);
const config=migrationConfig(source,destination),file=path.join(folder,configName);writeDataLocation(file,config);assert.deepEqual(readDataLocation(file),config);
assert.throws(()=>migrationConfig(source,path.join(source,'nested')),/相互包含/);
writeFileSync(path.join(destination,'keep.txt'),'keep');assert.throws(()=>migrationConfig(source,destination),/空目录/);
let desktop;
const env={...process.env,AVHUB_APP_HOME:home,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'};delete env.AVHUB_DATA_DIR;
async function launch(){desktop=await _electron.launch({args:[root],cwd:folder,env,timeout:60000});const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();return page;}
async function close(){const done=desktop.waitForEvent('close',{timeout:20000});await desktop.evaluate(({app})=>app.quit());await done;desktop=null;}
try {
  let page=await launch();const initial=await page.evaluate(()=>window.avhubDesktop.dataLocation('get'));assert.equal(initial.current,path.join(home,'AVHub-data'));
  await page.evaluate(async()=>{await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{resumeBehavior:'resume'}})});});
  await desktop.evaluate(({dialog},custom)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[custom]});dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});},custom);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  await page.getByRole('button',{name:'自定义数据目录',exact:true}).click();await expect(page.locator('.data-location-pending')).toContainText(custom);
  const savedConfig=readFileSync(path.join(home,configName),'utf8');
  await desktop.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
  await page.getByRole('button',{name:'自定义数据目录',exact:true}).click();
  assert.equal(readFileSync(path.join(home,configName),'utf8'),savedConfig);
  await assert.rejects(()=>page.evaluate(()=>window.avhubDesktop.dataLocation('arbitrary')),/操作无效/);
  await page.screenshot({path:path.join(folder,'data-location-pending.png')});
  assert.equal((await page.evaluate(()=>window.avhubDesktop.dataLocation('get'))).current,initial.current);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  // A late edit must migrate too; no stale snapshot is taken when choosing.
  await page.evaluate(async()=>{await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{resumeBehavior:'restart'}})});});
  await close();assert.ok(existsSync(path.join(initial.current,'library.db')));
  page=await launch();assert.equal((await page.evaluate(()=>window.avhubDesktop.dataLocation('get'))).current,custom);
  assert.equal(await page.evaluate(async()=> (await(await fetch('/api/preferences')).json()).values.resumeBehavior),'restart');
  assert.ok(existsSync(path.join(initial.current,'library.db')));assert.ok(existsSync(path.join(custom,'library.db')));
  assert.equal(JSON.parse(readFileSync(path.join(home,configName),'utf8')).pending,undefined);
  await close();console.log(JSON.stringify({passed:true,report:folder,checks:['default AVHub-data','native custom selection','next-launch migration','late preferences preserved','old library retained','no overwrite']}));
}finally{if(desktop)await close();}
