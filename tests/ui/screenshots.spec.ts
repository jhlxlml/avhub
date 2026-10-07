import { test,expect,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

test.beforeEach(async({request})=>{expect((await request.post('/test/reset')).ok()).toBe(true);});

async function play(page:Page) {
  await page.goto('/?q=002');
  await page.getByRole('button',{name:'播放 视频 002',exact:true}).click();
  // A saved position can arrive from a previous context's final progress write.
  // Exercise the real resume prompt rather than assume autoplay has started.
  const resume=page.getByRole('button',{name:'从头开始',exact:true});
  // Cold CI decoding can outlast the default 5s UI assertion. Readiness is
  // measured from the actual video, independent of control text/visibility.
  const deadline=Date.now()+30000;
  const decoded=()=>page.locator('video').evaluate((v:HTMLVideoElement)=>
    !v.paused&&!v.seeking&&v.readyState>=2&&v.videoWidth>0&&v.videoHeight>0);
  await expect.poll(async()=>await resume.isVisible()||await decoded(),{
    timeout:Math.max(1,deadline-Date.now()),message:'resume prompt or decoded playback must become ready',
  }).toBe(true);
  if(await resume.isVisible())await resume.click();
  await expect.poll(decoded,{
    timeout:Math.max(1,deadline-Date.now()),message:'screenshot requires a decoded frame and active playback',
  }).toBe(true);
}
const screenshotResponse=(page:any)=>page.waitForResponse((response:any)=>response.url().includes('/screenshot?')&&response.request().method()==='POST');

async function expectSavedPng(shot:any,directory:string) {
  // Keep strict canonical-directory assertions AND prove that the returned file
  // was actually saved there. Do not hide alias mismatches by ignoring paths.
  expect(shot.directory).toBe(directory);
  expect(dirname(shot.path)).toBe(directory);
  expect((await readFile(shot.path)).subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
}

test('screenshot setup waits for decoded playback after preparation exceeds five seconds',async({page,request})=>{
  const {directory}=await(await request.get('/test/screenshot-directory')).json();
  expect((await request.patch('/api/preferences',{data:{values:{screenshots:{directory,shortcut:'C'}}}})).ok()).toBe(true);
  await page.route('**/api/media/2/playback',async route=>{
    // Deliberately exceed the old 5s assertion using a synthetic renderer
    // harness delay; the real fixture must still decode and save a PNG.
    await new Promise(resolve=>setTimeout(resolve,6000));
    await route.continue();
  });
  await play(page);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>[v.videoWidth,v.videoHeight])).toEqual([320,180]);
  await page.locator('.player-info h2').click();
  const saved=screenshotResponse(page);await page.keyboard.press('c');const response=await saved;
  expect(response.ok()).toBe(true);
  const shot=await response.json();await expectSavedPng(shot,directory);
  expect([shot.width,shot.height]).toEqual([320,180]);
});

test('C saves directly without downloads or dialogs, including paused and rotated decoded frames',async({page})=>{
  let downloads=0,dialogs=0;page.on('download',()=>downloads++);page.on('dialog',()=>dialogs++);
  await play(page);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=5;});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(5);
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+8);
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-7);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.getByRole('button',{name:/旋转视频/}).click();
  await page.locator('.player-info h2').click();
  const firstSave=screenshotResponse(page);await page.keyboard.press('c');const first=await(await firstSave).json();
  await expect(page.getByLabel('截图反馈')).toContainText('320 × 180');
  expect(first.time).toBe(5);expect([first.width,first.height]).toEqual([320,180]);
  const image=await readFile(first.path);expect(image.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  const secondSave=screenshotResponse(page);await page.keyboard.press('c');const second=await(await secondSave).json();
  expect(first.path).not.toBe(second.path);expect(await readFile(first.path)).toEqual(image);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
  expect(downloads).toBe(0);expect(dialogs).toBe(0);
});

test('pure playback screenshot shortcut leaves hidden controls hidden and video playing',async({page})=>{
  await play(page);await page.locator('.player-info h2').click();await page.keyboard.press('w');
  await page.mouse.move(1,1);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:10000});
  const saved=screenshotResponse(page);await page.keyboard.press('c');expect((await saved).ok()).toBeTruthy();
  await expect(page.getByLabel('截图反馈')).toBeVisible();
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>!v.paused)).toBe(true);
});

