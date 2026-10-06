import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function open(page:any,mode:string,paused:boolean) {
  await page.goto('/?video=2');
  const resume=page.getByRole('button',{name:'从头开始',exact:true});
  await expect(resume.or(page.getByRole('button',{name:'暂停',exact:true})).first()).toBeVisible();
  if(await resume.isVisible())await resume.click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBe(true);
  if(mode==='pure')await page.keyboard.press('w');
  if(mode==='fullscreen')await page.locator('.video-wrap').evaluate((v:HTMLElement)=>v.requestFullscreen());
  if(paused)await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.dataset.idleTest='same-video');
}
async function hotzone(page:any) {
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);
  await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height-7);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  return stage;
}
for(const mode of ['normal','pure','fullscreen'])for(const paused of [false,true]) {
  test(`${mode} ${paused?'paused':'playing'}: outside hides immediately, stationary control hover stays visible`,async({page})=>{
    await open(page,mode,paused);
    const src=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
    const stage=await hotzone(page);
    await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
    await expect(page.locator('.player-controls')).toHaveCSS('opacity','0');
    expect(await page.locator('.video-canvas').evaluate((v:HTMLElement)=>getComputedStyle(v).cursor)).not.toBe('none');
    for(let x=0;x<6;x++) {
      await page.mouse.move(stage.x+stage.width/2+x*12,stage.y+stage.height/2);
      expect(await page.locator('.video-canvas').evaluate((v:HTMLElement)=>getComputedStyle(v).cursor)).not.toBe('none');
      await page.waitForTimeout(100);
    }
    await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
    await expect(page.locator('.video-canvas')).toHaveCSS('cursor','none',{timeout:1000});
    await hotzone(page);
    await page.waitForTimeout(700);
    await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
    expect(await page.locator('.video-canvas').evaluate((v:HTMLElement)=>getComputedStyle(v).cursor)).not.toBe('none');
    await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);
    await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
    await expect(page.locator('video')).toHaveAttribute('data-idle-test','same-video');
    expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(src);
    expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(paused);
  });
}
test('dragging and open menus stay operable; release/close returns to fast idle',async({page})=>{
  await open(page,'normal',true);await hotzone(page);
  const slider=await page.getByRole('slider',{name:'视频完整进度',exact:true}).boundingBox();
  await page.mouse.move(slider.x+slider.width*.2,slider.y+slider.height/2);
  await page.mouse.down();await page.waitForTimeout(450);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.mouse.move(slider.x+slider.width*.3,slider.y+slider.height/2);await page.mouse.up();
  await page.waitForTimeout(450);await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height/2);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:900});
  await hotzone(page);await page.getByRole('button',{name:'倍速',exact:true}).click();
  await page.mouse.move(300,220);await page.waitForTimeout(450);
  await expect(page.locator('.setting-popover')).toBeVisible();
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:900});
});
test('control hover does not toggle paused playback and leaving hides immediately',async({page})=>{
  await open(page,'normal',true);await hotzone(page);
  await page.waitForTimeout(700);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height/2);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
});
