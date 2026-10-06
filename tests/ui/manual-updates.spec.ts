import {test,expect} from '@playwright/test';
test('checks only on click, prevents duplicates and clears results on close',async({page,request})=>{
  await request.post('/test/reset');let checks=0;
  await page.route('**/api/updates/check',async route=>{checks++;await new Promise(resolve=>setTimeout(resolve,250));await route.fulfill({json:{status:'available',version:'0.2.10',tag:'v0.2.10',published_at:'2026-10-06T00:00:00Z',notes:'<img src=x onerror=alert(1)>\n测试更新说明'}});});
  await page.goto('/');expect(checks).toBe(0);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();expect(checks).toBe(0);
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.getByRole('button',{name:'检查中…',exact:true})).toBeDisabled();
  await expect(page.getByText('发现新版本 0.2.10',{exact:true})).toBeVisible();expect(checks).toBe(1);
  await expect(page.getByRole('button',{name:'前往下载',exact:true})).toBeEnabled();
  await page.getByText('更新说明',{exact:true}).click();await expect(page.locator('.manual-update-result details p')).toContainText('<img');await expect(page.locator('.manual-update-result img')).toHaveCount(0);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.getByText('发现新版本 0.2.10',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();expect(checks).toBe(1);
});
test('failure stays inside About; checking can be cancelled by closing and light narrow UI fits',async({page,request})=>{
  await request.post('/test/reset');await page.route('**/api/updates/check',r=>r.fulfill({status:504,json:{detail:'检查更新超时或网络不可用，不影响离线播放'}}));
  await page.goto('/');await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();await page.setViewportSize({width:390,height:820});
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.getByRole('alert')).toContainText('网络不可用');
  expect(await page.locator('.app-version-check').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/manual-update-light.png'});await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
});
