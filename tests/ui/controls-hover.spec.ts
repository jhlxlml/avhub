import { test,expect,type Page } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

async function play(page:Page) {
  await page.goto('/?video=2');
  const fromStart=page.getByRole('button',{name:'从头开始',exact:true});
  const fullscreen=page.getByRole('button',{name:'全屏',exact:true});
  await expect.poll(async()=>await fromStart.isVisible() || await fullscreen.isEnabled()).toBeTruthy();
  if(await fromStart.isVisible())await fromStart.click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBeTruthy();
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-8);
}

async function leaveControls(page:Page) {
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height/2);
}
async function revealControls(page:Page) {
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-8);
}

for(const mode of ['normal','pure','fullscreen'])
test(`stationary mouse keeps controls visible across pause, resume and seek in ${mode}`,async({page})=>{
  await play(page);
  if(mode==='pure')await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  if(mode==='fullscreen')await page.getByRole('button',{name:'全屏',exact:true}).click();
  const stage=page.locator('.video-wrap'),controls=page.locator('.player-controls');
  const hold=mode==='normal'?3000:1200;
  await leaveControls(page);
  await expect(stage).toHaveClass(/controls-hidden/,{timeout:4000});
  // Reveal an initially pointer-disabled bar by actual mouse movement, then
  // stay still over its new visible position rather than forcing a hover.
  const bar=await controls.boundingBox();
  await page.mouse.move(bar!.x+bar!.width/2,bar!.y+bar!.height/2);
  await expect(stage).not.toHaveClass(/controls-hidden/);
  await page.waitForTimeout(hold);
  await expect(stage).not.toHaveClass(/controls-hidden/);
  await expect(controls).toHaveCSS('opacity','1');
  await page.getByRole('slider',{name:'视频完整进度',exact:true}).hover();
  await page.keyboard.press('k');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
  await page.keyboard.press('k');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBeFalsy();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.currentTime=7;});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking)).toBeTruthy();
  await page.waitForTimeout(hold);
  await expect(stage).not.toHaveClass(/controls-hidden/);
  await expect(controls).toHaveCSS('opacity','1');
  await leaveControls(page);
  await expect(stage).toHaveClass(/controls-hidden/,{timeout:4000});
  await expect(controls).toHaveCSS('opacity','0');
  await page.keyboard.press('k');
  await expect(stage).toHaveClass(/controls-hidden/);
});

test('paused popovers and stationary hover retain controls; leaving the player releases the hold',async({page})=>{
  await play(page);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  const bar=await page.locator('.player-controls').boundingBox();
  await page.mouse.move(bar!.x+bar!.width/2,bar!.y+5);
  await page.waitForTimeout(1200);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.getByRole('button',{name:'倍速',exact:true}).click();
  await expect(page.getByRole('region',{name:'倍速设置',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region',{name:'倍速设置',exact:true})).toHaveCount(0);
  await page.waitForTimeout(1200);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await leaveControls(page);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:2500});
  await page.keyboard.press('w');
  // Keyboard mode changes leave controls hidden; only the bottom hot zone reveals them.
  await revealControls(page);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.getByRole('slider',{name:'视频完整进度',exact:true}).hover();
  await page.mouse.move(0,0);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:2500});
});

for(const mode of ['normal','pure','fullscreen'])
test(`paused controls and cursor hide away from the bar but retain hover in ${mode}`,async({page})=>{
  await play(page);
  if(mode==='pure')await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  if(mode==='fullscreen')await page.getByRole('button',{name:'全屏',exact:true}).click();
  await revealControls(page);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  const video=page.locator('video'),stage=page.locator('.video-wrap'),controls=page.locator('.player-controls');
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
  const pausedTime=await video.evaluate((v:HTMLVideoElement)=>v.currentTime);
  await page.waitForTimeout(mode==='normal'?3000:1200);
  await expect(stage).not.toHaveClass(/controls-hidden/);
  await leaveControls(page);
  await page.mouse.wheel(0,-200);
  await expect(page.locator('.video-canvas')).toHaveClass(/is-zoomed/);
  await expect(stage).toHaveClass(/controls-hidden/,{timeout:4000});
  await expect(controls).toHaveCSS('opacity','0');
  await expect(page.locator('.video-canvas')).toHaveCSS('cursor','none');
  expect(await video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(pausedTime);
  const saved=page.waitForResponse(response=>response.url().includes('/screenshot?')&&response.request().method()==='POST');
  await page.keyboard.press('c');expect((await saved).ok()).toBeTruthy();
  await expect(stage).toHaveClass(/controls-hidden/);
  await page.keyboard.press('Space');
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.paused)).toBeFalsy();
  await expect(stage).toHaveClass(/controls-hidden/);
  await page.keyboard.press('Space');
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
  await expect(stage).toHaveClass(/controls-hidden/);
  // Move the mouse normally to reveal, rather than hit-test a hidden button.
  const box=await stage.boundingBox();
  await page.mouse.move(box!.x+box!.width/2+10,box!.y+box!.height/2+10);
  await expect(stage).toHaveClass(/controls-hidden/);
  await expect(stage).not.toHaveClass(/cursor-hidden/);
  await revealControls(page);
  await page.getByRole('slider',{name:'视频完整进度',exact:true}).hover();
  await page.waitForTimeout(mode==='normal'?3000:1200);
  await expect(stage).not.toHaveClass(/controls-hidden/);
  await leaveControls(page);
  await expect(stage).toHaveClass(/controls-hidden/,{timeout:4000});
});
