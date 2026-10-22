import {test,expect} from '@playwright/test';
for(const theme of ['dark','light'])test(`${theme}: Help contains accurate offline guidance, shortcuts and About in a unified layout`,async({page,request})=>{
  await request.post('/test/reset');let checks=0;page.on('request',r=>{if(r.url().endsWith('/api/updates/check'))checks++;});
  await page.goto('/');if(theme==='light')await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const outer=page.getByRole('tablist',{name:'设置分类'});
  await expect(outer.getByRole('tab',{name:'关于',exact:true})).toHaveCount(0);
  await outer.getByRole('tab',{name:'帮助',exact:true}).click();
  const help=page.getByRole('region',{name:'帮助中心'});
  await expect(help.getByRole('tabpanel',{name:'使用指南'})).toContainText('目前没有上一帧 / 下一帧功能');
  await expect(help.getByRole('tabpanel',{name:'使用指南'})).toContainText('自动置顶');
  await expect(help.getByRole('tabpanel',{name:'使用指南'})).toContainText('400 毫秒');
  await expect(help.getByRole('tabpanel',{name:'使用指南'})).toContainText('文件夹 ZIP');
  await expect(help.getByRole('tabpanel',{name:'使用指南'})).toContainText('不会清空整个系统回收站');
  await expect(help.getByRole('tabpanel',{name:'使用指南'})).not.toContainText('不提供永久删除');
  const tabs=help.getByRole('tablist',{name:'帮助内容'});
  await tabs.getByRole('tab',{name:'使用指南'}).focus();await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab',{name:'快捷操作'})).toBeFocused();
  await expect(help.getByRole('tabpanel',{name:'快捷操作'})).toContainText('后退 / 前进 5 秒');
  await expect(help.getByRole('tabpanel',{name:'快捷操作'})).toContainText('方向键是按秒跳转，不是逐帧选图');
  await expect(help.locator('kbd').filter({hasText:/^C$/})).toHaveCount(1);
  await expect(help.locator('kbd').filter({hasText:/F8|Shift\+S/})).toHaveCount(0);
  await page.screenshot({path:`test-results/help-shortcuts-${theme}-desktop.png`});
  await page.setViewportSize({width:390,height:820});
  for(const element of await page.locator('.help-tabs,.help-card').all())expect(await element.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  // Narrow settings intentionally use a contained horizontal category strip.
  const categories=page.getByRole('tablist',{name:'设置分类',exact:true});await expect(categories).toHaveCSS('overflow-x','auto');
  expect(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.screenshot({path:`test-results/help-shortcuts-${theme}-narrow.png`});
  await tabs.getByRole('tab',{name:'关于',exact:true}).click();
  await expect(help.getByRole('region',{name:'关于 AVHub'})).toBeVisible();await expect(help.getByRole('button',{name:'检查更新',exact:true})).toBeEnabled();
  expect(checks).toBe(0);await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for(const mode of ['embedded','independent'])test(`${mode}: help defaults to the saved engine and reading other modes never saves preferences`,async({page,request})=>{
 await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{playerEngine:'mpv',mpvWindowMode:mode,librarySort:'added',hoverPreview:false}}});
 await page.goto('/');const writes:string[]=[];page.on('request',r=>{if(r.method()==='PATCH'&&r.url().endsWith('/api/preferences'))writes.push(r.postData()||'');});
 await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'帮助',exact:true}).click();
 const help=page.getByRole('region',{name:'帮助中心'}),picker=help.getByRole('combobox',{name:'帮助播放模式'});
 await expect(picker).toHaveValue(mode);await help.getByRole('tab',{name:'快捷操作',exact:true}).click();
 if(mode==='independent'){
  await expect(help.locator('kbd').filter({hasText:/^(PageUp|PageDown|Q)$/})).toHaveCount(3);
  await expect(help.locator('kbd').filter({hasText:/^(N|P|W)$/})).toHaveCount(0);
  await expect(help).toContainText('播放器内滚轮（每格 2%）');
 }else{
  await expect(help.locator('kbd').filter({hasText:/^(N|W)$/})).toHaveCount(2);
  await expect(help.locator('kbd').filter({hasText:/^P$/})).toHaveCount(0);await expect(help).toContainText('暂不支持画中画');
 }
 for(const value of ['chromium','embedded','independent']){
  await picker.selectOption(value);await expect(help.locator('kbd').filter({hasText:/^C$/})).toHaveCount(1);
  for(const width of [390,320]){await page.setViewportSize({width,height:850});for(const el of await help.locator('.help-mode-picker,.help-card').all())expect(await el.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);}
 }
 await expect(help).toContainText('仅切换帮助说明，不修改播放引擎或偏好');expect(writes).toEqual([]);
});
