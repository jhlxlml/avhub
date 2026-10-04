import { test,expect,type Page } from '@playwright/test';

const visible='data-scrollbar-visible';
const transparent='rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function library(page:Page) {
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  await page.mouse.move(300,250);
}

for(const theme of ['dark','light'])test(`document scrollbar reveals only for scrolling or its edge in ${theme}`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await library(page);
  const root=page.locator('html');
  await expect(root).not.toHaveAttribute(visible,'');
  await expect(root).toHaveCSS('scrollbar-color',transparent);
  const initial=await page.locator('.media-grid').evaluate(el=>el.getBoundingClientRect().width);
  await page.mouse.wheel(0,350);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
  await expect(root).toHaveAttribute(visible,'');
  expect(await root.evaluate(el=>getComputedStyle(el).scrollbarColor)).not.toBe(transparent);
  await expect(root).not.toHaveAttribute(visible,'',{timeout:4000});
  const size=page.viewportSize()!;
  await page.mouse.move(size.width-14,350);
  await page.mouse.move(size.width-4,350,{steps:5});
  await expect(root).toHaveAttribute(visible,'');
  await page.waitForTimeout(1500);
  await expect(root).toHaveAttribute(visible,'');
  await page.screenshot({path:`test-results/scrollbar-${theme}-visible.png`});
  await page.mouse.move(300,250);
  await expect(root).not.toHaveAttribute(visible,'',{timeout:4000});
  expect(await page.locator('.media-grid').evaluate(el=>el.getBoundingClientRect().width)).toBe(initial);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`test-results/scrollbar-${theme}-hidden.png`});
});

test('keyboard scrolling reveals the document bar without moving the grid',async({page})=>{
  await library(page);
  // Headless Edge uses zero-gutter overlays. The actual classic native thumb
  // is exercised by electron/test/window-mode.mjs on the desktop window.
  const initial=await page.locator('.media-grid').evaluate(el=>el.getBoundingClientRect().width);
  const before=await page.evaluate(()=>scrollY);
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  await page.keyboard.press('PageDown');
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(before);
  await expect(page.locator('html')).toHaveAttribute(visible,'');
  await expect(page.locator('html')).not.toHaveAttribute(visible,'',{timeout:4000});
  expect(await page.locator('.media-grid').evaluate(el=>el.getBoundingClientRect().width)).toBe(initial);
});

test('settings scroll independently, stay visible at their edge and release detached hover state',async({page,request})=>{
  await request.post('/test/many-roots');
  await page.setViewportSize({width:960,height:600});await library(page);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect.poll(()=>dialog.evaluate(el=>el.scrollHeight>el.clientHeight)).toBeTruthy();
  const box=await dialog.boundingBox();
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);
  await page.mouse.wheel(0,350);
  await expect.poll(()=>dialog.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await expect(dialog).toHaveAttribute(visible,'');
  await expect(page.locator('html')).not.toHaveAttribute(visible,'');
  await expect(dialog).not.toHaveAttribute(visible,'',{timeout:4000});
  await page.mouse.move(box!.x+box!.width-14,box!.y+box!.height/2);
  await expect(dialog).toHaveAttribute(visible,'');
  await page.waitForTimeout(1500);await expect(dialog).toHaveAttribute(visible,'');
  await page.evaluate(()=>{(window as any).__closedScroller=document.querySelector('[role="dialog"]');});
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).__closedScroller.hasAttribute('data-scrollbar-visible'))).toBeFalsy();
  await expect(page.locator('html')).not.toHaveCSS('overflow','hidden');
});

test('narrow horizontal navigation reveals its own scrollbar rather than every bar',async({page})=>{
  await page.setViewportSize({width:390,height:720});await library(page);
  const nav=page.locator('.primary-nav');
  await expect.poll(()=>nav.evaluate(el=>el.scrollWidth>el.clientWidth)).toBeTruthy();
  await nav.evaluate(el=>{el.scrollLeft=100;});
  await expect(nav).toHaveAttribute(visible,'');
  await expect(nav).not.toHaveAttribute(visible,'',{timeout:4000});
  const box=await nav.boundingBox();
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height-3);
  await expect(nav).toHaveAttribute(visible,'');
  await page.waitForTimeout(1500);await expect(nav).toHaveAttribute(visible,'');
  await page.mouse.move(100,250);
  await expect(nav).not.toHaveAttribute(visible,'',{timeout:4000});
});

test('high contrast keeps native scrollbar visibility and native selects retain system scrollbars',async({page})=>{
  await library(page);
  await expect(page.getByRole('combobox',{name:'排序方式'})).toHaveCSS('scrollbar-color','auto');
  await page.emulateMedia({forcedColors:'active'});
  await expect(page.locator('html')).toHaveCSS('scrollbar-color','auto');
});

test('nested playlist navigation reveals only its active native scrollbar',async({page,request})=>{
  for(let index=0;index<12;index++)await request.post('/api/playlists',{data:{name:`片单 ${index+1}`}});
  await page.setViewportSize({width:390,height:600});await library(page);
  await page.getByRole('button',{name:'播放列表',exact:true}).click();
  const list=page.locator('.playlist-list');
  await expect.poll(()=>list.evaluate(el=>el.scrollHeight>el.clientHeight)).toBeTruthy();
  const box=(await list.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.wheel(0,150);
  await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await expect(list).toHaveAttribute(visible,'');
  await expect(list).not.toHaveAttribute(visible,'',{timeout:4000});
  await page.mouse.move(box.x+box.width-14,box.y+box.height/2);
  await expect(list).toHaveAttribute(visible,'');
  await page.waitForTimeout(1500);await expect(list).toHaveAttribute(visible,'');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('subtitle popover scrolling and edge hover work without changing paused playback',async({page})=>{
  await page.setViewportSize({width:960,height:600});await page.goto('/?video=2');
  const start=page.getByRole('button',{name:'从头开始',exact:true});
  const fullscreen=page.getByRole('button',{name:'全屏',exact:true});
  await expect.poll(async()=>await start.isVisible()||await fullscreen.isEnabled()).toBeTruthy();
  if(await start.isVisible())await start.click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.dataset.scrollTest='same-decoder';});
  await page.getByRole('button',{name:'纯净播放',exact:true}).click();
  await page.setViewportSize({width:960,height:360});await page.mouse.move(480,340);
  await page.getByRole('button',{name:'字幕',exact:true}).click();
  const panel=page.getByRole('region',{name:'字幕设置弹层'});
  await expect.poll(()=>panel.evaluate(el=>el.scrollHeight>el.clientHeight)).toBeTruthy();
  await panel.evaluate(el=>{el.scrollTop=0;});
  const box=(await panel.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.wheel(0,120);
  await expect.poll(()=>panel.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await expect(panel).toHaveAttribute(visible,'');
  await expect(panel).not.toHaveAttribute(visible,'',{timeout:4000});
  await page.mouse.move(box.x+box.width-14,box.y+box.height/2);
  await expect(panel).toHaveAttribute(visible,'');
  await page.waitForTimeout(1500);await expect(panel).toHaveAttribute(visible,'');
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await expect(page.locator('video')).toHaveAttribute('data-scroll-test','same-decoder');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
  await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
});
