import {test,expect} from '@playwright/test';
test.beforeEach(async({request,page})=>{
  await request.post('/test/reset');
  await page.addInitScript(()=>{
    const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};
    (window as any).nativeSide=null;
    window.avhubDesktop={getWindowState:async()=>state,setWindowMode:async()=>state,onWindowStateChanged:()=>()=>{},windowAction:async()=>null,
      onMouseSeek:callback=>{(window as any).nativeSide=callback;return()=>{(window as any).nativeSide=null;};}} as any;
  });
});
async function player(page:any) {
  await page.goto('/?video=2');
  const resume=page.getByRole('button',{name:'从头开始',exact:true});
  await expect(resume.or(page.getByRole('button',{name:'暂停',exact:true})).first()).toBeVisible();if(await resume.isVisible())await resume.click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBe(true);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=40;v.dataset.mouseSeek='original-decoder';});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking)).toBe(true);
}
const time=(page:any)=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime);
async function side(page:any,button:number) {
  return page.locator('video').evaluate((v:HTMLVideoElement,button:number)=>{
    const event=new MouseEvent('mousedown',{button,bubbles:true,cancelable:true});v.dispatchEvent(event);v.dispatchEvent(new MouseEvent('mouseup',{button,bubbles:true,cancelable:true}));return event.defaultPrevented;
  },button);
}
test('default mouse side buttons seek 5 seconds without navigating, reloading or resuming',async({page})=>{
  await player(page);const url=page.url(),src=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
  expect(await side(page,4)).toBe(true);await expect.poll(()=>time(page)).toBeCloseTo(45,1);
  await side(page,3);await expect.poll(()=>time(page)).toBeCloseTo(40,1);
  await page.evaluate(()=>{(window as any).nativeSide('forward');for(const type of ['pointerdown','mousedown','pointerup','mouseup'])document.querySelector('video')!.dispatchEvent(new PointerEvent(type,{button:4,bubbles:true,cancelable:true}));});
  await expect.poll(()=>time(page)).toBeCloseTo(45,1);
  expect(page.url()).toBe(url);expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(src);
  await expect(page.locator('video')).toHaveAttribute('data-mouse-seek','original-decoder');expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime=2);await side(page,3);await expect.poll(()=>time(page)).toBe(0);
});
test('custom mouse duration saves and survives reload; keyboard seek remains 5 seconds',async({page,request})=>{
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  const section=page.getByRole('region',{name:'鼠标侧键设置'});const input=section.getByLabel('鼠标侧键跳播时长');
  for(const theme of ['dark','light']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.setViewportSize({width:390,height:820});
    expect(await section.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await section.scrollIntoViewIfNeeded();await page.waitForTimeout(250);await page.screenshot({path:`test-results/mouse-seek-settings-${theme}.png`});
  }
  await expect(input).toHaveValue('5');await input.fill('0');await expect(section.getByRole('button',{name:'保存鼠标快捷键'})).toBeDisabled();
  await input.fill('15');await section.getByRole('button',{name:'保存鼠标快捷键'}).click();await expect(section).toContainText('鼠标侧键时长已保存');
  expect((await(await request.get('/api/preferences')).json()).values.mouseSeekSeconds).toBe(15);
  await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await expect(input).toHaveValue('15');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await player(page);
  await side(page,3);await expect.poll(()=>time(page)).toBeCloseTo(25,1);await page.keyboard.press('ArrowRight');await expect.poll(()=>time(page)).toBeCloseTo(30,1);
});
test('menus and text editing suppress side seeking and cancellation still prevents history navigation',async({page})=>{
  await player(page);await page.keyboard.press('Tab');
  await page.locator('.player-info h2').click();
  const bar=await page.locator('.video-wrap').boundingBox();await page.mouse.move(bar!.x+bar!.width/2,bar!.y+bar!.height-7);
  await page.getByRole('button',{name:'倍速',exact:true}).click();await side(page,4);await page.evaluate(()=>(window as any).nativeSide('forward'));
  expect(await time(page)).toBeCloseTo(40,1);await page.keyboard.press('Escape');
  await page.getByText('编辑媒体信息',{exact:true}).click();await page.getByRole('textbox',{name:'显示标题',exact:true}).focus();
  await side(page,3);await page.evaluate(()=>(window as any).nativeSide('back'));expect(await time(page)).toBeCloseTo(40,1);
});
test('failed settings save leaves the previous duration active',async({page,request})=>{
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await page.route('**/api/preferences',route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{detail:'模拟保存失败'}}):route.continue());
  const section=page.getByRole('region',{name:'鼠标侧键设置'});await section.getByLabel('鼠标侧键跳播时长').fill('10');
  await section.getByRole('button',{name:'保存鼠标快捷键'}).click();await expect(section.getByRole('alert')).toContainText('模拟保存失败');
  expect((await(await request.get('/api/preferences')).json()).values.mouseSeekSeconds).toBeUndefined();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true}).getByRole('button',{name:'放弃修改',exact:true}).click();await player(page);await side(page,4);await expect.poll(()=>time(page)).toBeCloseTo(45,1);
});
test('media action menu blocks both keyboard and mouse side-key seeking',async({page})=>{
  await player(page);await page.locator('.media-more').first().click();await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowRight');await side(page,4);await page.evaluate(()=>(window as any).nativeSide('forward'));expect(await time(page)).toBeCloseTo(40,1);
  await page.keyboard.press('Escape');await side(page,4);await expect.poll(()=>time(page)).toBeCloseTo(45,1);
});
