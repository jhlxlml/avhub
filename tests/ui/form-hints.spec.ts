// Isolated renderer harness; real Electron acceptance uses library-refinement.mjs.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light']) {
  test(`${theme}: screenshot read retry preserves a draft across category switches`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    let reads=0;await page.route('**/api/screenshots/settings',route=>{
      if(route.request().method()==='GET'&&++reads===1)return route.fulfill({status:503,json:{detail:'测试：截图目录读取失败'}});
      return route.continue();
    });
    await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
    const section=page.getByRole('region',{name:'视频截图设置',exact:true});
    await expect(section.getByRole('alert')).toContainText('截图目录读取失败');
    await expect(section.locator('.screenshot-path')).toContainText('尚未读取，请重试');
    await section.getByRole('button',{name:'重新读取截图设置',exact:true}).click();
    const directory=section.getByLabel('默认保存目录',{exact:true});await expect(directory).toBeEnabled();
    await expect(directory).toHaveAccessibleDescription(/修改后需点击/);
    await directory.fill('D:\\仅为未保存的目录草稿');
    await page.getByRole('tab',{name:'数据管理',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
    await expect(directory).toHaveValue('D:\\仅为未保存的目录草稿');expect(reads).toBe(2);
    await expect(section.getByRole('alert')).toHaveCount(0);
  });
  test(`${theme}: numeric validation and auto-save help are linked to their controls`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    await page.setViewportSize({width:390,height:820});await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
    const input=page.getByRole('spinbutton',{name:'鼠标侧键跳播时长',exact:true});await input.fill('0');
    await expect(input).toHaveAttribute('aria-invalid','true');await expect(input).toHaveAccessibleDescription(/1–120 之间/);
    await expect(page.getByRole('button',{name:'保存鼠标快捷键',exact:true})).toBeDisabled();
    await input.fill('15');await expect(input).not.toHaveAttribute('aria-invalid','true');await expect(input).toHaveAccessibleDescription(/仅影响鼠标侧键/);
    await expect(page.getByRole('combobox',{name:'起播方式',exact:true})).toHaveAccessibleDescription(/自动保存/);
    await expect(page.locator('.ui-field-hint').first()).toHaveCSS('font-size','12px');
    expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
    await input.scrollIntoViewIfNeeded();await page.screenshot({path:`build/form-hints-${theme}-390.png`});
  });
  test(`${theme}: task row actions use compact sizes without losing keyboard details`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    await page.route('**/api/thumbnails/failed?**',route=>route.fulfill({json:{items:[{media_id:1,title:'任务说明与行内操作验收',last_error:'测试详情，不影响视频播放',frame_time:10}],total:1,page:1,pages:1}}));
    await page.goto('/');await page.getByRole('button',{name:'封面任务',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'后台封面任务',exact:true});
    await expect(dialog).toHaveAccessibleDescription(/关闭此面板后仍会运行/);
    await expect(dialog.getByRole('button',{name:'重试此封面',exact:true})).toHaveCSS('height','28px');
    await expect(dialog.getByRole('button',{name:'暂停封面任务',exact:true})).toHaveCSS('height','32px');
    await dialog.locator('summary').focus();await page.keyboard.press('Enter');await expect(dialog.locator('pre')).toContainText('测试详情');
  });
}
