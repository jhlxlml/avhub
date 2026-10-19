// Real Electron UI acceptance; no user library/media or decoder is opened.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),data=ownedTemporaryWorkspace('avhub-help-modes-');
const errors=[],screenshots=[],writes=[];let desktop,armed=false;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:path.join(data,'profile'),AVHUB_APP_HOME:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(armed&&r.method()==='PATCH'&&r.url().endsWith('/api/preferences'))writes.push(r.postData());});
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await page.evaluate(async()=>{const r=await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{playerEngine:'mpv',mpvWindowMode:'independent',librarySort:'added',hoverPreview:false}})});if(!r.ok)throw new Error('Fixture preferences failed');});
 await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'帮助',exact:true}).click();
 const help=page.getByRole('region',{name:'帮助中心'}),picker=help.getByRole('combobox',{name:'帮助播放模式'});
 await expect(picker).toHaveValue('independent');armed=true;
 for(const theme of ['light','dark']){
  const switcher=page.getByRole('button',{name:theme==='light'?'切换至浅色模式':'切换至深色模式',exact:true});
  // Theme controls live outside the modal; use the existing saved appearance
  // policy by closing/reopening settings, not a test stylesheet override.
  armed=false;await page.getByRole('button',{name:'关闭设置',exact:true}).click();if(await switcher.count())await switcher.click();
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'帮助',exact:true}).click();
  for(const mode of ['chromium','embedded','independent']){
   await picker.selectOption(mode);await help.getByRole('tab',{name:'使用指南',exact:true}).click();
   await expect(help).toContainText('不会清空整个系统回收站');await expect(help).not.toContainText('不提供永久删除');
   await help.getByRole('tab',{name:'快捷操作',exact:true}).click();
   await expect(help.locator('kbd').filter({hasText:/^P$/})).toHaveCount(mode==='chromium'?1:0);
   await expect(help.locator('kbd').filter({hasText:/^PageDown$/})).toHaveCount(mode==='independent'?1:0);
   await expect(help.locator('kbd').filter({hasText:/^W$/})).toHaveCount(mode==='independent'?0:1);
   for(const width of [1440,800]){
    await desktop.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,950),width);
    for(const item of await help.locator('.help-mode-picker,.help-card').all())assert.equal(await item.evaluate(n=>n.scrollWidth<=n.clientWidth),true);
    if(width===1440||mode==='independent'){const file=path.join(data,`help-${mode}-${theme}-${width}.png`);await page.screenshot({path:file});screenshots.push(file);}
   }
  }
 }
 // Reading help modes must not become a settings mutation. Observe only the
 // selector switches after the explicit theme changes above have settled.
 armed=true;for(const mode of ['embedded','chromium','independent'])await picker.selectOption(mode);
 await help.getByRole('tab',{name:'使用指南',exact:true}).click();assert.deepEqual(writes,[]);
 const preferences=await page.evaluate(async()=> (await fetch('/api/preferences')).json());
 assert.equal(preferences.values.playerEngine,'mpv');assert.equal(preferences.values.mpvWindowMode,'independent');
 assert.equal((await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active,false);
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 assert.deepEqual(errors,[]);await desktop.close();desktop=null;
 writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({scope:'real Electron help UI with isolated empty data; not video decoding/performance acceptance',screenshots,errors,noPlayback:true,noModePreferenceWrite:true,cleanExit:true},null,2));console.log('Help playback modes passed:',data);
}catch(error){if(desktop)await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});throw error;}finally{if(desktop)await desktop.close().catch(()=>{});}
