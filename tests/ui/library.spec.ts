import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.post('/test/reset'); });

test('347 videos: true count, last page, sorting, sizes and filter resets', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('共 347 个结果 · 本页 48 个', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '末页', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(11);
  await expect(page.getByRole('button', { name: '播放 视频 347', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: '排序方式' }).selectOption('name');
  await expect(page.getByText('共 347 个视频 · 第 1 / 8 页', { exact: true })).toBeVisible();
  await expect(page.locator('.video-title').first()).toHaveText('视频 001');
  await page.getByRole('combobox', { name: '每页数量' }).selectOption('96');
  await expect(page.locator('.card')).toHaveCount(96);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.video-title').first()).toHaveText('视频 097');
  await page.reload();
  await expect(page.locator('.video-title').first()).toHaveText('视频 097');
  await page.getByRole('combobox', { name: '按目录筛选' }).selectOption('2');
  await expect(page.getByText('共 1 个结果 · 本页 1 个', { exact: true })).toBeVisible();
  await expect(page.getByText('共 1 个视频 · 第 1 / 1 页', { exact: true })).toBeVisible();
});

test('removing final favorite on last page clamps to the previous page', async ({ page, request }) => {
  for (let i=2;i<=25;i++) await request.put(`/api/media/${i}/favorite`, { data: { favorite: true } });
  await page.goto('/?view=favorites&page=2&pageSize=24&sort=name');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button', { name: '取消收藏 视频 025', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(24);
  await expect(page.getByText('共 24 个视频 · 第 1 / 1 页', { exact: true })).toBeVisible();
});

test('ten thousand registered directories use bounded options, search and settings pages', async ({ page, request }) => {
  await request.post('/test/many-roots');
  await page.goto('/');
  await expect(page.getByRole('searchbox', { name:'查找媒体目录' })).toBeVisible();
  expect(await page.getByRole('combobox', { name:'按目录筛选' }).locator('option').count()).toBeLessThanOrEqual(52);
  await page.getByRole('searchbox', { name:'查找媒体目录' }).fill('folder-09999');
  await expect(page.getByRole('combobox', { name:'按目录筛选' }).locator('option')).toHaveCount(2);
  await page.getByRole('combobox', { name:'按目录筛选' }).selectOption('10999');
  await expect(page).toHaveURL(/root=10999/);
  await page.getByRole('button', { name:'媒体库设置', exact:true }).click();
  await expect(page.locator('.root-list > div')).toHaveCount(20);
  await page.getByRole('searchbox', { name:'搜索已添加目录' }).fill('folder-09999');
  await expect(page.locator('.root-list > div')).toHaveCount(1);
  await expect(page.getByRole('button', { name:'重新定位', exact:true })).toBeVisible();
});

test('single-directory background scan persists on refresh and indexes video', async ({ page, request }) => {
  const {path} = await (await request.get('/test/scan-source')).json();
  await request.post('/api/roots', { data: { path } });
  await request.post('/test/scan-delay?seconds=2');
  await page.goto('/');
  await page.getByRole('button', { name: '媒体库设置', exact: true }).click();
  const row = page.locator('.root-list > div').filter({ hasText: path });
  await row.getByRole('button', { name: '扫描此目录' }).click();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: '扫描任务' })).toBeVisible();
  await expect(page.getByText('扫描完成', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '搜索视频', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索视频' }).fill('New title');
  await expect(page.getByRole('button', { name: '播放 New title', exact: true })).toBeVisible();
  await expect(page.locator('.thumbnail').first()).toHaveAttribute('loading', 'lazy');
  await expect(page.locator('.thumbnail').first()).toHaveAttribute('decoding', 'async');
  const result = await (await request.get('/api/scan')).json();
  expect(result.updated).toBe(1);
  expect(result.error_count).toBe(0);
  expect(result.root_id).not.toBeNull();
});

test('interrupted scan offers resume and completes the saved directory scan', async ({ page, request }) => {
  const {path} = await (await request.get('/test/scan-source')).json();
  const root = await (await request.post('/api/roots', { data: { path } })).json();
  await request.post(`/test/restore-interrupted-scan?root_id=${root.id}`);
  await page.goto('/');
  const recovery = page.getByRole('button', { name: '继续上次扫描', exact: true });
  await expect(recovery).toBeVisible();
  await expect(page.getByRole('region', { name: '扫描任务' })).toHaveCount(0);
  expect(await recovery.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(44);
  await recovery.click();
  await expect(page.getByText('扫描完成', { exact: true })).toBeVisible({ timeout: 15000 });
  const result = await (await request.get('/api/scan')).json();
  expect(result.root_id).toBe(root.id);
  expect(result.updated).toBe(1);
  expect((await (await request.get(`/api/media?page=1&root_id=${root.id}`)).json()).total).toBe(1);
});

test('cancel background scan and report inaccessible root without losing its index', async ({ page, request }) => {
  const {path} = await (await request.get('/test/scan-source')).json();
  const root = await (await request.post('/api/roots', { data: { path } })).json();
  await request.post('/test/scan-delay?seconds=3');
  const started = await request.post(`/api/scan?root_id=${root.id}`);
  expect(started.status()).toBe(202);
  expect((await request.post(`/api/scan?root_id=${root.id}`)).status()).toBe(409);
  await page.goto('/');
  await page.getByRole('button', { name: '取消扫描', exact: true }).click();
  await expect(page.getByText('扫描已取消', { exact: true })).toBeVisible({ timeout: 15000 });
  await request.post('/api/scan?root_id=1');
  await expect.poll(async () => (await (await request.get('/api/scan')).json()).error_count).toBe(1);
  const result = await (await request.get('/api/media?page=1&root_id=1')).json();
  expect(result.total).toBe(346);
  await page.screenshot({ path: 'test-results/library-paged.png' });
});
