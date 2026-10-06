import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ request }) => { await request.post('/test/reset'); });

test('rapid paused HLS seeks coalesce to the final target and remain paused', async ({ page, request }) => {
  await request.put('/api/media/5/progress', {data:{progress:60,watched:false,updated_at:1}});
  const starts: Array<{start:number;autoplay?:boolean}> = [];
  await page.route('**/media/5/file', route => route.fulfill({status:404,body:'force remux'}));
  // Explicitly exercise the retained legacy windowed fallback/cancellation path.
  await page.route('**/api/media/5/playback', route => { const body={...route.request().postDataJSON(),indexed_ts:false};starts.push(body);return route.continue({postData:JSON.stringify(body)}); });
  await page.goto('/?q=005');
  await page.getByRole('button', {name:'播放 视频 005',exact:true}).click();
  await page.getByRole('button', {name:'继续播放',exact:true}).click();
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => !v.paused && v.currentTime > 0)).toBeTruthy();
  await page.locator('.playback-diagnostics summary').click();
  await page.locator('video').evaluate((v:HTMLVideoElement) => v.pause());
  await page.getByRole('slider', {name:'视频完整进度'}).evaluate((input:HTMLInputElement) => {
    for (const value of [10,15,20]) { input.value=String(value); input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); }
  });
  await expect(page.getByLabel('跳播耗时')).toHaveAttribute('data-target','20');
  await expect(page.getByLabel('跳播耗时')).toHaveText(/重新准备播放流 · [\d.]+ (?:ms|秒)/,{timeout:20000});
  expect(starts).toHaveLength(2);
  expect(starts[1]).toMatchObject({start:20,autoplay:false});
  expect(await page.locator('video').evaluate((v:HTMLVideoElement) => v.paused)).toBeTruthy();
  await expect(page.locator('.seek-frame')).toBeHidden();
  await expect.poll(async () => (await (await request.get('/api/media/5')).json()).progress).toBeGreaterThanOrEqual(20);
  await page.getByRole('button', {name:'返回媒体库',exact:false}).click();
  await expect.poll(async () => (await (await request.get('/test/sessions')).json())).toEqual({count:0,folders:0});
});

test('a new seek during late task creation retires the stale session before creating the final one', async ({ page, request }) => {
  await request.put('/api/media/5/progress', {data:{progress:60,watched:false,updated_at:1}});
  const starts: Array<{start:number}> = [];
  const counts:number[] = [];
  let staleCreated = false;
  await page.route('**/media/5/file', route => route.fulfill({status:404,body:'force remux'}));
  await page.route('**/api/media/5/playback', async route => {
    const body={...route.request().postDataJSON(),indexed_ts:false};starts.push(body);
    const response = await route.fetch({postData:JSON.stringify(body)});
    counts.push((await (await request.get('/test/sessions')).json()).count);
    if (starts.length === 2) { staleCreated=true; await new Promise(resolve => setTimeout(resolve,700)); }
    await route.fulfill({response});
  });
  await page.goto('/?q=005');
  await page.getByRole('button', {name:'播放 视频 005',exact:true}).click();
  await page.getByRole('button', {name:'继续播放',exact:true}).click();
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => !v.paused && v.currentTime>0)).toBeTruthy();
  await page.locator('.playback-diagnostics summary').click();
  const seek = (target:number) => page.getByRole('slider', {name:'视频完整进度'}).evaluate((input:HTMLInputElement, value) => {
    input.value=String(value); input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  }, target);
  await seek(20);
  await expect.poll(() => staleCreated).toBeTruthy();
  await seek(40);
  await expect(page.getByLabel('跳播耗时')).toHaveAttribute('data-target','40');
  await expect(page.getByLabel('跳播耗时')).toHaveText(/重新准备播放流 · [\d.]+ (?:ms|秒)/,{timeout:20000});
  expect(starts).toHaveLength(3);
  expect(starts[2].start).toBe(40);
  expect(Math.max(...counts)).toBeLessThanOrEqual(1);
  await page.getByRole('button', {name:'返回媒体库',exact:false}).click();
  await expect.poll(async () => (await (await request.get('/test/sessions')).json())).toEqual({count:0,folders:0});
});

test('volume and mute persist across videos and PNG screenshots retain decoded dimensions', async ({ page }) => {
  await page.goto('/?q=003');
  await page.getByRole('button', {name:'播放 视频 003',exact:true}).click();
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => !v.paused && v.readyState>=2)).toBeTruthy();
  await page.locator('video').evaluate((v:HTMLVideoElement) => { v.volume=.35; v.muted=true; });
  await page.getByRole('button', {name:/旋转视频/}).click();
  const pendingSave = page.waitForResponse(response=>response.url().includes('/screenshot?')&&response.request().method()==='POST');
  await page.getByRole('button', {name:'保存视频截图',exact:true}).click();
  const response = await pendingSave;
  expect(response.ok()).toBeTruthy();
  const saved=await response.json();
  expect(saved.filename).toMatch(/\.png$/);
  const png = await readFile(saved.path);
  expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([320,180]);
  await page.getByRole('button', {name:'返回媒体库',exact:false}).click();
  // Returning uses history.go asynchronously. Starting a new document navigation
  // before that finishes can race the pending popstate back to the old query.
  await expect(page).toHaveURL(/\?q=003$/);
  await expect(page.locator('video')).toHaveCount(0);
  await page.goto('/?q=002');
  await page.getByRole('button', {name:'播放 视频 002',exact:true}).click();
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => v.volume)).toBe(.35);
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => v.muted)).toBeTruthy();
});
