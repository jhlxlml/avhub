import assert from 'node:assert/strict';
import { _electron,expect } from '@playwright/test';
import { mkdirSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const build=path.join(root,'build');mkdirSync(build,{recursive:true});
const temporary=mkdtempSync(path.join(build,'electron-screenshots-'));
const directory=path.join(temporary,'saved');mkdirSync(directory);
let desktop;
async function launch() {
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox','--autoplay-policy=no-user-gesture-required'],cwd:temporary,
    env:{...process.env,AVHUB_DATA_DIR:temporary,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置'}).waitFor();return page;
}
async function quit() {
  const closed=desktop.waitForEvent('close',{timeout:60000});
  await desktop.evaluate(({app})=>app.quit());await closed;desktop=null;
}
try {
  let page=await launch();
  await desktop.evaluate(({shell,dialog,BrowserWindow})=>{
    globalThis.__screenshotsActions=[];globalThis.__screenshotSaveDialogs=0;globalThis.__screenshotDownloads=0;
    shell.showItemInFolder=source=>globalThis.__screenshotsActions.push(['reveal',source]);
    shell.openPath=async source=>{globalThis.__screenshotsActions.push(['folder',source]);return '';};
    dialog.showSaveDialog=async()=>{globalThis.__screenshotSaveDialogs++;throw new Error('Screenshot must not open a Save As dialog');};
    dialog.showSaveDialogSync=()=>{globalThis.__screenshotSaveDialogs++;throw new Error('Screenshot must not open a Save As dialog');};
    BrowserWindow.getAllWindows()[0].webContents.session.on('will-download',event=>{globalThis.__screenshotDownloads++;event.preventDefault();});
  });
  await page.getByRole('button',{name:'媒体库设置'}).click();await page.getByRole('tab',{name:'播放偏好'}).click();
  const settings=page.getByRole('region',{name:'视频截图设置'});
  await settings.getByLabel('默认保存目录').fill(directory);await expect(settings.getByLabel('截图快捷键')).toContainText('C');
  await settings.getByRole('button',{name:'保存截图设置'}).click();await expect(settings.getByRole('status')).toContainText('截图设置已保存');
  await settings.getByRole('button',{name:'打开截图目录'}).click();
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__screenshotsActions.length)).toBe(1);
  assert.deepEqual(await desktop.evaluate(()=>globalThis.__screenshotsActions),[['folder',directory]]);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const mediaDirectory=path.join(temporary,'fixture');mkdirSync(mediaDirectory);
  const source=path.join(mediaDirectory,'test.mp4');
  const generated=spawnSync(path.join(root,'bin','ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=white:s=320x180:r=5','-t','60','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true,timeout:30000});
  assert.equal(generated.status,0,generated.stderr?.toString());const original=readFileSync(source);
  await page.evaluate(async directory=>{
    await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});await fetch('/api/scan',{method:'POST'});
  },mediaDirectory);
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).total),{timeout:30000}).toBe(1);
  const mediaId=await page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).items[0].id);
  await page.goto(new URL(`/?video=${mediaId}`,page.url()).href);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2&&!v.paused)).toBeTruthy();
  await page.getByRole('button',{name:'纯净播放',exact:true}).click();await page.mouse.move(230,210);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:4000});
  const pending=page.waitForResponse(r=>r.url().includes('/screenshot?')&&r.request().method()==='POST');
  await page.keyboard.press('c');const response=await pending;assert.ok(response.ok());const screenshot=await response.json();
  await expect(page.getByLabel('截图反馈')).toContainText('320 × 180');
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
  assert.equal(await page.locator('video').evaluate(v=>v.paused),false);
  const image=readFileSync(screenshot.path);assert.deepEqual([image.readUInt32BE(16),image.readUInt32BE(20)],[320,180]);
  assert.equal(path.dirname(screenshot.path),directory);assert.deepEqual(readFileSync(source),original);
  await page.getByRole('button',{name:'在文件夹中显示'}).click();
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__screenshotsActions.length)).toBe(2);
  assert.deepEqual(await desktop.evaluate(()=>globalThis.__screenshotsActions),[['folder',directory],['reveal',screenshot.path]]);
  const rejected=await page.evaluate(async()=>{
    let count=0;for(const [id,action] of [['C:\\Windows\\explorer.exe','reveal'],[null,'open'],['f'.repeat(32),'reveal']]) {
      try {await window.avhubDesktop.screenshotAction(id,action);}catch {count++;}
    }return count;
  });assert.equal(rejected,3);
  assert.equal(await desktop.evaluate(()=>globalThis.__screenshotSaveDialogs),0);assert.equal(await desktop.evaluate(()=>globalThis.__screenshotDownloads),0);
  // Paused screenshots stay ordinary decoded frames; retired keys do nothing.
  await page.locator('video').evaluate(v=>{v.pause();v.currentTime=1.2;});
  await expect.poll(()=>page.locator('video').evaluate(v=>v.paused&&!v.seeking&&v.readyState>=2)).toBe(true);
  let retiredSaves=0;page.on('request',request=>{if(request.url().includes('/screenshot?'))retiredSaves++;});
  for(const key of ['F8','Shift+S',',','.'])await page.keyboard.press(key);
  assert.equal(retiredSaves,0);await expect(page.getByLabel('暂停逐帧截图')).toHaveCount(0);
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),1.2);
  const selectedSave=page.waitForResponse(response=>response.url().includes('/screenshot?'));
  await page.keyboard.press('c');const selectedCapture=await(await selectedSave).json();
  assert.equal(selectedCapture.time,1.2);
  const selectedPng=readFileSync(selectedCapture.path);
  assert.equal(await page.evaluate(async bytes=>{
    const selected=document.querySelector('video');
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d');context.drawImage(selected,0,0);
    const before=context.getImageData(0,0,image.width,image.height).data;
    context.clearRect(0,0,image.width,image.height);context.drawImage(image,0,0);
    const after=context.getImageData(0,0,image.width,image.height).data;image.close();
    return before.every((value,index)=>value===after[index]);
  },Array.from(selectedPng)),true);
  assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
  // Closing while encoding/upload/response is outstanding must wait for the
  // screenshot task, not stop its local service first.
  let finalScreenshot;
  await page.route('**/api/media/*/screenshot?**',async route=>{
    const response=await route.fetch();assert.ok(response.ok());finalScreenshot=await response.json();
    await new Promise(resolve=>setTimeout(resolve,650));await route.fulfill({response});
  });
  const pendingFinal=page.waitForRequest(request=>request.url().includes('/screenshot?'));
  await page.keyboard.press('c');await pendingFinal;await quit();
  assert.ok(finalScreenshot,'quit interrupted a pending capture');assert.ok(readFileSync(finalScreenshot.path).length>8);
  page=await launch();
  await page.getByRole('button',{name:'媒体库设置'}).click();await page.getByRole('tab',{name:'播放偏好'}).click();
  await expect(page.getByLabel('默认保存目录')).toHaveValue(directory);await expect(page.getByLabel('截图快捷键')).toContainText('C');
  assert.deepEqual(readFileSync(screenshot.path),image);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await quit();
  assert.ok(temporary.startsWith(build+path.sep),'cleanup must remain inside the project build directory');
  rmSync(temporary,{recursive:true,force:true});
  console.log('Electron screenshots passed: C-only direct PNG save, retired keys inactive, no frame tools, no dialog/download, matching decoded PNG pixels, original decoded size, pure playback hidden controls, ID-only native reveal, directory restart persistence, pending capture quit.');
} catch(error) {console.error(error);console.error(`Test data retained: ${temporary}`);process.exitCode=1;}
finally {
  if(desktop) {
    await desktop.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});}).catch(()=>{});
    await quit().catch(()=>desktop?.close());
  }
}
