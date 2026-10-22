// Renderer layout harness: paths are presentation-only fixtures, never file-operation targets.
import {test,expect} from '@playwright/test';
const longTitle='长标题 · '+ '文件名与目录层级验收_'.repeat(16);
const longPath='D:\\'+('长目录层级_'.repeat(6)+'\\').repeat(7)+'原视频.mp4';
test.beforeEach(async({request,page})=>{
  await request.post('/test/reset');await request.patch('/api/media/2',{data:{title:longTitle}});
  await page.addInitScript(()=>{const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).layoutFileCalls=[];window.avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,fileOperation:async value=>{(window as any).layoutFileCalls.push(value);return {ok:true};}} as any;});
  await page.route('**/api/media?**',async route=>{const response=await route.fetch(),value=await response.json();await route.fulfill({response,json:{...value,items:value.items.map((item:any)=>item.id===2?{...item,path:longPath}:item)}});});
  await page.route('**/api/media/2/file-actions',route=>route.fulfill({json:{rename:true,recycle:true,reason:''}}));
});
for(const theme of ['dark','light'])for(const width of [390,760,1440])test(`${theme} ${width}: long rename draft and nested confirmation stay reachable`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.setViewportSize({width,height:500});await page.goto('/');
  const trigger=page.getByRole('button',{name:`更多操作 ${longTitle}`,exact:true});await trigger.click();await page.getByRole('menuitem',{name:'重命名文件',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'重命名视频文件',exact:true});
  await expect(dialog).toBeVisible();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  const title=dialog.getByRole('heading',{name:'重命名文件',exact:true});await expect(title).toBeInViewport();
  const input=dialog.getByRole('textbox',{name:'新文件名',exact:true});await input.fill('仅为未执行的长文件名草稿_'.repeat(12));
  expect((await input.boundingBox())!.width).toBeGreaterThan(await dialog.locator('.file-action-content').evaluate(el=>el.clientWidth*.9));
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'放弃文件名修改？',exact:true});await expect(confirmation).toBeVisible();
  expect((await confirmation.boundingBox())!.width).toBeLessThanOrEqual(480.1);
  expect(await confirmation.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await expect(confirmation.getByRole('button',{name:'取消确认',exact:true})).toBeFocused();
  await page.screenshot({path:`build/dialog-layout-${theme}-${width}.png`});
  await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);await expect(input).toHaveValue('仅为未执行的长文件名草稿_'.repeat(12));
  await expect(title).toBeInViewport();await expect(dialog.getByRole('button',{name:'关闭文件操作',exact:true})).toBeInViewport();
  await expect(dialog.getByRole('button',{name:'取消',exact:true})).toBeInViewport();await expect(dialog).toHaveJSProperty('scrollTop',0);
  expect(await input.evaluate(el=>!el.closest('[inert]'))).toBeTruthy();
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await confirmation.getByRole('button',{name:'放弃修改',exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  expect(await page.evaluate(()=>(window as any).layoutFileCalls)).toEqual([]);
});
