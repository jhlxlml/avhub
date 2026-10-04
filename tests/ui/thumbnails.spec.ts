import { test, expect } from '@playwright/test';

test.beforeEach(async({request})=>{
  await request.post('/test/reset');
  await request.post('/test/thumbnail-fixture');
});
test('real covers are visible in grid/list and all-video, movie, continue, favorite and history views',async({page})=>{
  for(const view of ['all','movies','continue','favorites','history']) {
    await page.goto(`/?view=${view}`);
    const cover=page.locator('.card').filter({has:page.getByRole('button',{name:'播放 视频 001',exact:true})});
    await expect(cover.locator('img.thumbnail-ready')).toBeVisible();
    expect(await cover.locator('img').evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBeTruthy();
    await expect(cover.locator('.cover-placeholder')).toHaveCount(0);
    await page.getByRole('button',{name:'列表',exact:true}).click();
    await expect(cover.locator('img')).toBeVisible();
    const size=await cover.locator('img').boundingBox();expect(size!.width).toBeGreaterThan(100);expect(size!.height).toBeGreaterThan(60);
  }
  await page.screenshot({path:'test-results/thumbnail-list.png'});
});

test('failed images get a fallback and regenerated covers retry without reloading the page',async({page,request})=>{
  // Fixture reset can leave a prior generated cache file. Route the failed URL
  // deterministically; a new version must not inherit that failure state.
  await page.route('**/thumbs/2?v=1*',route=>route.fulfill({status:404,json:{detail:'missing cover'}}));
  await page.goto('/');
  const card=page.locator('.card').filter({has:page.getByRole('button',{name:'播放 视频 002',exact:true})});
  await expect(card.getByRole('img',{name:'预览图加载失败'})).toBeVisible();
  await expect(card.locator('img.thumbnail')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'播放 视频 002',exact:true})).toBeEnabled();
  const changed=await request.post('/test/repair-thumbnail-fixture');expect((await changed.json()).ok).toBeTruthy();
  await page.getByRole('button',{name:'电影',exact:true}).click();
  await expect(card.locator('img.thumbnail-ready')).toBeVisible();
  await expect(card.getByRole('img',{name:'预览图加载失败'})).toHaveCount(0);
  expect(await card.locator('img').evaluate((img:HTMLImageElement)=>img.naturalWidth>0)).toBeTruthy();
  await page.getByRole('button',{name:'列表',exact:true}).click();await page.setViewportSize({width:390,height:844});
  await expect(card.locator('img')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'test-results/thumbnail-list-mobile.png'});
});

test('refreshing library data retries only failed images even when their URL did not change',async({page,request})=>{
  await request.post('/test/repair-thumbnail-fixture');
  let attempts=0,goodAttempts=0,available=false;
  await page.route('**/thumbs/1?v=1*',route=>{goodAttempts++;return route.continue();});
  await page.route('**/thumbs/2?v=2*',route=>{attempts++;return !available?route.fulfill({status:503,json:{detail:'temporary error'}}):route.continue();});
  await page.goto('/');
  const card=page.locator('.card').filter({has:page.getByRole('button',{name:'播放 视频 002',exact:true})});
  await expect(card.getByRole('img',{name:'预览图加载失败'})).toBeVisible();
  await expect(page.locator('.card').first().locator('img.thumbnail-ready')).toBeVisible();
  await page.getByRole('button',{name:'更多操作 视频 002',exact:true}).click();
  const before=attempts,goodBefore=goodAttempts;available=true;
  await page.getByRole('menuitem',{name:'标记为已看',exact:true}).click();
  await expect(card.locator('img.thumbnail-ready')).toBeVisible();
  expect(attempts).toBeGreaterThan(before);expect(goodAttempts).toBe(goodBefore);
});
