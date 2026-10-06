import assert from 'node:assert/strict';
import { _electron, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const build=path.join(root,'build');mkdirSync(build,{recursive:true});
const temporary=mkdtempSync(path.join(build,'electron-preferences-'));
let desktop, occupied;
async function launch() {
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox','--autoplay-policy=no-user-gesture-required'],cwd:temporary,
    env:{...process.env,AVHUB_DATA_DIR:temporary,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();
  await page.getByRole('button',{name:'媒体库设置'}).waitFor();
  return page;
}
async function quit() {
  const closed=desktop.waitForEvent('close',{timeout:60000});
  await desktop.evaluate(({app})=>app.quit());await closed;desktop=null;
}
try {
  let page=await launch();const firstPort=Number(new URL(page.url()).port);
  await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  await page.getByRole('button',{name:'调整封面大小',exact:true}).click();
  await page.getByRole('button',{name:'舒适',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'媒体库设置'}).click();
  await page.getByRole('tab',{name:'播放偏好'}).click();
  await page.getByRole('checkbox',{name:'封面悬停预览'}).check();
  await page.getByRole('checkbox',{name:'视频连播',exact:true}).uncheck();
  await page.getByRole('combobox',{name:'连播模式',exact:true}).selectOption('repeat-one');
  await page.getByRole('combobox',{name:'连播范围',exact:true}).selectOption('directory');
  // Quit without waiting for the 250ms preference debounce. The desktop close
  // handshake must flush the current value before stopping its API.
  const expected={playbackSpeed:1.5,audio:{volume:.35,muted:true},queueMode:'repeat-one',queueScope:'directory',autoNext:false,'subtitle.7':{id:'',delay:.2}};
  assert.equal(await page.evaluate(async values=>(await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values})})).ok,expected),true);
  await quit();
  // Occupy the old port to prove that preferences survive a different origin.
  occupied=createServer();await new Promise((resolve,reject)=>{occupied.once('error',reject);occupied.listen(firstPort,'127.0.0.1',resolve);});
  page=await launch();const secondPort=Number(new URL(page.url()).port);
  assert.notEqual(secondPort,firstPort);
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('html')).toHaveAttribute('data-cover-size','comfortable');
  await page.getByRole('button',{name:'媒体库设置'}).click();
  await page.getByRole('tab',{name:'播放偏好'}).click();
  assert.equal(await page.getByRole('checkbox',{name:'封面悬停预览'}).isChecked(),true);
  const preferences=await page.evaluate(async()=>{const r=await fetch('/api/preferences');return(await r.json()).values;});
  assert.deepEqual(preferences.audio,expected.audio);assert.equal(preferences.playbackSpeed,1.5);
  assert.deepEqual(preferences.appearance,{theme:'light',coverSize:'comfortable'});
  assert.equal(preferences.queueMode,'repeat-one');assert.equal(preferences.autoNext,false);
  assert.equal(preferences.queueScope,'directory');
  await expect(page.getByRole('checkbox',{name:'视频连播',exact:true})).not.toBeChecked();
  await expect(page.getByRole('combobox',{name:'连播模式',exact:true})).toHaveValue('repeat-one');
  await expect(page.getByRole('combobox',{name:'连播范围',exact:true})).toHaveValue('directory');
  const subtitle=await page.evaluate(async()=>{const r=await fetch('/api/preferences/subtitle/7');return(await r.json()).value;});
  assert.deepEqual(subtitle,expected['subtitle.7']);
  // Verify the same handshake saves active playback, not just preferences.
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const mediaDirectory=path.join(temporary,'fixture');mkdirSync(mediaDirectory);
  const generated=spawnSync(path.join(root,'bin','ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x90:r=5','-t','40','-c:v','libx264','-pix_fmt','yuv420p',path.join(mediaDirectory,'test.mp4')],{windowsHide:true,timeout:30000});
  assert.equal(generated.status,0,generated.stderr?.toString());
  await page.evaluate(async directory=>{
    await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});
    await fetch('/api/scan',{method:'POST'});
  },mediaDirectory);
  await expect.poll(()=>page.evaluate(async()=>{const r=await fetch('/api/media?page=1');return(await r.json()).total;}),{timeout:30000}).toBe(1);
  const mediaId=await page.evaluate(async()=>{const r=await fetch('/api/media?page=1');return(await r.json()).items[0].id;});
  await page.goto(new URL(`/?video=${mediaId}`,page.url()).href);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2),{timeout:10000}).toBe(true);
  await page.locator('video').evaluate(v=>v.play());
  await expect.poll(()=>page.locator('video').evaluate(v=>!v.paused && v.currentTime>0)).toBe(true);
  // Exercise the real ID-only IPC bridge, but never launch Explorer or an
  // external player during automated tests.
  await desktop.evaluate(({shell})=>{
    globalThis.__mediaActions=[];
    shell.showItemInFolder=source=>{globalThis.__mediaActions.push(['reveal',source]);};
    shell.openPath=async source=>{globalThis.__mediaActions.push(['open',source]);return '';};
  });
  await page.getByRole('button',{name:'更多操作 test'}).click();
  await page.getByRole('menuitem',{name:'在资源管理器中显示'}).click();
  await page.getByRole('button',{name:'更多操作 test'}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('menuitem',{name:'用系统播放器打开'}).click();
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__mediaActions.length)).toBe(2);
  assert.deepEqual(await desktop.evaluate(()=>globalThis.__mediaActions),[['reveal',path.join(mediaDirectory,'test.mp4')],['open',path.join(mediaDirectory,'test.mp4')]]);
  // Native quit must also protect an unsaved metadata draft without installing
  // a renderer beforeunload handler that would prevent a deliberate discard.
  await page.getByText('编辑媒体信息',{exact:true}).click();
  await page.getByRole('textbox',{name:'显示标题'}).fill('Committed metadata');
  await desktop.evaluate(({dialog})=>{globalThis.__draftQuitDialogs=0;dialog.showMessageBox=async()=>{globalThis.__draftQuitDialogs++;return {response:2,checkboxChecked:false};};});
  await desktop.evaluate(({app})=>app.quit());
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__draftQuitDialogs),{timeout:10000}).toBe(1);
  await expect(page.getByRole('textbox',{name:'显示标题'})).toHaveValue('Committed metadata');
  assert.equal(await page.evaluate(async()=>(await fetch('/api/health')).ok),true);
  await page.getByRole('button',{name:'保存信息',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'媒体信息已保存'})).toBeVisible();
  // Inject a failed save and cancel desktop shutdown; the service must survive.
  await page.route('**/api/media/*/progress',route=>route.fulfill({status:503,json:{detail:'test save failure'}}));
  await page.locator('video').evaluate(v=>{v.currentTime=12;});
  await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(12);
  await desktop.evaluate(({dialog})=>{globalThis.__quitDialogs=0;dialog.showMessageBox=async()=>{globalThis.__quitDialogs++;return {response:2,checkboxChecked:false};};});
  await desktop.evaluate(({app})=>app.quit());
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__quitDialogs),{timeout:10000}).toBe(1);
  assert.equal(await page.evaluate(async()=>(await fetch('/api/health')).ok),true);
  await page.locator('.player-info h2').click();await page.keyboard.press('k');
  await expect.poll(()=>page.locator('video').evaluate(v=>!v.paused)).toBe(true);
  await page.unroute('**/api/media/*/progress');
  await quit();occupied.close();occupied=null;
  page=await launch();
  const savedProgress=await page.evaluate(async id=>{const r=await fetch(`/api/media/${id}`);return(await r.json()).progress;},mediaId);
  assert.ok(savedProgress>=12,`desktop exit lost video progress: ${savedProgress}`);
  await page.goto(new URL(`/?video=${mediaId}`,page.url()).href);
  await page.getByText('编辑媒体信息',{exact:true}).click();
  await page.getByRole('textbox',{name:'显示标题'}).fill('Deliberately discarded draft');
  await desktop.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await quit();
  page=await launch();
  const restoredTitle=await page.evaluate(async id=>{const r=await fetch(`/api/media/${id}`);return(await r.json()).title;},mediaId);
  assert.equal(restoredTitle,'Committed metadata','native discard must not save the draft or block application exit');
  await quit();
  assert.ok(temporary.startsWith(build+path.sep),'cleanup must remain inside the project build directory');
  rmSync(temporary,{recursive:true,force:true});
  console.log(`Electron portable preferences passed: ports ${firstPort} → ${secondPort}, settings/progress retained, unsaved metadata quit cancelled or explicitly discarded, failed shutdown cancelled.`);
} catch(error) {
  console.error(error);console.error(`Test data retained: ${temporary}`);process.exitCode=1;
} finally {
  if(desktop) {
    await desktop.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});}).catch(()=>{});
    await quit().catch(()=>desktop?.close());
  }
  occupied?.close();
}
