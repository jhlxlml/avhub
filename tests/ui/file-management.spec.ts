// UI-only bridge harness; actual filesystem and system recycling use Electron TEMP acceptance.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request,page})=>{
  await request.post('/test/reset');await page.addInitScript(()=>{
    const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).fileCalls=[];
    window.avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,fileOperation:async value=>{(window as any).fileCalls.push(value);return {ok:true};}} as any;
  });
});
test('directory permissions start disabled, require explicit consent and use native bridge',async({page})=>{
  await page.route('**/api/file-permissions?**',route=>route.fulfill({json:[{root_id:1,supported:true,rename:false,recycle:false,reason:''},{root_id:2,supported:true,rename:false,recycle:false,reason:''}]}));
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();const rename=page.getByRole('checkbox',{name:/^允许重命名/}).first();await expect(rename).not.toBeChecked();
  await rename.click();const confirmation=page.getByRole('dialog',{name:'开启文件整理权限？',exact:true});await expect(confirmation).toBeVisible();await expect(page.getByRole('button',{name:'关闭窗口',exact:true})).toBeEnabled();await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);await expect(rename).not.toBeChecked();expect(await page.evaluate(()=>(window as any).fileCalls.length)).toBe(0);
  await rename.click();await confirmation.getByRole('button',{name:'开启权限',exact:true}).click();await expect(rename).toBeChecked();expect(await page.evaluate(()=>(window as any).fileCalls)).toEqual([{action:'permissions',id:1,rename:true,recycle:false}]);
});
for(const theme of ['dark','light'])test(`${theme}: file dialogs have locked extensions, preserve drafts on errors and never execute on cancel`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.route('**/api/media/*/file-actions',route=>route.fulfill({json:{rename:true,recycle:true,name:'second.mp4',reason:''}}));
  await page.goto('/');await page.getByRole('button',{name:'更多操作 视频 002',exact:true}).click();await page.getByRole('menuitem',{name:'重命名文件',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('扩展名锁定');await expect(dialog.locator('.file-action-target')).toContainText('second.mp4');await expect(dialog.locator('.file-action-cover')).toBeVisible();await page.getByLabel('新文件名').fill('整理后的文件');
  await page.evaluate(()=>{window.avhubDesktop!.fileOperation=async()=>{throw new Error('文件被占用');};});await page.getByRole('button',{name:'确认重命名',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('文件被占用');await expect(page.getByLabel('新文件名')).toHaveValue('整理后的文件');
  await page.setViewportSize({width:390,height:800});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:`build/file-management-${theme}.png`});
  await page.getByRole('button',{name:'取消',exact:true}).click();const confirm=page.getByRole('dialog',{name:'放弃文件名修改？',exact:true});await expect(confirm).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByLabel('新文件名')).toHaveValue('整理后的文件');await page.getByRole('button',{name:'取消',exact:true}).click();await confirm.getByRole('button',{name:'放弃修改',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'更多操作 视频 002',exact:true}).click();await page.getByRole('menuitem',{name:'移入系统回收站',exact:true}).click();await expect(dialog).toContainText('不建立应用回收目录');await page.getByRole('button',{name:'取消',exact:true}).click();expect(await page.evaluate(()=>(window as any).fileCalls)).toEqual([]);
});
test('default read-only file menu cannot perform filesystem operations',async({page})=>{
  await page.goto('/');await page.locator('.media-more').first().click();await expect(page.getByRole('menuitem',{name:'重命名文件',exact:true})).toBeDisabled();await expect(page.getByRole('menuitem',{name:'移入系统回收站',exact:true})).toBeDisabled();
});

test('file-operation success toast dismisses automatically',async({page})=>{
  await page.route('**/api/media/*/file-actions',route=>route.fulfill({json:{rename:true,recycle:true,name:'second.mp4',reason:''}}));
  await page.goto('/');await page.getByRole('button',{name:'更多操作 视频 002',exact:true}).click();await page.getByRole('menuitem',{name:'重命名文件',exact:true}).click();
  await page.getByLabel('新文件名').fill('新标题');await page.getByRole('button',{name:'确认重命名',exact:true}).click();
  const toast=page.locator('.toast');await expect(toast).toContainText('文件名和视频标题已同步更新');await expect(toast).toHaveAttribute('role','status');await expect(toast).toHaveCount(0,{timeout:6500});
});

test('operation history retains results without a rename undo entry',async({page})=>{
  await page.route('**/api/file-operations?**',route=>route.fulfill({json:{items:[{id:'a'.repeat(32),media_id:2,action:'rename',source:'D:\\media\\original.mp4',target:'D:\\media\\renamed.mp4',state:'completed',error:'',created_at:1,can_undo:false,undo_reason:'原文件名已被其他文件占用，不会覆盖'}],total:1,page:1,pages:1}}));
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  const section=page.getByRole('region',{name:'文件操作记录'});
  // The section has a descriptive aria-label but is not an independent modal.
  await expect(section.getByRole('button',{name:'撤销重命名',exact:true})).toHaveCount(0);await expect(section).toContainText('renamed.mp4');await expect(section).toContainText('重命名不提供撤销');
  expect(await page.evaluate(()=>(window as any).fileCalls)).toEqual([]);
});

test('file state filters distinguish missing and recycled; checks use only media IDs',async({page})=>{
  let reads=0;
  await page.route('**/api/file-states?**',async route=>{
    // Keep refresh and completion statuses simultaneously visible to reproduce
    // slower CI responses instead of assuming there is only one live region.
    if(++reads>=3)await new Promise(resolve=>setTimeout(resolve,250));
    const state=new URL(route.request().url()).searchParams.get('state');const status=state==='missing'?'missing':'recycled';
    return route.fulfill({json:{items:[{id:2,name:'second.mp4',title:'视频 002',path:'D:\\media\\second.mp4',status}],total:1,page:1,pages:1}});
  });
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  const section=page.getByRole('region',{name:'文件状态管理'});await expect(section).toContainText('已移入系统回收站 · 视频 002');await section.getByLabel('文件状态筛选').selectOption('missing');await expect(section).toContainText('文件缺失 · 视频 002');
  await section.getByRole('button',{name:'核对恢复',exact:true}).click();await expect(section.getByRole('status').filter({hasText:'已核对文件状态'})).toBeVisible();await expect(section.locator('.ui-status.loading')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).fileCalls)).toEqual([{action:'recheck',id:2}]);
  await section.getByRole('button',{name:'仅移除记录',exact:true}).click();const confirm=page.getByRole('dialog',{name:'仅移除缺失记录？',exact:true});await expect(confirm).toContainText('不删除磁盘文件');await confirm.getByRole('button',{name:'取消',exact:true}).click();expect(await page.evaluate(()=>(window as any).fileCalls.length)).toBe(1);
  await section.getByRole('button',{name:'仅移除记录',exact:true}).click();await confirm.getByRole('button',{name:'移除记录',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).fileCalls.length)).toBe(2);expect(await page.evaluate(()=>(window as any).fileCalls[1])).toEqual({action:'forget',id:2});await expect(section.locator('.ui-status.loading')).toHaveCount(0);
});
