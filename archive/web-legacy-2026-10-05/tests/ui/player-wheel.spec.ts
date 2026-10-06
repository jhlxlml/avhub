import {test,expect,type Page} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
const scale=(page:Page)=>page.locator('.video-canvas').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
const scrollTop=(page:Page)=>page.evaluate(()=>window.avhubDesktop?document.getElementById('app-scroll-area')!.scrollTop:window.scrollY);

for(const desktop of [false,true])test(`${desktop?'desktop scroll area':'browser document'}: player wheel zooms without scrolling, outside wheel still scrolls`,async({page})=>{
  await page.setViewportSize({width:1000,height:640});
  if(desktop)await page.addInitScript(()=>{
    const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};
    window.avhubDesktop={getWindowState:async()=>state,setWindowMode:async()=>state,
      onWindowStateChanged:()=>()=>{},windowAction:async()=>null,
      screenshotAction:async()=>({ok:true}),mediaAction:async()=>({ok:true})};
  });
  await page.goto('/?video=1');
  await expect(page.getByRole('button',{name:'从头开始',exact:true})).toBeVisible();
  const stage=page.locator('.video-wrap');
  const box=(await stage.boundingBox())!;
  await page.mouse.move(box.x+box.width*.35,box.y+box.height*.4);
  const before=await scrollTop(page);
  // Even the resume overlay must not allow page scrolling.
  await page.mouse.wheel(0,300);
  await expect.poll(()=>scrollTop(page)).toBe(before);
  await page.getByRole('button',{name:'从头开始',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  const readyBox=(await stage.boundingBox())!;
  await page.mouse.move(readyBox.x+readyBox.width*.35,readyBox.y+readyBox.height*.4);
  const readyScroll=await scrollTop(page);
  await page.mouse.wheel(0,-240);
  await expect.poll(()=>scale(page)).toBeGreaterThan(1);
  expect(await scrollTop(page)).toBe(readyScroll);
  await page.mouse.wheel(0,1000);
  await expect.poll(()=>scale(page)).toBe(1);
  expect(await scrollTop(page)).toBe(readyScroll);
  // At minimum zoom, more wheel-down must still be consumed.
  await page.mouse.wheel(0,400);
  await page.waitForTimeout(150);
  expect(await scrollTop(page)).toBe(readyScroll);
  expect(await scale(page)).toBe(1);
  // The overlay control bar belongs to the same wheel boundary.
  const play=page.getByRole('button',{name:'暂停',exact:true});
  await page.mouse.move(readyBox.x+readyBox.width/2,readyBox.y+readyBox.height-35);
  await expect(play).toBeVisible();
  await play.hover();
  await page.mouse.wheel(0,-120);
  await expect.poll(()=>scale(page)).toBeGreaterThan(1);
  expect(await scrollTop(page)).toBe(readyScroll);
  // Native horizontal scrolling and line/page delta modes are also consumed.
  const cancelled=await stage.evaluate(el=>[0,1,2].map(deltaMode=>!el.dispatchEvent(new WheelEvent('wheel',
    {bubbles:true,cancelable:true,deltaMode,deltaX:100,deltaY:0}))));
  expect(cancelled).toEqual([true,true,true]);
  await page.mouse.move(5,Math.min(600,readyBox.y+120));
  await page.mouse.wheel(0,400);
  await expect.poll(()=>scrollTop(page)).toBeGreaterThan(readyScroll);
});

test('wheel is released after leaving and opening another video',async({page})=>{
  await page.goto('/?video=1');
  await page.getByRole('button',{name:'从头开始',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
  await expect(page.locator('.video-wrap')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'加入播放列表 视频 001',exact:true})).toBeVisible();
  await page.mouse.move(600,500);await page.mouse.wheel(0,400);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);
  await page.goto('/?video=2');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  const box=(await page.locator('.video-wrap').boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  const before=await scrollTop(page);await page.mouse.wheel(0,-120);
  await expect.poll(()=>scale(page)).toBeGreaterThan(1);
  expect(await scrollTop(page)).toBe(before);
});

test('long player settings scroll locally without zooming or moving the page',async({page})=>{
  await page.setViewportSize({width:1000,height:540});
  await page.goto('/?video=1');
  await page.getByRole('button',{name:'从头开始',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  await page.getByRole('button',{name:'字幕',exact:true}).click();
  const panel=page.getByRole('region',{name:'字幕设置弹层',exact:true});
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(el=>el.scrollHeight>el.clientHeight)).toBeTruthy();
  const before=await scrollTop(page),zoom=await scale(page);
  const box=(await panel.boundingBox())!;
  await page.mouse.move(box.x+8,box.y+box.height/2);
  await page.mouse.wheel(0,500);
  await expect.poll(()=>panel.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  expect(await scrollTop(page)).toBe(before);expect(await scale(page)).toBe(zoom);
  await page.mouse.wheel(0,500);
  await page.waitForTimeout(150);
  expect(await scrollTop(page)).toBe(before);
});
