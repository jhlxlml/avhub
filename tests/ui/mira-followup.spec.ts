// Explicit component harness; desktop and real-source checks are run separately.
import {test,expect} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light'])test(`${theme}: permanent-delete permission is distinguished without changing authorization`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await page.getByRole('button',{name:/^文件权限 /}).first().click();
  const risk=page.locator('.file-permission-fields label[data-risk="destructive"]').first();
  await expect(risk).toContainText('允许永久删除');await expect(risk.locator('input')).not.toBeChecked();
  const color=await risk.evaluate(el=>{const p=document.createElement('span');p.style.color='var(--ui-danger)';el.append(p);const c=getComputedStyle(p).color;p.remove();return c;});
  await expect(risk).toHaveCSS('color',color);
  expect(await page.locator('.file-permission-fields label[data-risk="destructive"]').count()).toBe(2);
  await page.screenshot({path:`build/ui-refinement/${theme}-permission-risk.png`});
});

for(const width of [640,1440])test(`${width}px playback failure card stays readable and retry restores real playback`,async({page})=>{
  await page.setViewportSize({width,height:width===640?360:850});
  let rejected=true;
  await page.route('**/api/media/2/playback',r=>rejected?r.fulfill({status:422,json:{detail:'测试：原画播放暂时失败。原片和观看记录均已保留，可以重试；不会自动降低分辨率、改变颜色或转换音轨。'.repeat(2)}}):r.continue());
  await page.goto('/?video=2');const error=page.locator('.video-wrap>.resume[role="alert"]');await expect(error).toBeVisible();
  const stage=await page.locator('.video-wrap').boundingBox(),box=await error.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(480);expect(box!.x).toBeGreaterThanOrEqual(stage!.x);expect(box!.x+box!.width).toBeLessThanOrEqual(stage!.x+stage!.width+1);
  expect(await error.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await error.screenshot({path:`build/ui-refinement/playback-error-card-${width}.png`});
  rejected=false;await error.getByRole('button',{name:'重试播放',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:30000}).toBe(true);
  await expect(error).toHaveCount(0);
});

test('Mira pagination supports Enter, native disabled states and stable page size changes',async({page})=>{
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  const nav=page.getByRole('navigation',{name:'媒体库分页',exact:true});await expect(nav).toBeVisible();
  await expect(nav.getByRole('button',{name:'首页',exact:true})).toBeDisabled();
  await expect(nav.getByRole('button',{name:'下一页',exact:true})).toHaveAttribute('data-slot','button');
  const input=nav.getByRole('spinbutton',{name:'跳转页码',exact:true});await input.fill('2');await input.press('Enter');
  await expect(page).toHaveURL(/page=2/);await expect(nav.locator('.pagination-position')).toContainText('第 2 /');
  await nav.getByRole('button',{name:'上一页',exact:true}).click();await expect(nav.locator('.pagination-position')).toContainText('第 1 /');
  await nav.getByRole('combobox',{name:'每页数量',exact:true}).selectOption('24');await expect(page.locator('.card')).toHaveCount(24);
  await input.fill('');await expect(nav.getByRole('button',{name:'跳转',exact:true})).toBeDisabled();
});

for(const width of [390,1440])test(`${width}px notifications remain within the window and keep automatic dismissal`,async({page,request})=>{
  await page.setViewportSize({width,height:850});await request.post('/api/playlists',{data:{name:'反馈位置测试'}});
  await page.goto('/');await page.clock.install();
  await page.getByRole('button',{name:'加入播放列表 视频 001',exact:true}).click();
  await page.getByRole('combobox',{name:'选择播放列表'}).selectOption({index:1});await page.getByRole('button',{name:'添加到列表',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'加入播放列表',exact:true})).toHaveCount(0);
  const toast=page.locator('.toast');await expect(toast).toBeVisible();const box=await toast.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);expect(box!.y+box!.height).toBeLessThanOrEqual(850);
  expect(await toast.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.clock.runFor(4500);await expect(toast).toHaveCount(0);
});