test('settings picker only selects screenshot directory; fixed C and directory survive reload',async({page,request})=>{
  const {directory}=await(await request.get('/test/screenshot-directory')).json();
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好'}).click();
  // The component harness supplies only the chooser under test. Actual IPC
  // and Windows dialogs are exercised by test:electron:screenshots.
  await page.evaluate(directory=>{(window as any).avhubDesktop={chooseFolder:async(purpose:string)=>{if(purpose!=='screenshots')throw new Error('unexpected purpose');return {path:directory};}};},directory);
  const settings=page.getByRole('region',{name:'视频截图设置'});
  await settings.getByRole('button',{name:'浏览',exact:true}).click();
  await expect(settings.getByLabel('默认保存目录')).toHaveValue(directory);
  await expect(settings.getByLabel('截图快捷键')).toContainText('C');
  await expect(settings.getByRole('combobox',{name:'截图快捷键'})).toHaveCount(0);
  await settings.getByRole('button',{name:'保存截图设置'}).click();
  await expect(settings.getByRole('status')).toContainText('截图设置已保存');
  expect(await(await request.get('/api/roots')).json()).toHaveLength(2);
  await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好'}).click();
  await expect(settings.getByLabel('默认保存目录')).toHaveValue(directory);await expect(settings.getByLabel('截图快捷键')).toContainText('C');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await play(page);await page.locator('.player-info h2').click();
  const saved=screenshotResponse(page);await page.keyboard.press('c');const shot=await(await saved).json();await expectSavedPng(shot,directory);
});

test('invalid settings preserve old values and recovery to default requires explicit save',async({page,request})=>{
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好'}).click();
  const settings=page.getByRole('region',{name:'视频截图设置'});
  await settings.getByLabel('默认保存目录').fill('relative');await settings.getByRole('button',{name:'保存截图设置'}).click();
  await expect(settings.getByRole('alert')).toContainText('设置名称或值无效');
  expect((await(await request.get('/api/screenshots/settings')).json()).directory).toBe('');
  await settings.getByRole('button',{name:'使用默认目录'}).click();await settings.getByRole('button',{name:'保存截图设置'}).click();
  await expect(settings.getByRole('status')).toContainText('截图设置已保存');
});

test('held shortcut is debounced and late response failure can be checked without another upload',async({page})=>{
  let count=0;
  await page.route('**/api/media/*/screenshot?**',async route=>{
    count++;const response=await route.fetch();expect(response.ok()).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,250));
    await route.fulfill({status:503,json:{detail:'响应丢失：请检查保存结果'}});
  });
  await play(page);await page.locator('.player-info h2').click();
  await page.keyboard.down('c');await page.keyboard.down('c');await page.keyboard.down('c');await page.keyboard.up('c');
  await expect(page.getByLabel('截图反馈')).toContainText('响应丢失');expect(count).toBe(1);
  await page.getByRole('button',{name:'检查保存结果'}).click();
  await expect(page.getByLabel('截图反馈')).toContainText('截图已保存');expect(count).toBe(1);
});

test('settings and text inputs suppress capture shortcuts, narrow layout fits',async({page},testInfo)=>{
  let count=0;page.on('request',request=>{if(request.url().includes('/screenshot?'))count++;});
  await page.setViewportSize({width:390,height:844});await play(page);
  await page.getByText('编辑媒体信息',{exact:true}).click();
  await page.getByRole('textbox',{name:'显示标题'}).focus();await page.keyboard.press('c');
  expect(count).toBe(0);
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好'}).click();
  const settings=page.getByRole('region',{name:'视频截图设置'});await expect(settings.getByLabel('默认保存目录')).toBeEnabled();
  await page.keyboard.press('c');expect(count).toBe(0);
  expect(await settings.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('screenshot-settings-narrow.png')});
});

test('rollback removes frame tools and old screenshot keys even with a legacy preference',async({page,request})=>{
  const {directory}=await(await request.get('/test/screenshot-directory')).json();
  await request.patch('/api/preferences',{data:{values:{screenshots:{directory,shortcut:'Shift+S'}}}});
  expect((await(await request.get('/api/screenshots/settings')).json()).shortcut).toBe('C');
  let saves=0,frames=0;page.on('request',request=>{if(request.url().includes('/screenshot?'))saves++;if(request.url().endsWith('/frame'))frames++;});
  await play(page);await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=5;});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused&&!v.seeking&&v.readyState>=2)).toBe(true);
  await page.locator('.player-info h2').click();
  for(const key of ['F8','Shift+S',',','.','Shift+C','Control+c'])await page.keyboard.press(key);
  expect(saves).toBe(0);expect(frames).toBe(0);
  await expect(page.getByLabel('暂停逐帧截图')).toHaveCount(0);await expect(page.locator('.inspected-frame')).toHaveCount(0);
  await expect(page.getByRole('slider',{name:'视频完整进度'})).toHaveCount(1);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(5);
  const removed=await request.post('/api/media/2/frame',{data:{time:5,direction:1}});expect(removed.status()).toBe(404);expect(removed.headers()['content-type']).toContain('application/json');
  const saved=screenshotResponse(page);await page.keyboard.press('c');const result=await(await saved).json();
  await expectSavedPng(result,directory);expect(result.time).toBe(5);expect(saves).toBe(1);
  await page.keyboard.press('Space');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.paused)).toBe(true);
});
