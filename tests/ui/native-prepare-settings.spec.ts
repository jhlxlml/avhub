import {test,expect,type Page} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function settings(page:Page) {
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await page.getByText('高级播放设置',{exact:true}).click();
  return page.getByRole('checkbox',{name:'MKV 无损播放准备',exact:true});
}
async function toggle(page:Page,value:boolean) {
  // This switch reflects the durable server value, not an optimistic checkbox.
  const checkbox=await settings(page);if(await checkbox.isChecked()!==value)await checkbox.click();
  await expect(checkbox).toBeChecked({checked:value});
  await expect(page.getByRole('button',{name:'关闭设置'})).toBeEnabled();
  await page.getByRole('button',{name:'关闭设置'}).click();
}

test('default-off blocks preparation, persists the switch and bypasses existing copies without deleting them',async({page,request})=>{
  await page.goto('/?q=003');
  await page.getByRole('button',{name:'更多操作 视频 003',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'无损播放准备',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  const checkbox=await settings(page);await expect(checkbox).not.toBeChecked();
  expect((await request.post('/api/media/3/native-prepare')).status()).toBe(409);
  expect((await request.get('/media/3/prepared')).status()).toBe(409);
  await page.getByRole('button',{name:'关闭设置'}).click();
  await toggle(page,true);await page.reload();
  expect((await (await request.get('/api/preferences')).json()).values.nativePrepare).toBe(true);
  await page.getByRole('button',{name:'更多操作 视频 003',exact:true}).click();
  await page.getByRole('menuitem',{name:'无损播放准备',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'无损播放准备'});
  await dialog.getByRole('button',{name:'开始无损准备',exact:true}).click();
  await expect(dialog).toContainText('已准备完成');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  const before=await (await request.get('/api/media/3/native-prepare')).json();
  await page.getByRole('button',{name:'播放 视频 003',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.currentSrc.endsWith('/media/3/prepared'))).toBe(true);
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await toggle(page,false);await page.reload();
  const after=await (await request.get('/api/media/3/native-prepare')).json();
  expect(after).toMatchObject({state:'ready',enabled:false,key:before.key,size:before.size});
  expect((await request.post('/api/media/3/native-prepare')).status()).toBe(409);
  await page.getByRole('button',{name:'播放 视频 003',exact:true}).click();
  await expect(page.locator('.video-wrap')).toBeVisible();
  const resume=page.getByRole('button',{name:'从头开始',exact:true});if(await resume.isVisible())await resume.click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.currentSrc.endsWith('/media/3/file'))).toBe(true);
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await toggle(page,true);
  await page.getByRole('button',{name:'更多操作 视频 003',exact:true}).click();
  await page.getByRole('menuitem',{name:'无损播放准备',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'无损播放准备'})).toContainText('已准备完成');
});

test('failed switch save does not expose the preparation menu or pretend it enabled',async({page,request})=>{
  await page.goto('/?q=003');const checkbox=await settings(page);
  await page.route('**/api/preferences',route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{detail:'设置写入失败'}}):route.continue());
  await checkbox.click();await expect(page.getByRole('region',{name:'MKV 无损播放准备设置'}).getByRole('alert')).toContainText('设置写入失败');
  await expect(checkbox).not.toBeChecked();
  expect((await (await request.get('/api/preferences')).json()).values.nativePrepare).not.toBe(true);
  await page.getByRole('button',{name:'关闭设置'}).click();
  await page.getByRole('button',{name:'更多操作 视频 003',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'无损播放准备',exact:true})).toHaveCount(0);
});

test('switch matches light theme and fits narrow settings',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  await page.setViewportSize({width:390,height:760});const checkbox=await settings(page);
  await expect(checkbox).not.toBeChecked();
  const dialog=page.getByRole('dialog');await expect(dialog).toHaveCSS('background-color','rgb(255, 255, 255)');
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await checkbox.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/native-prepare-settings-light.png'});
});
