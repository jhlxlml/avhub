import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.post('/test/reset'); });

test('indexed subdirectories have breadcrumbs, exact/recursive filtering and URL persistence', async ({ page, request }) => {
  await request.post('/test/folder-fixture');
  await page.goto('/?root=50');
  await expect(page.locator('.card')).toHaveCount(5);
  await page.getByRole('button', {name:'浏览子目录',exact:true}).click();
  await expect(page.getByRole('button', {name:'打开子目录 Drama',exact:true})).toContainText('2 个视频');
  await page.getByRole('button', {name:'打开子目录 Drama',exact:true}).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.screenshot({path:'test-results/folder-browser.png'});
  await page.getByRole('checkbox', {name:'包含子目录'}).uncheck();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page).toHaveURL(/recursive=false/);
  await page.reload();
  await expect(page.getByRole('checkbox', {name:'包含子目录'})).not.toBeChecked();
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button', {name:'打开子目录 Season 1',exact:true}).click();
  await expect(page.getByRole('button', {name:'播放 second',exact:true})).toBeVisible();
  await page.getByRole('navigation', {name:'目录路径'}).getByRole('button', {name:'Drama',exact:true}).click();
  await expect(page.getByRole('button', {name:'播放 first',exact:true})).toBeVisible();
  await page.getByRole('button', {name:'返回目录根层'}).click();
  await expect(page.getByRole('button', {name:'播放 root',exact:true})).toBeVisible();
  await page.getByRole('searchbox', {name:'搜索子目录'}).fill('%_');
  await expect(page.locator('.folder-tiles button')).toHaveCount(1);
  await page.getByRole('button', {name:'打开子目录 100%_clips',exact:true}).click();
  await expect(page.getByRole('button', {name:'播放 literal',exact:true})).toBeVisible();
  await page.getByRole('combobox', {name:'按目录筛选'}).selectOption('');
  await expect(page).not.toHaveURL(/folder=|recursive=/);
  await expect(page.locator('.folder-browser')).toHaveCount(0);
  await expect(page.locator('.card')).toHaveCount(48);
});

test('folder lookup failures can retry and a late response cannot overwrite a different directory', async ({ page, request }) => {
  await request.post('/test/folder-fixture');
  let delay = false;
  await page.route('**/api/roots/50/folders?**', async route => {
    const url = new URL(route.request().url());
    if (delay && !url.searchParams.get('folder')) {
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve,600));
      await route.fulfill({response});
    } else await route.continue();
  });
  await page.goto('/?root=50&folder=Drama');
  await expect(page.getByRole('button', {name:'打开子目录 Season 1',exact:true})).toBeVisible();
  delay = true;
  await page.getByRole('button', {name:'返回目录根层'}).click();
  await page.getByRole('button', {name:'浏览子目录',exact:true}).click();
  await page.getByRole('combobox', {name:'按目录筛选'}).selectOption('2');
  await page.getByRole('button', {name:'浏览子目录',exact:true}).click();
  await expect(page.getByText('本层没有已索引的视频子目录')).toBeVisible();
  await expect(page.getByRole('button', {name:'打开子目录 Drama',exact:true})).toHaveCount(0);
  // Finish the intentional delayed interception before replacing its handler;
  // unroute() during an in-flight fulfill can cause "Route already handled".
  await page.unrouteAll({behavior:'wait'});
  await page.getByRole('combobox', {name:'按目录筛选'}).selectOption('50');
  await page.route('**/api/roots/50/folders?**', route => route.fulfill({status:500,contentType:'application/json',body:'{"detail":"测试目录加载失败"}'}));
  await page.getByRole('button', {name:'浏览子目录',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('测试目录加载失败');
  await page.unrouteAll({behavior:'wait'});
  await page.getByRole('button', {name:'重试目录加载'}).click();
  await expect(page.getByRole('button', {name:'打开子目录 Drama',exact:true})).toBeVisible();
});

