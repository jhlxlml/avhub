import assert from 'node:assert/strict';
import { _electron, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './playback-geometry.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const build=path.join(root,'build');mkdirSync(build,{recursive:true});
const temporary=mkdtempSync(path.join(build,'electron-window-mode-'));
let desktop;
const stats=()=>desktop.evaluate(({BrowserWindow})=>{
  const w=BrowserWindow.getAllWindows()[0];
  return {bounds:w.getBounds(),content:w.getContentBounds(),normal:w.getNormalBounds(),top:w.isAlwaysOnTop(),full:w.isFullScreen(),minimum:w.getMinimumSize()};
});
async function revealPlayerControls(page) {
  // Keyboard playback deliberately keeps controls hidden, including after a
  // programmatic pause. Simulate the user's mouse move before hit testing;
  // opacity:0 controls still have boxes but correctly reject pointer events.
  const stage=await page.locator('.video-wrap').boundingBox();
  assert.ok(stage);
  // Use the bottom control area, not the picture centre: a save-error notice
  // in a short pure window can cover the centre and intercept that mouse move.
  await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height-20);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  const bar=await page.locator('.player-controls').boundingBox();
  assert.ok(bar);
  await page.mouse.move(bar.x+bar.width/2,bar.y+bar.height-6);
}
async function clickPlayerAction(page,name) {
  await revealPlayerControls(page);
  const action=page.getByRole('button',{name,exact:true});
  if(!await action.isVisible())await page.getByRole('button',{name:'更多播放工具',exact:true}).click();
  await action.click();
}
async function expectRatio(page,ratio) {
  // Native DIP and Chromium CSS pixels can round differently at 125% DPI.
  // Measure the actual letterbox thickness per edge (<= one logical pixel),
  // not an unnormalised width error that grows with ultrawide aspect ratios.
  const edgeGap=(width,height)=>Math.max(width-height*ratio,height-width/ratio,0)/2;
  await expect.poll(async()=>{
    const {content}=await stats();return edgeGap(content.width,content.height);
  }).toBeLessThanOrEqual(1);
  await expect.poll(()=>page.evaluate(r=>Math.max(innerWidth-innerHeight*r,innerHeight-innerWidth/r,0)/2,ratio)).toBeLessThanOrEqual(1);
  assert.equal(await desktop.evaluate(({BrowserWindow,screen})=>{
    const b=BrowserWindow.getAllWindows()[0].getBounds(),w=screen.getDisplayMatching(b).workArea;
    return b.x>=w.x-2 && b.y>=w.y-2 && b.x+b.width<=w.x+w.width+2 && b.y+b.height<=w.y+w.height+2;
  }),true);
}
try {
  const fixture=path.join(temporary,'fixture');mkdirSync(fixture);
  for(const [name,size] of [['A','320x180'],['B','180x320'],['C','240x180'],['D','432x180']]) {
    const generated=spawnSync(path.join(root,'bin','ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=c=navy:s=${size}:r=5`,'-t','60','-c:v','libx264','-pix_fmt','yuv420p',path.join(fixture,`${name}.mp4`)],{windowsHide:true,timeout:30000});
    assert.equal(generated.status,0,generated.stderr?.toString());
  }
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox','--autoplay-policy=no-user-gesture-required'],cwd:temporary,
    env:{...process.env,AVHUB_DATA_DIR:temporary,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置'}).waitFor();
  await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  assert.equal(await page.locator('.desktop-titlebar').count(),1);
  const titlebar=page.getByRole('toolbar',{name:'窗口控制'});
  assert.deepEqual(await titlebar.getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label'))),
    ['关于 AVHub','窗口置顶','最小化窗口','最大化窗口','关闭窗口']);
  await expect(titlebar.getByRole('button',{name:'窗口置顶',exact:true})).toHaveAttribute('aria-pressed','false');
  assert.equal(await titlebar.getByRole('button',{name:'窗口置顶',exact:true}).evaluate(button=>getComputedStyle(button).getPropertyValue('-webkit-app-region')),'no-drag');
  const original=await stats();assert.equal(original.full,false);assert.equal(original.top,false);
  const scroller=page.locator('#app-scroll-area');
  assert.equal((await scroller.boundingBox()).y,32);
  assert.ok(Math.abs((await titlebar.boundingBox()).width-await page.evaluate(()=>innerWidth))<=1);
  await page.evaluate(async directory=>{
    await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});
    await fetch('/api/scan',{method:'POST'});
  },fixture);
  await expect.poll(()=>page.evaluate(async()=>{const r=await fetch('/api/media?page=1');return(await r.json()).total;}),{timeout:30000}).toBe(4);
  await expect(page.locator('.card img.thumbnail-ready')).toHaveCount(4,{timeout:15000});
  assert.equal(await page.locator('.card img.thumbnail-ready').evaluateAll(images=>images.every(img=>img.naturalWidth>0)),true);
  await page.evaluate(()=>{document.querySelector('main').style.minHeight='2200px';document.getElementById('app-scroll-area').scrollTo(0,180);});
  await expect(scroller).toHaveJSProperty('scrollTop',180);
  assert.equal(await page.evaluate(()=>scrollY),0);
  await expect.poll(()=>page.locator('main>header').evaluate(e=>e.getBoundingClientRect().y)).toBe(32);
  await expect(scroller).toHaveAttribute('data-scrollbar-visible','');
  const scrollbarDimensions=await scroller.evaluate(el=>({height:el.scrollHeight,client:el.clientHeight,width:el.clientWidth,gutter:el.offsetWidth-el.clientWidth}));
  console.log('Native scrollbar dimensions',scrollbarDimensions);
  await page.mouse.move(300,250);
  await expect(scroller).not.toHaveAttribute('data-scrollbar-visible','',{timeout:4000});
  await page.screenshot({path:path.join(build,'desktop-scrollbar-hidden.png')});
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  await page.mouse.move(viewport.width-14,250);
  await expect(scroller).toHaveAttribute('data-scrollbar-visible','');
  await page.waitForTimeout(1500);
  await expect(scroller).toHaveAttribute('data-scrollbar-visible','');
  await page.screenshot({path:path.join(build,'desktop-scrollbar-below-titlebar.png')});
  assert.equal(await scroller.evaluate(el=>el.clientWidth),scrollbarDimensions.width);
  // Test a real native thumb, not a DOM replacement. Electron has a classic
  // gutter; headless browser engines may instead use zero-width overlays.
  assert.ok(scrollbarDimensions.gutter>0);
  await scroller.evaluate(el=>el.scrollTo(0,0));
  const thumb=scrollbarDimensions.client*scrollbarDimensions.client/scrollbarDimensions.height;
  const thumbX=viewport.width-scrollbarDimensions.gutter/2,thumbY=32+thumb/2;
  await page.mouse.move(viewport.width-14,thumbY);
  await page.mouse.move(thumbX,thumbY);
  await page.mouse.down();await page.mouse.move(thumbX,thumbY+100,{steps:10});
  await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(50);
  await page.waitForTimeout(1500);
  await expect(scroller).toHaveAttribute('data-scrollbar-visible','');
  await page.mouse.up();await page.mouse.move(300,250);
  await expect(scroller).not.toHaveAttribute('data-scrollbar-visible','',{timeout:4000});
  await page.mouse.move(viewport.width-14,16);
  await expect(scroller).not.toHaveAttribute('data-scrollbar-visible','');
  await page.mouse.move(300,250);
  await scroller.evaluate(el=>el.scrollTo(0,180));
  // Opening/returning must save the inner viewport's scroll, not window.scrollY.
  await page.getByRole('button',{name:'播放 A',exact:true}).evaluate(button=>button.click());
  await expect(page.locator('video')).toHaveCount(1);
  await expect(scroller).toHaveJSProperty('scrollTop',0);
  assert.equal(await page.evaluate(()=>history.state.avhubScroll),180);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2)).toBe(true);
  await page.locator('video').evaluate(v=>{v.pause();v.currentTime=0;});
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(scroller).toHaveJSProperty('scrollTop',180);
  await page.evaluate(()=>{document.querySelector('main').style.removeProperty('min-height');document.getElementById('app-scroll-area').scrollTo(0,0);});
  const id=await page.evaluate(async()=>{const r=await fetch('/api/media?page=1&sort=name');return(await r.json()).items[0].id;});
  await page.goto(new URL(`/?video=${id}`,page.url()).href);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2)).toBe(true);
  await page.locator('video').evaluate(v=>{v.pause();v.currentTime=12;v.dataset.instance='same-native-decoder';});
  const src=await page.locator('video').evaluate(v=>v.currentSrc);
  await expect(page.locator('.player-controls').getByRole('button',{name:'窗口置顶',exact:true})).toHaveCount(0);
  await titlebar.getByRole('button',{name:'窗口置顶',exact:true}).click();
  await expect.poll(async()=>(await stats()).top).toBe(true);
  await expect(titlebar.getByRole('button',{name:'取消窗口置顶',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('video')).toHaveAttribute('data-instance','same-native-decoder');
  await page.screenshot({path:path.join(build,'titlebar-pin-desktop.png')});
  await titlebar.getByRole('button',{name:'取消窗口置顶',exact:true}).click();
  await expect.poll(async()=>(await stats()).top).toBe(false);
  await clickPlayerAction(page,'纯净播放');
  await expect(page.locator('.player-top')).toBeHidden();
  assert.equal((await scroller.boundingBox()).y,0);
  await expect(scroller).toHaveCSS('overflow-y','hidden');
  await expectRatio(page,16/9);
  let current=await stats();assert.equal(current.full,false);assert.deepEqual(current.minimum,[480,270]);
  assert.equal(await page.evaluate(()=>document.fullscreenElement),null);
  await expect(page.locator('video')).toHaveAttribute('data-instance','same-native-decoder');
  assert.equal(await page.locator('video').evaluate(v=>v.currentSrc),src);
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),12);
  await page.mouse.move(200,180);
  await expect(titlebar.getByRole('button',{name:'窗口置顶',exact:true})).toHaveCSS('background-color',
    await page.getByRole('button',{name:'旋转视频，当前 0 度',exact:true}).evaluate(button=>getComputedStyle(button).backgroundColor));
  const floatingStyle=await titlebar.getByRole('button',{name:'窗口置顶',exact:true}).evaluate(button=>{
    const style=getComputedStyle(button),rect=button.getBoundingClientRect();
    return {radius:style.borderRadius,width:rect.width,height:rect.height,background:style.backgroundColor,y:rect.y};
  });
  assert.equal(floatingStyle.radius,'50%');assert.equal(floatingStyle.width,32);assert.equal(floatingStyle.height,32);assert.equal(floatingStyle.y,8);
  assert.equal(await titlebar.evaluate(bar=>getComputedStyle(bar).backgroundColor),'rgba(0, 0, 0, 0)');
  // Render code-native bright/dark surfaces behind the same controls without
  // changing videos, window aspect ratio, decoder or production styling.
  for(const [name,color] of [['light','#fafbff'],['dark','#07101b']]) {
    await page.evaluate(color=>{const stage=document.querySelector('.video-canvas');stage.style.backgroundColor=color;stage.style.visibility='visible';document.querySelector('video').style.visibility='hidden';},color);
    await titlebar.screenshot({path:path.join(build,`pure-window-controls-${name}.png`)});
  }
  await page.evaluate(()=>{document.querySelector('.video-canvas').style.removeProperty('background-color');document.querySelector('.video-canvas').style.removeProperty('visibility');document.querySelector('video').style.removeProperty('visibility');});
  await titlebar.getByRole('button',{name:'关闭窗口',exact:true}).hover();
  await expect(titlebar.getByRole('button',{name:'关闭窗口',exact:true})).toHaveCSS('background-color','rgb(197, 60, 78)');
  await page.emulateMedia({reducedMotion:'reduce'});
  await titlebar.getByRole('button',{name:'窗口置顶',exact:true}).hover();
  await expect(titlebar.getByRole('button',{name:'窗口置顶',exact:true})).toHaveCSS('transform','none');
  await expect(titlebar.getByRole('button',{name:'窗口置顶',exact:true})).toHaveCSS('transition-duration','0s');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.move(200,180);
  await page.keyboard.press('r');await expectRatio(page,9/16);
  await expect(page.locator('video')).toHaveAttribute('data-instance','same-native-decoder');
  await page.screenshot({path:path.join(build,'pure-playback-rotated.png')});
  await page.keyboard.press('r');await expectRatio(page,16/9);
  const beforeExpand=(await stats()).content;
  await page.getByRole('button',{name:'最大化窗口',exact:true}).click();await expectRatio(page,16/9);
  assert.ok((await stats()).content.width>=beforeExpand.width);
  await expect(page.getByRole('button',{name:'还原窗口',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'还原窗口',exact:true}).click();
  await expectRatio(page,16/9);assert.deepEqual((await stats()).content,beforeExpand);
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());
  await expectRatio(page,16/9);
  await expect(page.getByRole('button',{name:'还原窗口',exact:true})).toBeVisible();
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),false);
  await page.getByRole('button',{name:'还原窗口',exact:true}).click();
  await expectRatio(page,16/9);assert.deepEqual((await stats()).content,beforeExpand);
  await clickPlayerAction(page,'全屏');
  await expect.poll(async()=>(await stats()).full).toBe(true);
  const exitFullscreen=page.getByRole('button',{name:'退出视频全屏',exact:true});
  await expect(exitFullscreen).toHaveAttribute('aria-pressed','true');
  await expect(exitFullscreen.locator('svg path')).toHaveCount(4);
  await clickPlayerAction(page,'退出视频全屏');
  await expect.poll(async()=>(await stats()).full).toBe(false);await expectRatio(page,16/9);
  await expect(page.getByRole('button',{name:'全屏',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('html')).not.toHaveClass(/native-video-fullscreen/);
  await expect(page.locator('video')).toHaveAttribute('data-instance','same-native-decoder');
  await clickPlayerAction(page,'全屏');
  await expect(page.getByRole('button',{name:'退出视频全屏',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await expect.poll(async()=>(await stats()).full).toBe(false);
  await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);
  await expect(page.getByRole('button',{name:'全屏',exact:true})).toHaveAttribute('aria-pressed','false');
  await expectRatio(page,16/9);
  await page.locator('video').evaluate(v=>v.play());
  await revealPlayerControls(page);
  // Native fullscreen transitions may leave the mouse at the eventual slider
  // coordinate. Enter from the picture so hover tests witness a real boundary
  // crossing, rather than depending on a stationary synthetic hover.
  const hoverStage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(hoverStage.x+hoverStage.width/2,hoverStage.y+hoverStage.height/2);
  await page.getByRole('slider',{name:'视频完整进度',exact:true}).hover();
  await page.waitForTimeout(1200);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await expect(page.locator('.player-controls')).toHaveCSS('opacity','1');
  await page.keyboard.press('k');
  await expect.poll(()=>page.locator('video').evaluate(v=>v.paused)).toBe(true);
  await page.waitForTimeout(1200);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await page.mouse.move(220,240);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:3000});
  await expect(page.locator('.player-controls')).toHaveCSS('opacity','0');
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('opacity','0');
  await page.keyboard.press('k');
  await expect.poll(()=>page.locator('video').evaluate(v=>v.paused)).toBe(false);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
  await page.mouse.move(220,240);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/,{timeout:3000});
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('opacity','0');
  await page.keyboard.press('k');
  await expect.poll(()=>page.locator('video').evaluate(v=>v.paused)).toBe(true);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
  await expect(page.locator('.player-controls')).toHaveCSS('opacity','0');
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('opacity','0');
  await page.keyboard.press('r');await expectRatio(page,9/16);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
  await page.keyboard.press('r');await expectRatio(page,16/9);
  await page.keyboard.press('k');
  await expect.poll(()=>page.locator('video').evaluate(v=>!v.paused)).toBe(true);
  await expect(page.locator('.player-controls')).toHaveCSS('opacity','0');
  await page.locator('video').evaluate(v=>v.pause());
  await page.getByRole('button',{name:'窗口置顶',exact:true}).click();
  await expect.poll(async()=>(await stats()).top).toBe(true);
  await expect(page.getByRole('button',{name:'取消窗口置顶',exact:true})).toHaveAttribute('aria-pressed','true');
  // Real BrowserWindow resize, not a renderer viewport mock. Keep it hidden so
  // tests never steal focus or pin a test window over the user's desktop.
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:640,height:360}));
  await expectRatio(page,16/9);
  await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThanOrEqual(650);
  const stage=await page.locator('.video-wrap').boundingBox();assert.equal(stage.x,0);assert.equal(stage.y,0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(build,'pure-playback-desktop.png')});
  await page.keyboard.press('Escape');await expect(page.locator('.player-top')).toBeVisible();
  current=await stats();assert.equal(current.top,true);assert.equal(current.full,false);assert.deepEqual(current.minimum,[760,560]);assert.deepEqual(current.bounds,original.bounds);
  assert.equal((await scroller.boundingBox()).y,32);
  await expect(titlebar.getByRole('button',{name:'取消窗口置顶',exact:true})).toHaveCSS('border-radius','0px');
  await page.getByRole('button',{name:'取消窗口置顶',exact:true}).click();assert.equal((await stats()).top,false);
  await page.mouse.move(220,240);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
  await clickPlayerAction(page,'纯净播放');await page.getByRole('button',{name:'窗口置顶',exact:true}).click();
  await clickPlayerAction(page,'播放下一条');
  await expect.poll(()=>page.locator('video').evaluate(v=>v.currentSrc.includes('/media/2/file') && v.readyState>=2)).toBe(true);
  await expectRatio(page,9/16);
  await page.locator('video').evaluate(v=>v.pause());
  await page.screenshot({path:path.join(build,'pure-playback-portrait.png')});
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(270,480));
  await expectRatio(page,9/16);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const compactControls=await page.locator('.player-controls').boundingBox();
  assert.ok(compactControls.x>=0 && compactControls.x+compactControls.width<=await page.evaluate(()=>innerWidth));
  await page.screenshot({path:path.join(build,'pure-playback-portrait-small.png')});
  for(const [id,ratio] of [[3,4/3],[4,2.4]]) {
    await clickPlayerAction(page,'播放下一条');
    await expect.poll(()=>page.locator('video').evaluate((v,id)=>v.currentSrc.includes(`/media/${id}/file`) && v.readyState>=2,id)).toBe(true);
    await expectRatio(page,ratio);await page.locator('video').evaluate(v=>v.pause());
  }
  await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);await expect(page.getByRole('button',{name:'取消窗口置顶',exact:true})).toBeVisible();
  await page.locator('video').evaluate(v=>v.pause());
  await page.route('**/api/media/*/progress',route=>route.fulfill({status:503,json:{detail:'test save failure'}}));
  await clickPlayerAction(page,'返回媒体库');
  await expect(page.getByRole('alert')).toContainText('test save failure');
  await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);assert.equal((await stats()).top,true);
  await page.unroute('**/api/media/*/progress');
  await clickPlayerAction(page,'返回媒体库');
  await expect(page.getByRole('button',{name:'全部视频',exact:true})).toBeVisible();
  await expect.poll(async()=>(await stats()).top).toBe(false);
  assert.equal(await page.evaluate(async()=>(await window.avhubDesktop.getWindowState()).purePlayback),false);
  assert.deepEqual((await stats()).bounds,original.bounds);
  for(const invalid of [{alwaysOnTop:'yes'},{fullScreen:true},{purePlayback:1},{videoAspectRatio:0},{videoAspectRatio:-1},{videoAspectRatio:NaN},{videoAspectRatio:Infinity},{videoAspectRatio:100},{videoAspectRatio:'1.5'}])
    assert.equal(await page.evaluate(async value=>{try{await window.avhubDesktop.setWindowMode(value);return false;}catch{return true;}},invalid),true);
  assert.equal(await page.evaluate(async()=>{try{await window.avhubDesktop.windowAction('shell');return false;}catch{return true;}}),true);
  // Stale metadata after leaving must not resize the library.
  await page.evaluate(()=>window.avhubDesktop.setWindowMode({videoAspectRatio:9/16}));
  assert.deepEqual((await stats()).bounds,original.bounds);
  // Repeat mode switches without growing the window on fractional-DPI Windows.
  for(let i=0;i<3;i++) {
    await page.evaluate(()=>window.avhubDesktop.setWindowMode({purePlayback:true,videoAspectRatio:9/16}));
    await expectRatio(page,9/16);
    await page.evaluate(()=>window.avhubDesktop.setWindowMode({purePlayback:false}));
    assert.deepEqual((await stats()).bounds,original.bounds);
  }
  // A formerly maximized library must restore both maximization and its normal
  // bounds; entering pure mode must not leave a maximized, letterboxed surface.
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());
  await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
  await page.evaluate(()=>window.avhubDesktop.setWindowMode({purePlayback:true,videoAspectRatio:9/16}));
  await expectRatio(page,9/16);
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),false);
  await page.evaluate(()=>window.avhubDesktop.setWindowMode({purePlayback:false}));
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),true);
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize());
  assert.deepEqual((await stats()).bounds,original.bounds);
  // The custom close button must use the existing save-before-quit handshake.
  const closed=desktop.waitForEvent('close',{timeout:60000});
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await closed;desktop=null;
  assert.ok(temporary.startsWith(build+path.sep));rmSync(temporary,{recursive:true,force:true});
  console.log('Electron window mode passed in light theme: video-ratio fit, portrait/4:3/ultrawide, rotation, ratio-preserving expansion and resize, titlebar pin, same decoder, restored bounds, library reset, IPC validation and custom close.');
} catch(error) {
  console.error(error);console.error(`Test data retained: ${temporary}`);process.exitCode=1;
  if(desktop) {
    const page=await desktop.firstWindow();
    console.error(await page.evaluate(()=>({classes:document.documentElement.className,fullscreen:Boolean(document.fullscreenElement),
      buttons:[...document.querySelectorAll('.desktop-titlebar button')].map(b=>b.getAttribute('aria-label')),
      title:document.querySelector('.player-top>span')?.textContent,
      video:document.querySelector('video') && {src:document.querySelector('video').currentSrc,ready:document.querySelector('video').readyState,paused:document.querySelector('video').paused,error:document.querySelector('video').error?.message},
      tools:document.querySelector('[aria-label="更多播放工具"]')?.getAttribute('aria-expanded')})));
    console.error(await stats());
    await page.screenshot({path:path.join(temporary,'failure.png')}).catch(()=>{});
  }
}
finally {
  if(desktop){await desktop.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});}).catch(()=>{});await desktop.close().catch(()=>{});}
}
