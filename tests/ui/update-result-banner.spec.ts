import {test,expect} from '@playwright/test';
for(const theme of ['dark','light'])test(`${theme}: update outcomes are prominent, readable and stay inside About`,async({page,request})=>{
  await request.post('/test/reset');await page.goto('/');
  if(theme==='light')await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  await page.setViewportSize({width:390,height:820});
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await page.getByRole('tab',{name:'帮助',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();
  let reply:any={status:'available',version:'0.2.99',tag:'v0.2.99'};let failed=false;
  await page.route('**/api/updates/check',route=>route.fulfill({status:failed?504:200,json:failed?{detail:'网络不可用，请稍后手动重试'}:reply}));
  const banner=page.getByLabel('更新检查结果',{exact:true});
  for(const status of ['available','current','pending','ahead','unpublished','error']) {
    reply={...reply,status};failed=status==='error';
    await page.getByRole('button',{name:'检查更新',exact:true}).click();
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(new RegExp(`is-${status==='error'?'error':status==='available'?'available':status==='current'?'current':'neutral'}`));
    await expect(banner).toHaveAttribute('role',failed?'alert':'status');
    expect(await banner.locator('strong').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(15);
    expect(await banner.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await banner.scrollIntoViewIfNeeded();await page.waitForTimeout(250);
    if(['available','current','error'].includes(status))await page.screenshot({path:`test-results/update-result-${theme}-${status}.png`});
  }
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(banner).toHaveCount(0);
});
