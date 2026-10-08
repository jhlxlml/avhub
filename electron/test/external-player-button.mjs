import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','electron-external-player-')),media=path.join(data,'media');mkdirSync(media);
const file=path.join(media,'External player demo.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=25','-t','3','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true,timeout:15000}).status,0);
const hash=()=>createHash('sha256').update(readFileSync(file)).digest('hex'),before=hash();let desktop;
try {
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  await desktop.evaluate(({shell})=>{globalThis.externalLaunches=[];shell.openPath=async source=>{globalThis.externalLaunches.push(source);return '';};});
  await page.evaluate(async directory=>{await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});await fetch('/api/scan',{method:'POST'});},media);
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/media?page=1')).json()).total)).toBe(1);await page.reload();
  let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss();});const url=page.url();
  await page.getByRole('button',{name:'用系统播放器打开 External player demo',exact:true}).click();
  await expect.poll(()=>desktop.evaluate(()=>globalThis.externalLaunches.length)).toBe(1);
  assert.deepEqual(await desktop.evaluate(()=>globalThis.externalLaunches),[realpathSync(file)]);assert.equal(dialogs,0);assert.equal(page.url(),url);await expect(page.locator('.toast')).toHaveCount(0);
  await page.locator('.media-more').click();await expect(page.getByRole('menuitem',{name:'用系统播放器打开'})).toHaveCount(0);assert.equal(hash(),before);
  console.log('Real Electron cover external-player button passed: direct indexed-ID preload dispatch, validated original path reaches shell.openPath, no confirmation/toast/internal navigation, source unchanged. OS player launch intercepted to avoid opening a user app.');
}finally{if(desktop)await desktop.close();}
