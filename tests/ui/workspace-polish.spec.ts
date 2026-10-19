// Renderer-only layout/focus harness; real filesystem acceptance uses Electron.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});

for(const theme of ['light','dark'])test(`${theme}: settings navigation adapts orientation and keeps unsaved protection`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.setViewportSize({width:1440,height:900});await page.goto('/');
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const tabs=page.getByRole('tablist',{name:'设置分类'}),dialog=page.getByRole('dialog',{name:'媒体库设置',exact:true});
  await expect(tabs).toHaveAttribute('aria-orientation','vertical');
  const left=await tabs.boundingBox(),panel=await page.getByRole('tabpanel').boundingBox();expect(left!.x+left!.width).toBeLessThan(panel!.x);
  await page.getByRole('tab',{name:'媒体目录',exact:true}).focus();await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab',{name:'播放偏好',exact:true})).toBeFocused();
  await expect(page.getByRole('tab',{name:'播放偏好',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'帮助',exact:true})).toBeFocused();
  await page.keyboard.press('Home');await expect(page.getByRole('tab',{name:'媒体目录',exact:true})).toBeFocused();
  await page.getByRole('textbox',{name:'目录路径',exact:true}).fill('D:\\未保存的目录');
  await page.setViewportSize({width:760,height:850});await expect(tabs).toHaveAttribute('aria-orientation','horizontal');
  await page.getByRole('tab',{name:'媒体目录',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'播放偏好',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true});await expect(confirm).toBeVisible();
  await expect(confirm).toHaveClass(/is-destructive/);await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(dialog).toBeVisible();
  await page.getByRole('tab',{name:'媒体目录',exact:true}).click();await expect(page.getByRole('textbox',{name:'目录路径',exact:true})).toHaveValue('D:\\未保存的目录');
  await page.getByRole('textbox',{name:'目录路径',exact:true}).fill('');
  for(const width of [1024,820,819,600,390,320]){
    await page.setViewportSize({width,height:850});
    await expect.poll(()=>dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});

test('file preview shows both resulting names without a filesystem call on cancel',async({page})=>{
  await page.addInitScript(()=>{(window as any).writeCalls=[];window.avhubDesktop={fileOperation:async value=>{(window as any).writeCalls.push(value);return {ok:true};},getWindowState:async()=>({purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false}),onWindowStateChanged:()=>()=>{}} as any;});
  await page.route('**/api/media/*/file-actions',r=>r.fulfill({json:{rename:true,recycle:true,name:'second.mp4',reason:''}}));
  await page.goto('/');await page.getByRole('button',{name:'更多操作 视频 002',exact:true}).click();await page.getByRole('menuitem',{name:'重命名文件',exact:true}).click();
  await page.getByRole('textbox',{name:'新文件名',exact:true}).fill('新的文件名');
  const preview=page.getByLabel('重命名预览');await expect(preview).toContainText('新的文件名.mp4');await expect(preview.locator('strong')).toHaveText(['新的文件名.mp4','新的文件名']);
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).writeCalls)).toEqual([]);
  await page.getByRole('button',{name:'更多操作 视频 002',exact:true}).click();await page.getByRole('menuitem',{name:'移入系统回收站',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'移入系统回收站',exact:true});await expect(dialog).toHaveClass(/is-destructive/);
  const colors=await dialog.evaluate(e=>({danger:getComputedStyle(e).getPropertyValue('--ui-danger').trim(),accent:getComputedStyle(e).getPropertyValue('--ui-accent').trim()}));expect(colors.danger).not.toBe(colors.accent);
  await page.getByRole('button',{name:'取消',exact:true}).click();expect(await page.evaluate(()=>(window as any).writeCalls)).toEqual([]);
});
