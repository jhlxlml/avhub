import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.post('/test/reset'); });

test('quit suspends episode countdown and cancellation restores episode navigation', async ({ page, request }) => {
  const next = await (await request.get('/api/media/2')).json();
  await page.route('**/api/media/3/next?**', route => route.fulfill({ json: { next } }));
  await page.goto('/?video=3');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState >= 2)).toBeTruthy();
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 30; });
  await page.clock.install();
  await page.locator('video').evaluate(v => v.dispatchEvent(new Event('ended')));
  await expect(page.getByText('下一集：视频 002')).toBeVisible();
  expect(await page.evaluate(async () => {
    const tasks: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent('avhub-before-quit', { detail: tasks }));
    return (await Promise.all(tasks)).every(value => value !== false);
  })).toBeTruthy();
  await page.clock.runFor(10000);
  await expect(page).toHaveURL(/video=3/);
  await page.getByRole('button', { name: '立即播放下一集', exact: true }).click();
  await expect(page).toHaveURL(/video=3/);
  await page.evaluate(() => window.dispatchEvent(new Event('avhub-quit-cancelled')));
  await page.getByRole('button', { name: '立即播放下一集', exact: true }).click();
  await expect(page).toHaveURL(/video=2/);
});

test('failed quit saves preserve the source and cancelled quit restores keyboard playback', async ({ page }) => {
  await page.goto('/?video=2');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.paused)).toBeTruthy();
  const source = (await page.locator('video').getAttribute('src'))!;
  await page.route('**/api/media/2/progress', route => route.fulfill({ status: 503, json: { detail: 'test shutdown save failure' } }));
  expect(await page.evaluate(async () => {
    const tasks: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent('avhub-before-quit', { detail: tasks }));
    return (await Promise.all(tasks)).every(value => value !== false);
  })).toBeFalsy();
  await page.keyboard.press('k');
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBeTruthy();
  await expect(page.locator('video')).toHaveAttribute('src', source);
  await page.unrouteAll({ behavior: 'wait' });
  await page.evaluate(() => window.dispatchEvent(new Event('avhub-quit-cancelled')));
  await page.locator('.player-info h2').click();
  await page.keyboard.press('k');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  await expect(page.locator('video')).toHaveAttribute('src', source);
});

test('a late next-item save cannot navigate after quit has started', async ({ page, request }) => {
  const list = await (await request.post('/api/playlists', { data: { name: 'shutdown queue' } })).json();
  for (const id of [2, 3]) await request.post(`/api/playlists/${list.id}/items/${id}`);
  await page.goto(`/?video=2&playlist=${list.id}`);
  await expect(page.getByRole('button', { name: '播放下一条', exact: true })).toBeEnabled();
  const stage=await page.locator('.video-wrap').boundingBox();await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-8);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let saves = 0;
  await page.route('**/api/media/2/progress', async route => {
    saves++;
    if (saves <= 2) await gate;
    await route.fulfill({ json: { id: 2, progress: 20, watched: false } });
  });
  await page.getByRole('button', { name: '播放下一条', exact: true }).click();
  await expect.poll(() => saves).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('avhub-before-quit', { detail: [] })));
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page).toHaveURL(/video=2/);
  await expect(page.locator('.player-top')).toContainText('视频 002');
});
