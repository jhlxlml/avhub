// Component harness only; desktop scrolling is verified in real Electron too.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light'])for(const size of [{width:390,height:650},{width:608,height:400},{width:1440,height:850}])test(`${theme} ${size.width}x${size.height}: settings keeps its header and category controls visible`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.setViewportSize(size);await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'媒体库设置',exact:true}),body=dialog.locator('.settings-content'),close=dialog.getByRole('button',{name:'关闭设置',exact:true});
  // Wait for the lazy panel, not its short-lived loading dialog.
  await expect(dialog.locator('.settings-workspace')).toBeVisible();
  const before=await close.boundingBox();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  if(size.width<820){
    const tabs=page.getByRole('tablist',{name:'设置分类',exact:true});await expect(tabs).toHaveCSS('overflow-x','auto');
    await page.getByRole('tab',{name:'播放偏好',exact:true}).focus();await page.keyboard.press('End');
    await expect(page.getByRole('tab',{name:'帮助',exact:true})).toBeFocused();await expect(page.getByRole('tab',{name:'帮助',exact:true})).toBeInViewport();
    await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  }
  const draft=page.getByRole('spinbutton',{name:'鼠标侧键跳播时长',exact:true});await draft.fill('17');
  await body.evaluate(el=>el.scrollTop=el.scrollHeight);await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await expect(close).toBeInViewport();await expect(page.getByRole('heading',{name:'媒体库设置',exact:true})).toBeInViewport();
  const after=await close.boundingBox();expect(Math.abs(before!.y-after!.y)).toBeLessThanOrEqual(1);
  expect(await dialog.evaluate(el=>el.scrollTop)).toBe(0);expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:`build/ui-refinement/settings-scroll-${theme}-${size.width}.png`});
  await page.getByRole('tab',{name:'数据管理',exact:true}).click();await expect(body).toHaveJSProperty('scrollTop',0);
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await expect(body).toHaveJSProperty('scrollTop',0);await expect(draft).toHaveValue('17');
  await close.click();const confirm=page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true});await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(dialog).toBeVisible();await expect(draft).toHaveValue('17');
});

test('focus wrapping reveals the last control and native disclosure summaries remain in the Tab order',async({page})=>{
  await page.setViewportSize({width:760,height:550});await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  const summary=page.locator('.settings-advanced>summary');await summary.focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');
  const prepare=page.getByRole('checkbox',{name:'MKV 无损播放准备',exact:true});await expect(prepare).toBeFocused();await expect(prepare).toBeInViewport();
  const close=page.getByRole('button',{name:'关闭设置',exact:true});await close.focus();await page.keyboard.press('Shift+Tab');
  await expect(prepare).toBeFocused();await expect(prepare).toBeInViewport();
  await page.keyboard.press('Tab');await expect(close).toBeFocused();await expect(close).toBeInViewport();
});