test('ten thousand actual indexed subdirectories render bounded tiles and can be searched', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror',error => errors.push(error.message));
  await request.post('/test/many-subfolders');
  await page.goto('/?root=60');
  await page.getByRole('button', {name:'浏览子目录',exact:true}).click();
  await expect(page.locator('.folder-tiles button')).toHaveCount(60);
  await expect(page.locator('.folder-pager')).toContainText('10000 个');
  await page.getByRole('button', {name:'下一页子目录'}).click();
  await expect(page.getByRole('button', {name:'打开子目录 folder-00060',exact:true})).toBeVisible();
  await page.getByRole('searchbox', {name:'搜索子目录'}).fill('folder-09999');
  await expect(page.locator('.folder-tiles button')).toHaveCount(1);
  await page.getByRole('button', {name:'打开子目录 folder-09999',exact:true}).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page).toHaveURL(/folder=folder-09999/);
  expect(errors).toEqual([]);
});

test('same-directory queue is folded, paginated, and saves progress before switching', async ({ page, request }) => {
  await request.patch('/api/preferences',{data:{values:{queueScope:'directory'}}});
  await page.goto('/?q=003');
  await page.getByRole('button', {name:'播放 视频 003',exact:true}).click();
  await expect(page.getByRole('button', {name:'展开待播队列'})).toHaveAttribute('aria-expanded','false');
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => !v.paused && v.readyState>=2)).toBeTruthy();
  await page.getByRole('button', {name:'展开待播队列'}).click();
  await expect(page.getByRole('button', {name:'队列播放 视频 003',exact:true})).toHaveAttribute('aria-current','true');
  await page.locator('.playback-queue').screenshot({path:'test-results/playback-queue.png'});
  expect(await page.locator('.playback-queue li').count()).toBeLessThanOrEqual(40);
  const initial = await (await request.get('/api/media/3/siblings')).json();
  for (let current=initial.page; current>1; current--) {
    await page.getByRole('button', {name:'上一页待播视频'}).click();
    await expect(page.locator('.queue-pager')).toContainText(`${current-1} /`);
  }
  await expect(page.getByRole('button', {name:'队列播放 视频 001',exact:true})).toBeVisible();
  await page.locator('video').evaluate((v:HTMLVideoElement) => { v.currentTime=30; });
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(30);
  await page.getByRole('button', {name:'队列播放 视频 001',exact:true}).click();
  await expect(page.locator('.player-top')).toContainText('视频 001');
  await expect.poll(async () => (await (await request.get('/api/media/3')).json()).progress).toBeGreaterThanOrEqual(30);
  await expect(page.getByRole('button', {name:'收起待播队列'})).toBeVisible();
  await page.getByRole('button', {name:'下一页待播视频'}).click();
  await expect(page.locator('.queue-pager')).toContainText('2 /');
  await expect(page.locator('.playback-queue li')).toHaveCount(40);
});

test('queue navigation remains on the current video if progress saving fails', async ({ page, request }) => {
  await request.post('/test/folder-fixture');
  const playlist = await (await request.post('/api/playlists',{data:{name:'待播测试'}})).json();
  for (const id of [1001,1002,1003]) await request.post(`/api/playlists/${playlist.id}/items/${id}`);
  await page.goto('/');
  await page.getByRole('button',{name:'播放列表',exact:true}).click();
  await page.getByRole('button',{name:'从头播放',exact:true}).click();
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => !v.paused && v.readyState>=2)).toBeTruthy();
  await page.getByRole('button',{name:'展开待播队列'}).click();
  await page.getByRole('searchbox',{name:'搜索待播队列'}).fill('first');
  await expect(page.locator('.playback-queue li')).toHaveCount(1);
  await page.route('**/api/media/1001/progress',route => route.fulfill({status:500,contentType:'application/json',body:'{"detail":"测试保存失败"}'}));
  await page.getByRole('button',{name:'队列播放 first',exact:true}).click();
  await expect(page.locator('.player-top')).toContainText('root');
  await expect(page.getByRole('alert')).toContainText('测试保存失败');
  await page.unroute('**/api/media/1001/progress');
  await page.getByRole('button',{name:'队列播放 first',exact:true}).click();
  await expect(page.locator('.player-top')).toContainText('first');
  await expect(page.getByRole('button',{name:'播放上一条',exact:true})).toBeEnabled();
});
