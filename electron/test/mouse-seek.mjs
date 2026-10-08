import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','electron-mouse-seek-')),media=path.join(data,'media');mkdirSync(media);
const file=path.join(media,'Mouse seek demo.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=25','-t','60','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true,timeout:15000}).status,0);
const hash=()=>createHash('sha256').update(readFileSync(file)).digest('hex'),before=hash();
let desktop;
async function launch(){
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:data,
    env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();return page;
}
async function command(direction){
  return desktop.evaluate(({BrowserWindow},direction)=>{
    let handled=false;BrowserWindow.getAllWindows()[0].emit('app-command',{preventDefault(){handled=true;}},direction==='forward'?'browser-forward':'browser-backward');return handled;
  },direction);
}
async function open(page,id,point){
  await page.goto(new URL(`/?video=${id}`,page.url()).href);
  const resume=page.getByRole('button',{name:'从头开始',exact:true});
  await expect(resume.or(page.getByRole('button',{name:'暂停',exact:true})).first()).toBeVisible();if(await resume.isVisible())await resume.click();
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2)).toBe(true);
  await page.locator('video').evaluate((v,p)=>{v.pause();v.currentTime=p;v.dataset.mouseSeek='same-original-decoder';},point);
  await expect.poll(()=>page.locator('video').evaluate(v=>!v.seeking)).toBe(true);
}
try {
  let page=await launch();
  await page.evaluate(async directory=>{await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});await fetch('/api/scan',{method:'POST'});},media);
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).total),{timeout:15000}).toBe(1);
  const id=await page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).items[0].id);
  await open(page,id,40);const src=await page.locator('video').evaluate(v=>v.currentSrc),url=page.url();
  await page.locator('video').evaluate(v=>{
    window.mouseSourceReloads=0;v.addEventListener('loadedmetadata',()=>window.mouseSourceReloads++);
    window.mouseDecodedFrame=null;
    const frame=(_now,meta)=>{window.mouseDecodedFrame=meta.mediaTime;v.requestVideoFrameCallback(frame);};v.requestVideoFrameCallback(frame);
  });
  const time=()=>page.locator('video').evaluate(v=>v.currentTime);
  const cdp=await page.context().newCDPSession(page),stage=await page.locator('.video-wrap').boundingBox();
  for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,button:'forward',buttons:type==='mousePressed'?16:0,x:stage.x+100,y:stage.y+100,clickCount:1});
  await expect.poll(time).toBeCloseTo(45,1);
  await expect.poll(()=>page.evaluate(()=>window.mouseDecodedFrame)).toBeCloseTo(45,1);
  assert.equal(await command('back'),true);await expect.poll(time).toBeCloseTo(40,1);
  assert.equal(page.url(),url);assert.equal(await page.locator('video').evaluate(v=>v.currentSrc),src);
  assert.equal(await page.evaluate(()=>window.mouseSourceReloads),0);
  await expect(page.locator('video')).toHaveAttribute('data-mouse-seek','same-original-decoder');assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
  await page.locator('.media-more').first().click();await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowRight');await command('forward');await page.waitForTimeout(150);assert.equal(await time(),40);
  await page.keyboard.press('Escape');await page.keyboard.press('Tab');await page.getByRole('button',{name:'窗口置顶',exact:true}).focus();await page.keyboard.press('Space');
  await expect(page.locator('.window-pin')).toHaveAttribute('aria-pressed','true');assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
  await page.keyboard.press('Space');await expect(page.locator('.window-pin')).toHaveAttribute('aria-pressed','false');
  await page.goto(new URL('/',page.url()).href);assert.equal(await command('back'),false);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await page.getByLabel('鼠标侧键跳播时长').fill('17');page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.getByLabel('鼠标侧键跳播时长')).toHaveValue('17');
  await desktop.evaluate(({dialog})=>{globalThis.quitPrompts=[];dialog.showMessageBox=async(_window,options)=>{globalThis.quitPrompts.push(options);return {response:2,checkboxChecked:false};};});
  let rendererQuitPrompts=0;page.on('dialog',async dialog=>{rendererQuitPrompts++;await dialog.dismiss();});
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await expect.poll(()=>desktop.evaluate(()=>globalThis.quitPrompts.length)).toBe(1);
  assert.equal(rendererQuitPrompts,0);await expect(page.getByLabel('鼠标侧键跳播时长')).toHaveValue('17');
  await page.getByLabel('鼠标侧键跳播时长').fill('9');await page.getByRole('button',{name:'保存鼠标快捷键',exact:true}).click();await expect(page.getByText('鼠标侧键时长已保存',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await desktop.close();desktop=null;
  page=await launch();await open(page,id,20);await command('back');await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime)).toBeCloseTo(11,1);
  assert.equal(hash(),before);
  await page.evaluate(async id=>{
    await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{queueMode:'repeat-one',autoNext:false}})});
    await fetch('/api/playlists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Native isolated playlist',media_ids:[id]})});
  },id);
  await page.goto(new URL('/',page.url()).href);await page.getByRole('button',{name:'播放列表',exact:true}).click();await page.getByRole('button',{name:'随机播放列表',exact:true}).click();
  await page.getByRole('button',{name:'展开待播队列'}).click();await expect(page.getByLabel('播放模式',{exact:true})).toHaveValue('random');
  await page.getByLabel('播放模式',{exact:true}).selectOption('sequential');await page.getByLabel('自动连播',{exact:true}).check();await page.reload();
  await expect(page.getByLabel('播放模式',{exact:true})).toHaveValue('sequential');await expect(page.getByLabel('自动连播',{exact:true})).toBeChecked();
  assert.deepEqual(await page.evaluate(async()=>{const v=(await(await fetch('/api/preferences')).json()).values;return {mode:v.queueMode,enabled:v.autoNext};}),{mode:'repeat-one',enabled:false});
  assert.equal(hash(),before);
  console.log('Real Electron interaction passed: CDP side-button input, native app-command replay, menu suppression, keyboard-focused pin Space activation, unsaved draft protection, playlist-local mode/autoplay across reload, no navigation/source reload, paused state, saved custom duration after process restart, unchanged synthetic source. Physical mouse/driver hardware not exercised.');
}finally{if(desktop)await desktop.close();}
