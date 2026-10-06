import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page, request }) => {
  await request.post('/test/reset');
  await request.post('/api/playlists', {data:{name:'提示测试片单'}});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'加入播放列表 视频 001',exact:true})).toBeVisible();
  await page.clock.install();
});

async function add(page:Page) {
  await page.getByRole('button',{name:'加入播放列表 视频 001',exact:true}).click();
  await page.getByRole('combobox',{name:'选择播放列表'}).selectOption({index:1});
  await page.getByRole('button',{name:'添加到列表',exact:true}).click();
  await expect(page.locator('.toast')).toHaveAttribute('role','status');
  await expect(page.locator('.toast')).toHaveText('已将“视频 001”加入播放列表');
}

test('playlist success expires after four seconds despite unrelated rerenders',async ({page}) => {
  await add(page);
  await page.clock.runFor(2500);
  await expect(page.locator('.toast')).toBeVisible();
  await page.getByRole('button',{name:'取消收藏 视频 001',exact:true}).click();
  await expect(page.getByRole('button',{name:'收藏 视频 001',exact:true})).toBeVisible();
  await page.clock.runFor(1800);
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('an identical new success gets a fresh timer and remains manually dismissible',async ({page}) => {
  await add(page);
  await page.clock.runFor(3000);
  await add(page);
  await page.clock.runFor(2000);
  await expect(page.locator('.toast')).toBeVisible();
  await page.clock.runFor(2500);
  await expect(page.locator('.toast')).toHaveCount(0);
  await add(page);
  await page.getByRole('button',{name:'关闭提示',exact:true}).click();
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('an old success timer cannot hide a subsequent persistent error',async ({page}) => {
  await add(page);
  await page.clock.runFor(2000);
  await page.route('**/api/media/1/favorite',route=>route.fulfill({status:500,json:{detail:'收藏保存失败'}}));
  await page.getByRole('button',{name:'取消收藏 视频 001',exact:true}).click();
  await expect(page.locator('.toast')).toHaveText('收藏保存失败');
  await page.clock.runFor(6000);
  await expect(page.locator('.toast')).toHaveText('收藏保存失败');
  await page.getByRole('button',{name:'关闭提示',exact:true}).click();
  await expect(page.locator('.toast')).toHaveCount(0);
});
