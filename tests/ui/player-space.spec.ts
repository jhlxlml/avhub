import { test,expect } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function player(page:any) {
  await page.goto('/?video=2');
  await expect(page.locator('video')).toBeVisible();
  // The previous player's final progress beacon can arrive after the test-only
  // reset. Always select a deterministic starting point if resume is offered.
  const restart=page.getByRole('button',{name:'从头开始',exact:true});
  if(await restart.isVisible())await restart.click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBeTruthy();
  // This test verifies shortcut routing, not persisted mute defaults. A late
  // previous-page preference write can arrive after the test-only DB reset.
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.muted=false;v.volume=.75;});
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-8);
}
const paused=(page:any)=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused);
test('Tab-focused buttons retain native Space activation instead of toggling playback',async({page})=>{
  await player(page);await page.keyboard.press('Tab');const mute=page.getByRole('button',{name:'静音',exact:true});await mute.focus();await page.keyboard.press('Space');
  expect(await paused(page)).toBe(false);expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.muted)).toBe(true);
  await page.keyboard.press('Space');expect(await paused(page)).toBe(false);expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.muted)).toBe(false);
});
async function clickControl(page:any,name:string|RegExp) {
  // Keyboard actions intentionally keep auto-hidden controls hidden. Move the
  // mouse as a user would before hit-testing a transparent, pointer-disabled bar.
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height-8);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.getByRole('button',{name,exact:typeof name==='string'}).click();
  if(name==='纯净播放')await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);
  if(name==='全屏')await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);
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
  await player(page);await clickControl(page,'纯净播放');
  await clickControl(page,'静音');await page.mouse.move(230,210);
  const stage=page.locator('.video-wrap');await expect(stage).toHaveClass(/controls-hidden/,{timeout:4000});
  await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(true);
  await expect(stage).toHaveClass(/controls-hidden/);await expect(page.locator('.player-controls')).toHaveCSS('opacity','0');
  await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(false);await expect(stage).toHaveClass(/controls-hidden/);
});

for(const mode of ['normal','pure','fullscreen']) {
  test(`mouse seek retains all player shortcuts in ${mode} mode without double keyup seeks`,async({page})=>{
    await player(page);
    if(mode==='pure')await clickControl(page,'纯净播放');
    if(mode==='fullscreen')await clickControl(page,'全屏');
    await page.keyboard.press('k');await expect.poll(()=>paused(page)).toBe(true);
    const stage=await page.locator('.video-wrap').boundingBox();await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-8);
    const slider=page.getByRole('slider',{name:'视频完整进度'});
    await slider.click({position:{x:Math.round((await slider.boundingBox())!.width*.3),y:5}});
    await expect(slider).toBeFocused();
    // Immediately after mouse seeking: letters must not be blocked as text
    // input, and must not require clicking the video to restore focus.
    await page.keyboard.press('m');expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.muted)).toBe(true);
    await page.keyboard.press('r');await expect(page.getByRole('button',{name:'旋转视频，当前 90 度',exact:true})).toHaveCount(1);
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking&&v.readyState>=2)).toBe(true);
    const point=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime);
    await page.locator('.playback-diagnostics summary').evaluate((e:HTMLElement)=>e.click());
    // Keep the original slider focus; programmatic summary.click does not
    // change focus provenance, unlike a new mouse interaction.
    await page.keyboard.press('ArrowRight');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(point+5,0);
    await expect(page.locator('.seek-frame')).toBeHidden();
    await page.keyboard.press('l');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(point+15,0);
    await expect(page.locator('.seek-frame')).toBeHidden();
    await page.keyboard.press('j');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(point+5,0);
    const initialVolume=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.volume);
    await page.keyboard.press('ArrowDown');
    expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.volume)).toBeCloseTo(initialVolume-.05);
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking&&v.readyState>=2)).toBe(true);
    const capture=page.waitForResponse(r=>r.url().includes('/screenshot?')&&r.request().method()==='POST');
    await page.keyboard.press('c');expect((await capture).ok()).toBe(true);
    await page.keyboard.press('Space');await expect.poll(()=>paused(page)).toBe(false);
    await page.keyboard.press('k');await expect.poll(()=>paused(page)).toBe(true);
    if(mode==='fullscreen') {await page.keyboard.press('f');await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);}
    if(mode==='pure') {await page.keyboard.press('w');await expect(page.locator('.player-shell')).not.toHaveClass(/is-pure-playback/);}
  });
}

test('Tab after mouse slider focus restores native keyboard slider adjustment',async({page})=>{
  await player(page);await page.keyboard.press('k');
  const slider=page.getByRole('slider',{name:'视频完整进度'});
  await slider.click({position:{x:100,y:5}});
  await page.keyboard.press('Tab');await slider.focus();
  const value=Number(await slider.inputValue());
  await page.keyboard.press('ArrowRight');
  await expect.poll(async()=>Number(await slider.inputValue())).toBeCloseTo(value+.1);
  expect(await paused(page)).toBe(true);
});

for(const mode of ['normal','pure','fullscreen']) {
  test(`player slider focus uses a small thumb halo, not a rectangle in ${mode} mode`,async({page})=>{
    await player(page);
    if(mode==='pure')await clickControl(page,'纯净播放');
    if(mode==='fullscreen')await clickControl(page,'全屏');
    const progress=page.getByRole('slider',{name:'视频完整进度'});
    const stage=await page.locator('.video-wrap').boundingBox();await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-8);
    await progress.click({position:{x:100,y:5}});
    await page.keyboard.press('m');await expect(progress).toBeFocused();
    await expect(progress).toHaveCSS('outline-style','none');
    // Tab/keyboard focus still has a visible local indicator; button/text
    // focus remains untouched by this player-range-only CSS exception.
    await page.keyboard.press('Tab');await progress.focus();
    await page.keyboard.press('ArrowRight');
    expect(await progress.evaluate(e=>e.matches(':focus-visible'))).toBe(true);
    await expect(progress).toHaveCSS('outline-width','0px');
    // Chromium may expose the input style rather than pseudo-element style
    // for native range thumbs. Check the matching thumb rule, then inspect
    // screenshots of the actual rendered local indicator.
    const halo=await progress.evaluate(e=>{
      const rules=Array.from(document.styleSheets).flatMap(sheet=>Array.from(sheet.cssRules));
      const rule=rules.find(rule=>rule instanceof CSSStyleRule&&rule.selectorText.endsWith(':focus-visible::-webkit-slider-thumb')&&
        e.matches(rule.selectorText.replace('::-webkit-slider-thumb','')));
      return rule instanceof CSSStyleRule?rule.style.boxShadow:'';
    });
    expect(halo).toContain('2px');expect(halo).toContain('4px');
    await page.locator('.player-progress-row').screenshot({path:`test-results/progress-focus-${mode}.png`});
    const volume=page.getByRole('slider',{name:'音量',exact:true});
    await volume.focus();await page.keyboard.press('ArrowLeft');
    await expect(volume).toHaveCSS('outline-style','none');
    const button=page.getByRole('button',{name:'画质',exact:true});
    await button.focus();await page.keyboard.press('Shift');
    await expect(button).toHaveCSS('outline-style','solid');
  });
}
