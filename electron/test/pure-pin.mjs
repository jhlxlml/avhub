import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','electron-pure-pin-'));
const media=path.join(data,'media');mkdirSync(media);
const made=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=25','-t','8','-c:v','libx264','-pix_fmt','yuv420p',path.join(media,'A.mp4')],{windowsHide:true,timeout:15000});
assert.equal(made.status,0,'synthetic video fixture');
let desktop;
try {
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:data,
    env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  await desktop.evaluate(({shell})=>{globalThis.releaseLinks=[];shell.openExternal=async url=>{globalThis.releaseLinks.push(url);};});
  for(const format of ['folder','single'])await page.evaluate(format=>window.avhubDesktop.openRelease('v0.2.99',format),format);
  const urls=await desktop.evaluate(()=>globalThis.releaseLinks);
  assert.deepEqual(urls,['https://github.com/jhlxlml/avhub/releases/download/v0.2.99/AVHub-folder-portable-0.2.99-x64.zip','https://github.com/jhlxlml/avhub/releases/download/v0.2.99/AVHub-portable-0.2.99-x64.exe']);
  assert.equal(await page.evaluate(async()=>{try{await window.avhubDesktop.openRelease('v0.2.99','https://invalid.example');return false;}catch{return true;}}),true);
  const nativeTop=()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isAlwaysOnTop());
  await page.evaluate(async directory=>{
    await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});
    await fetch('/api/scan',{method:'POST'});
  },media);
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).total),{timeout:15000}).toBe(1);
  const id=await page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).items[0].id);
  await page.goto(new URL(`/?video=${id}`,page.url()).href);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2)).toBe(true);
  await page.locator('video').evaluate(v=>{v.pause();v.currentTime=2;v.dataset.pinTest='same-decoder';});
  await expect.poll(()=>page.locator('video').evaluate(v=>!v.seeking)).toBe(true);
  const src=await page.locator('video').evaluate(v=>v.currentSrc);
  const mode=value=>page.evaluate(value=>window.avhubDesktop.setWindowMode(value),value);
  assert.equal(await nativeTop(),false);
  // Even a manually pinned normal window must unpin on pure-mode exit.
  await mode({alwaysOnTop:true});await page.keyboard.press('w');
  await expect.poll(()=>nativeTop()).toBe(true);
  await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);
  await page.mouse.move(200,18);
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('opacity','1');
  await page.waitForTimeout(700);
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('opacity','1');
  await page.mouse.move(200,150);
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('opacity','0',{timeout:900});
  for(let x=200;x<=300;x+=20) {
    await page.mouse.move(x,150);
    assert.notEqual(await page.locator('.video-canvas').evaluate(v=>getComputedStyle(v).cursor),'none');
    await page.waitForTimeout(100);
  }
  await expect(page.locator('.video-canvas')).toHaveCSS('cursor','none',{timeout:1000});
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('cursor','none');
  await page.keyboard.press('w');await expect.poll(()=>nativeTop()).toBe(false);
  await expect(page.locator('.player-shell')).not.toHaveClass(/is-pure-playback/);
  // Transition policy wins over conflicting fields, while in-mode manual
  // unpin survives ratio updates and idempotent mode requests.
  await mode({purePlayback:true,alwaysOnTop:false,videoAspectRatio:16/9});assert.equal(await nativeTop(),true);
  await mode({alwaysOnTop:false});await mode({videoAspectRatio:9/16});await mode({purePlayback:true});
  assert.equal(await nativeTop(),false);
  await mode({alwaysOnTop:true});await mode({purePlayback:false,alwaysOnTop:true});assert.equal(await nativeTop(),false);
  await page.keyboard.press('w');await expect.poll(()=>nativeTop()).toBe(true);
  await expect(page.getByRole('button',{name:'退出纯净播放',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');await expect.poll(()=>nativeTop()).toBe(false);
  await expect(page.locator('video')).toHaveAttribute('data-pin-test','same-decoder');
  assert.equal(await page.locator('video').evaluate(v=>v.currentSrc),src);
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),2);
  assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
  console.log('Real Electron pure pin passed: W/Esc, enter pin, exit unpin, manual overrides, conflicting IPC, same decoder/source/time.');
} finally {
  if(desktop)await desktop.close();
}
