import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','electron-update-banner-'));
let desktop;
try {
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:data,
    env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  let state='available',checks=0;
  await page.route('**/api/updates/check',route=>{checks++;return route.fulfill({status:state==='error'?504:200,json:state==='error'?{detail:'模拟离线：不影响本地播放'}:{status:state,version:'0.2.99',tag:'v0.2.99'}});});
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'帮助',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
  assert.equal(checks,0);
  for(const status of ['available','current','error']) {
    state=status;await page.getByRole('button',{name:'检查更新',exact:true}).click();
    const banner=page.getByLabel('更新检查结果',{exact:true});await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(new RegExp('is-'+status));await expect(banner).toHaveAttribute('role',status==='error'?'alert':'status');
    await banner.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(data,`result-${status}.png`)});
  }
  assert.equal(checks,3);await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.getByLabel('更新检查结果',{exact:true})).toHaveCount(0);
  console.log('Real Electron update banner passed: manual only, three result states, screenshots and close cleanup. '+data);
} finally {if(desktop)await desktop.close();}
