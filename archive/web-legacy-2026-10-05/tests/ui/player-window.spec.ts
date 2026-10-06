import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

async function openPlayer(page:Page,url='/?video=2') {
  await page.goto(url);
  // Fixture reset can precede the previous context's final progress beacon.
  // A legitimate resume prompt must be answered, not mistaken for a load hang.
  const fromStart=page.getByRole('button',{name:'从头开始',exact:true});
  const fullscreen=page.getByRole('button',{name:'全屏',exact:true});
  await expect.poll(async()=>await fromStart.isVisible() || await fullscreen.isEnabled()).toBeTruthy();
  if(await fromStart.isVisible())await fromStart.click();
}

test('pure playback fills the viewport without system fullscreen or restarting the video',async({page})=>{
  await openPlayer(page);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.dataset.instance='keep-decoder';v.currentTime=20;});
  const source=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
  await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  await expect(page.getByRole('button',{name:'退出纯净播放',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();
  await expect(page.locator('.player-top')).toBeHidden();await expect(page.locator('.player-info')).toBeHidden();
  const stage=await page.locator('.video-wrap').boundingBox();
  expect(stage).toEqual({x:0,y:0,width:1440,height:850});
  await expect(page.locator('video')).toHaveAttribute('data-instance','keep-decoder');
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>({src:v.currentSrc,paused:v.paused,time:v.currentTime}))).toEqual({src:source,paused:true,time:20});
  await expect(page.getByRole('button',{name:'窗口置顶',exact:true})).toHaveCount(0);
  await page.screenshot({path:'test-results/pure-playback-browser.png'});
  await page.keyboard.press('Escape');
  await expect(page.locator('.player-top')).toBeVisible();await expect(page.locator('.player-info')).toBeVisible();
  await page.keyboard.press('w');await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);
  await page.setViewportSize({width:640,height:360});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  const controls=await page.locator('.player-controls').boundingBox();expect(controls!.x+controls!.width).toBeLessThanOrEqual(640);
  await page.screenshot({path:'test-results/pure-playback-small.png'});
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await expect(page.locator('video')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.classList.contains('pure-playback'))).toBeFalsy();
  await expect(page.getByRole('button',{name:'全部视频',exact:true})).toBeVisible();
});

test('pure playback hides controls quickly, respects open menus and survives next video',async({page,request})=>{
  const list=await(await request.post('/api/playlists',{data:{name:'窗口播放测试'}})).json();
  for(const id of [2,3])await request.post(`/api/playlists/${list.id}/items/${id}`);
  await openPlayer(page,`/?video=2&playlist=${list.id}`);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.paused && v.readyState>=2)).toBeTruthy();
  await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  await page.mouse.move(250,250);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:2500});
  await expect(page.locator('.video-canvas')).toHaveCSS('cursor','none');
  await page.mouse.move(280,260);await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.getByRole('button',{name:'倍速',exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,1200)));
  await expect(page.locator('.setting-popover')).toBeVisible();await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.keyboard.press('Escape');await expect(page.locator('.setting-popover')).toHaveCount(0);
  await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await page.getByRole('button',{name:'播放下一条',exact:true}).click();
  await expect(page).toHaveURL(/video=3/);await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);
  await expect(page.getByRole('button',{name:'退出纯净播放',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');await expect(page.locator('.player-top')).toBeVisible();
});

test('video fullscreen is distinct from pure playback and returns to the window mode',async({page})=>{
  await openPlayer(page);await expect(page.getByRole('button',{name:'纯净播放',exact:true})).toBeEnabled();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  await page.getByRole('button',{name:'全屏',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBeTruthy();
  await page.getByRole('button',{name:'退出视频全屏',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement)).toBeNull();
  await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);
  await page.getByRole('button',{name:'退出纯净播放',exact:true}).click();
  await expect(page.locator('.player-top')).toBeVisible();
});

for(const mode of ['normal','pure','fullscreen'] as const) {
  test(`keyboard playback preserves hidden controls in ${mode} mode`,async({page})=>{
    await openPlayer(page);
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2 && !v.paused)).toBeTruthy();
    if(mode==='pure')await page.getByRole('button',{name:'纯净播放',exact:true}).click();
    if(mode==='fullscreen')await page.getByRole('button',{name:'全屏',exact:true}).click();
    await page.mouse.move(230,210);
    const stage=page.locator('.video-wrap'),controls=page.locator('.player-controls');
    await expect(stage).toHaveClass(/controls-hidden/,{timeout:4000});
    await expect(controls).toHaveCSS('opacity','0');
    await page.evaluate(()=>{
      const stage=document.querySelector('.video-wrap')!;
      (window as any).controlFlashes=0;
      (window as any).controlObserver=new MutationObserver(()=>{
        if(!stage.classList.contains('controls-hidden'))(window as any).controlFlashes++;
      });
      (window as any).controlObserver.observe(stage,{attributes:true,attributeFilter:['class']});
    });
    // K also exercises a last mouse-focused button: focus-within must not
    // override the hidden toolbar merely because a shortcut was pressed.
    await page.keyboard.press('k');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
    await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.currentTime=20;v.volume=.5;});
    await page.keyboard.press('ArrowRight');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(25);
    await page.keyboard.press('j');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBe(15);
    await page.keyboard.press('ArrowDown');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.volume)).toBeCloseTo(.45);
    await page.keyboard.press('m');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.muted)).toBeTruthy();
    await page.keyboard.press('r');
    await expect(page.getByRole('button',{name:'旋转视频，当前 90 度',exact:true})).toHaveCount(1);
    await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
    await page.keyboard.press('Space');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.paused)).toBeTruthy();
    const initialFullscreen=await page.evaluate(()=>Boolean(document.fullscreenElement));
    await page.keyboard.press('f');
    await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(!initialFullscreen);
    await page.keyboard.press('f');
    await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(initialFullscreen);
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,350)));
    await expect(stage).toHaveClass(/controls-hidden/);await expect(controls).toHaveCSS('opacity','0');
    expect(await page.evaluate(()=>(window as any).controlFlashes)).toBe(0);
    await page.evaluate(()=>(window as any).controlObserver.disconnect());
    await page.mouse.move(260,220);await expect(stage).not.toHaveClass(/controls-hidden/);
    await expect(stage).toHaveClass(/controls-hidden/,{timeout:4000});
    await page.keyboard.press('k');
    await expect(stage).toHaveClass(/controls-hidden/);
    await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
    await page.keyboard.press('Tab');
    await page.locator('.play-toggle').focus();await expect(stage).not.toHaveClass(/controls-hidden/);
  });
}

test('keyboard next preserves hidden controls while mouse interaction can restore them',async({page,request})=>{
  const list=await(await request.post('/api/playlists',{data:{name:'安静快捷键测试'}})).json();
  for(const id of [2,3])await request.post(`/api/playlists/${list.id}/items/${id}`);
  await openPlayer(page,`/?video=2&playlist=${list.id}`);
  await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  await page.mouse.move(250,200);await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:3000});
  await page.keyboard.press('n');await expect(page).toHaveURL(/video=3/);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2 && !v.paused)).toBeTruthy();
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
  await expect(page.locator('.player-controls')).toHaveCSS('opacity','0');
  await page.mouse.move(260,210);await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
});
