import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(import.meta.dirname,'../..'),version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
const folder=mkdtempSync(path.join(root,'build','portable-release-test-')),home=path.join(folder,'app'),custom=path.join(folder,'custom');mkdirSync(home);mkdirSync(custom);
const exe=path.join(home,`AVHub-portable-${version}-x64.exe`);copyFileSync(path.join(root,'dist/electron',path.basename(exe)),exe);
// Seed a new isolated empty library so upgrade detection cannot import the
// user's legacy profile while verifying the actual default sibling directory.
const seed=spawnSync(process.env.AVHUB_PYTHON||'python',['-c','from app import main as m; m.bootstrap(); m.playback.close()'],{cwd:root,env:{...process.env,AVHUB_DATA_DIR:path.join(home,'AVHub-data')},windowsHide:true,timeout:30000});
assert.equal(seed.status,0,'isolated portable test database must initialize');
let child,browser,page,port;
async function launch(){
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;await new Promise(r=>server.close(r));
  const env={...process.env,AVHUB_HEADLESS_TEST:'1'};delete env.AVHUB_DATA_DIR;delete env.AVHUB_APP_HOME;delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(exe,[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:home,env,windowsHide:true,stdio:'ignore'});
  const deadline=Date.now()+120000;let ready=false;
  while(Date.now()<deadline){try{const r=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(600)});if(r.ok){ready=true;break;}}catch{}await delay(250);}
  assert.ok(ready,'portable Chromium must start');browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context=browser.contexts()[0];page=context.pages()[0]||await context.waitForEvent('page',{timeout:60000});
  await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor({timeout:60000});
  const health=await page.evaluate(async()=> (await(await fetch('/api/health')).json()));assert.equal(health.frozen,true);assert.equal(health.ffmpeg,true);assert.equal(health.ffprobe,true);assert.equal(health.version,version);
  assert.equal(health.build_id,JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')).build_id);
  return health;
}
async function close(){
  if(!page)return;await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  const deadline=Date.now()+30000;while(Date.now()<deadline){try{await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)});}catch{break;}await delay(200);}
  await browser.close().catch(()=>{});browser=null;page=null;
}
try {
  await launch();assert.ok(existsSync(path.join(home,'AVHub-data/library.db')));
  let checks=0;page.on('request',r=>{if(r.url().endsWith('/api/updates/check'))checks++;});
  // Hosted runners may share an exhausted anonymous GitHub rate limit.
  // CI checks deterministic UI behavior; unit tests cover the actual API parser.
  if(process.env.CI==='true')await page.route('**/api/updates/check',route=>route.fulfill({json:{status:'unpublished'}}));
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'帮助',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();assert.equal(checks,0);
  await expect(page.getByRole('region',{name:'关于 AVHub'})).toContainText(version);
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.getByRole('button',{name:'检查更新',exact:true})).toBeEnabled({timeout:15000});assert.equal(checks,1);
  await expect(page.locator('.manual-update-result [role="alert"]')).toHaveCount(0);
  await expect(page.locator('.manual-update-result [role="status"]')).toBeVisible();
  await page.screenshot({path:path.join(folder,'portable-about.png')});
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.evaluate(async()=>{await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{librarySort:'modified_asc',resumeBehavior:'resume'}})});});
  // Prepare an explicit next-launch migration using the same validated config
  // format; actual native selection is covered by the desktop IPC test.
  await close();
  const {migrationConfig,writeDataLocation,configName}=await import('../dist/dataLocation.js');
  writeDataLocation(path.join(home,configName),migrationConfig(path.join(home,'AVHub-data'),custom));
  await launch();const info=await page.evaluate(async()=> (await(await fetch('/api/app-info')).json()));assert.equal(info.data_directory,custom);
  const prefs=await page.evaluate(async()=> (await(await fetch('/api/preferences')).json()).values);assert.equal(prefs.librarySort,'modified_asc');assert.equal(prefs.resumeBehavior,'resume');
  assert.ok(existsSync(path.join(home,'AVHub-data/library.db')));assert.ok(existsSync(path.join(custom,'library.db')));
  await close();
  assert.ok(!readdirSync(path.join(root,'dist/electron/win-unpacked/resources')).includes('archive'));
  console.log(JSON.stringify({passed:true,report:folder,checks:['actual portable EXE','frozen backend/FFmpeg','0 background checks',process.env.CI==='true'?'manual update UI (mock GitHub response)':'manual real GitHub check','default sibling data','packaged migration command','preferences retained','old data retained']}));
}finally{if(page)await close();if(browser)await browser.close().catch(()=>{});if(child&&child.exitCode===null)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
