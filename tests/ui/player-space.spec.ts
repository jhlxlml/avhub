import { test,expect } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function player(page:any) {
  await page.goto('/?video=2');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBeTruthy();
  // This test verifies shortcut routing, not persisted mute defaults. A late
  // previous-page preference write can arrive after the test-only DB reset.
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.muted=false;v.volume=.75;});
}
const paused=(page:any)=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused);
async function clickControl(page:any,name:string|RegExp) {
  // Keyboard actions intentionally keep auto-hidden controls hidden. Move the
  // mouse as a user would before hit-testing a transparent, pointer-disabled bar.
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.getByRole('button',{name,exact:typeof name==='string'}).click();
}

for(const mode of ['normal','pure','fullscreen']) {
  test(`Space controls playback after clicking controls in ${mode} mode without reactivating them`,async({page})=>{
    await player(page);
    if(mode==='pure')await clickControl(page,'纯净播放');
    if(mode==='fullscreen')await clickControl(page,'全屏');
    await clickControl(page,'静音');
    await expect(page.getByRole('button',{name:'取消静音',exact:true})).toBeFocused();
    await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(true);
    expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.muted)).toBe(true);
    await clickControl(page,/旋转视频/);await page.keyboard.press('Space');
    await expect.poll(()=>paused(page)).toBe(false);
    await expect(page.getByRole('button',{name:'旋转视频，当前 90 度',exact:true})).toHaveCount(1);
    const saved=page.waitForResponse(response=>response.url().includes('/screenshot?')&&response.request().method()==='POST');
    let captures=0;page.on('request',request=>{if(request.url().includes('/screenshot?'))captures++;});
    await clickControl(page,'保存视频截图');expect((await saved).ok()).toBe(true);
    await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(true);
    expect(captures).toBe(1);
    // Space over the play button must produce one toggle, not a shortcut plus
    // a second native button click on keyup.
    await clickControl(page,'播放');await expect.poll(()=>paused(page)).toBe(false);
    await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(true);
    expect(await page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(mode==='fullscreen');
    await expect(page.locator('.player-shell')).toHaveClass(mode==='pure'?/is-pure-playback/:/^player-shell$/);
  });
}

test('holding Space or K only toggles once and Space does not scroll the player',async({page})=>{
  await player(page);await page.getByRole('button',{name:'静音',exact:true}).click();
  const initial=await page.evaluate(()=>window.scrollY);
  await page.keyboard.down('Space');await page.keyboard.down('Space');await page.keyboard.down('Space');await page.keyboard.up('Space');
  await expect.poll(()=>paused(page)).toBe(true);expect(await page.evaluate(()=>window.scrollY)).toBe(initial);
  await page.keyboard.down('k');await page.keyboard.down('k');await page.keyboard.down('k');await page.keyboard.up('k');
  await expect.poll(()=>paused(page)).toBe(false);
});

test('Space works on sliders but respects text input, menus, summaries and composition',async({page})=>{
  await player(page);
  await page.getByRole('slider',{name:'音量',exact:true}).focus();
  await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(true);
  const initialVolume=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.volume);
  await page.keyboard.press('ArrowLeft');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.volume)).toBeCloseTo(initialVolume-.05);
  expect(await paused(page)).toBe(true);
  await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(false);
  await page.getByRole('slider',{name:'视频完整进度'}).focus();
  await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(true);
  await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(false);
  await page.getByRole('button',{name:'倍速',exact:true}).click();await page.keyboard.press('Space');expect(await paused(page)).toBe(false);
  await page.keyboard.press('Escape');
  await page.locator('.shortcut-help summary').focus();await page.keyboard.press('Space');
  expect(await paused(page)).toBe(false);await expect(page.locator('.shortcut-help')).toHaveAttribute('open','');
  await page.getByText('编辑媒体信息',{exact:true}).click();
  const input=page.getByRole('textbox',{name:'显示标题'});await input.fill('标题');await page.keyboard.press('Space');
  await expect(input).toHaveValue('标题 ');expect(await paused(page)).toBe(false);
  await page.evaluate(()=>{
    (document.activeElement as HTMLElement)?.blur();
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',isComposing:true,bubbles:true,cancelable:true}));
  });expect(await paused(page)).toBe(false);
});

test('Space after a mouse-focused control preserves hidden controls in pure playback',async({page})=>{
  await player(page);await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  await page.getByRole('button',{name:'静音',exact:true}).click();await page.mouse.move(230,210);
  const stage=page.locator('.video-wrap');await expect(stage).toHaveClass(/controls-hidden/,{timeout:4000});
  await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(true);
  await expect(stage).toHaveClass(/controls-hidden/);await expect(page.locator('.player-controls')).toHaveCSS('opacity','0');
  await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(false);await expect(stage).toHaveClass(/controls-hidden/);
});
