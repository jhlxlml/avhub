import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function noOverflow(page:Page) {
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
}
async function iconsAreConsistent(page:Page) {
  const icons=page.locator('svg.ui-icon:visible');
  expect(await icons.count()).toBeGreaterThan(4);
  expect(await icons.evaluateAll(elements=>elements.every(e=>e.getAttribute('viewBox')==='0 0 24 24' && e.getAttribute('stroke-width')==='1.7' && e.getAttribute('aria-hidden')==='true'))).toBeTruthy();
}

test('library, settings, playlist and player share icons and surface tokens',async({page,request})=>{
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  await iconsAreConsistent(page);await noOverflow(page);
  await expect(page.getByRole('button',{name:'全部视频',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:'test-results/design-library.png'});
  await page.getByRole('button',{name:'媒体库设置'}).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color','rgb(18, 25, 35)');
  await page.screenshot({path:'test-results/design-settings.png'});await iconsAreConsistent(page);
  await page.getByRole('button',{name:'关闭设置'}).click();
  const list=await(await request.post('/api/playlists',{data:{name:'周末待看'}})).json();
  for(const id of [1,2,3])await request.post(`/api/playlists/${list.id}/items/${id}`);
  await page.getByRole('button',{name:'播放列表',exact:true}).click();
  await expect(page.locator('.playlist-detail ol>li')).toHaveCount(3);
  await expect(page.getByRole('dialog')).toHaveCSS('background-color','rgb(18, 25, 35)');
  await page.screenshot({path:'test-results/design-playlists.png'});await iconsAreConsistent(page);
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('button',{name:'播放 视频 001',exact:true}).click();
  await page.getByRole('button',{name:'从头开始',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await expect(page.locator('.player-controls')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.locator('.player-controls')).toHaveCSS('background-image','none');
  await expect(page.locator('.player-controls')).toHaveCSS('border-top-width','0px');
  await expect(page.locator('.player-info')).toHaveCSS('background-color','rgb(18, 25, 35)');
  await iconsAreConsistent(page);await noOverflow(page);
  await page.screenshot({path:'test-results/design-player.png'});
  await page.getByRole('button',{name:'展开待播队列'}).click();
  await page.getByText('编辑媒体信息',{exact:true}).click();
  await page.locator('.player-info').screenshot({path:'test-results/design-player-details.png'});
});

test('compact layouts keep dialogs, controls, navigation and focus usable',async({page})=>{
  await page.setViewportSize({width:960,height:760});await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(48);await noOverflow(page);
  await page.screenshot({path:'test-results/design-tablet.png'});
  await page.setViewportSize({width:390,height:844});await noOverflow(page);
  await page.getByRole('button',{name:'媒体库设置'}).click();
  await expect.poll(()=>page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
  const rootRows=page.locator('.root-list>div');
  expect(await rootRows.evaluateAll(rows=>rows.every(row=>row.scrollWidth<=row.clientWidth+1))).toBeTruthy();
  await page.screenshot({path:'test-results/design-settings-mobile.png'});
  const dialog=await page.getByRole('dialog').boundingBox();expect(dialog!.x).toBeGreaterThanOrEqual(0);expect(dialog!.x+dialog!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:'关闭设置'}).click();
  const favorite=page.getByRole('button',{name:'收藏 视频 002',exact:true});
  await favorite.focus();await expect(favorite).toBeFocused();
  await page.getByRole('button',{name:'播放 视频 002',exact:true}).click();
  await expect(page.getByRole('button',{name:'全屏',exact:true})).toBeEnabled();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await noOverflow(page);
  await page.screenshot({path:'test-results/design-player-mobile.png'});
});

test('long playlist names and narrow action rows stay inside the dialog',async({page,request})=>{
  const list=await(await request.post('/api/playlists',{data:{name:'WeekendWatchlist_'.repeat(4)}})).json();
  for(const id of [1,2,3])await request.post(`/api/playlists/${list.id}/items/${id}`);
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'播放列表',exact:true}).click();
  await expect(page.locator('.playlist-detail ol>li')).toHaveCount(3);
  const dialog=page.getByRole('dialog');
  await expect.poll(()=>dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
  await page.screenshot({path:'test-results/design-playlists-mobile.png'});
  await page.getByRole('button',{name:'重命名列表',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'重命名播放列表',exact:true})).toBeVisible();
  await expect.poll(()=>dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('button',{name:'更多筛选',exact:true}).click();await noOverflow(page);
  await expect(page.locator('.advanced-filters')).toHaveCSS('background-color','rgb(18, 25, 35)');
  await page.getByRole('button',{name:'更多操作 视频 001',exact:true}).click();
  await expect(page.getByRole('menu')).toHaveCSS('background-color','rgb(18, 25, 35)');
  await iconsAreConsistent(page);await noOverflow(page);
  await page.screenshot({path:'test-results/design-menu-mobile.png'});
});
