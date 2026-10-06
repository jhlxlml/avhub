import { test,expect,type Page } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

async function fullscreenState(page:Page,active:boolean) {
  await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(active);
  const button=page.getByRole('button',{name:active?'退出视频全屏':'全屏',exact:true});
  await expect(button).toHaveAttribute('aria-pressed',String(active));
  await expect(button).toHaveAttribute('title',active?'退出视频全屏 (F / Esc)':'视频全屏 (F)');
  await expect(page.getByRole('button',{name:active?'全屏':'退出视频全屏',exact:true})).toHaveCount(0);
  await expect(button.locator('svg')).toHaveAttribute('viewBox','0 0 24 24');
  await expect(button.locator('svg')).toHaveAttribute('stroke-width','1.7');
  if(active) {
    // All inward corners must be reflected around the 24px grid centre.
    // The old bottom-right path sat at x=14..19 rather than x=15..20.
    const corners=await button.locator('svg path').evaluateAll(paths=>paths.map(path=>{
      const box=(path as SVGGraphicsElement).getBBox();
      return {x:box.x,y:box.y,width:box.width,height:box.height};
    }));
    expect(corners).toEqual([
      {x:4,y:4,width:5,height:5},{x:15,y:4,width:5,height:5},
      {x:4,y:15,width:5,height:5},{x:15,y:15,width:5,height:5},
    ]);
  } else await expect(button.locator('svg path')).toHaveCount(1);
  return button;
}

for(const theme of ['dark','light'])for(const mode of ['normal','pure'])
test(`fullscreen icon and accessible action track mouse, F, Esc and double-click in ${theme} ${mode}`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  if(mode==='pure')await page.setViewportSize({width:640,height:360});
  await page.goto('/?video=2');
  const fromStart=page.getByRole('button',{name:'从头开始',exact:true});
  const enterFullscreen=page.getByRole('button',{name:'全屏',exact:true});
  await expect.poll(async()=>await fromStart.isVisible() || await enterFullscreen.isEnabled()).toBeTruthy();
  if(await fromStart.isVisible())await fromStart.click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  const video=page.locator('video');
  await video.evaluate((v:HTMLVideoElement)=>{v.pause();v.dataset.instance='fullscreen-same-decoder';});
  const source=await video.evaluate((v:HTMLVideoElement)=>v.currentSrc);
  if(mode==='pure')await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  await (await fullscreenState(page,false)).click();
  const exit=await fullscreenState(page,true);
  await exit.screenshot({path:`test-results/fullscreen-exit-${theme}-${mode}.png`});
  await exit.click();await fullscreenState(page,false);
  await page.keyboard.press('f');await fullscreenState(page,true);
  await page.keyboard.press('Escape');await fullscreenState(page,false);
  await page.keyboard.press('f');await fullscreenState(page,true);
  await page.keyboard.press('f');await fullscreenState(page,false);
  await page.locator('.video-canvas').dblclick();await fullscreenState(page,true);
  await page.locator('.video-canvas').dblclick();await fullscreenState(page,false);
  await expect(page.locator('.player-shell')).toHaveClass(mode==='pure'?/is-pure-playback/:/^player-shell$/);
  await expect(video).toHaveAttribute('data-instance','fullscreen-same-decoder');
  expect(await video.evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(source);
});
