import { test, expect, type Page } from '@playwright/test';
import { toWebVtt } from '../../frontend/src/subtitleTimeline';

test.beforeEach(async ({ request }) => { await request.post('/test/reset'); });
async function ready(page: Page) {
  await expect(page.getByRole('slider', { name: '视频完整进度' })).toBeEnabled();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState >= 2)).toBe(true);
}
async function addDialog(page: Page) {
  await page.goto('/');
  await page.locator('.card').nth(1).hover();
  await page.getByRole('button', { name: '加入播放列表 视频 002', exact: true }).click();
}

test('empty-state action resets all restricting filters but preserves display preferences', async ({ page }) => {
  await page.goto('/?view=favorites&q=not-found&format=wmv&watch=watched&duration=long&pageSize=24&layout=list');
  await page.getByRole('button', { name: '清除全部条件', exact: true }).click();
  await expect(page.locator('.media-list .card')).toHaveCount(24);
  await expect(page.getByRole('combobox', { name: '视频格式' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: '观看状态' })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: '视频时长范围' })).toHaveValue('');
  await expect.poll(() => page.evaluate(() => ['view','q','root','folder','format','watch','duration'].every(key => !new URL(location.href).searchParams.has(key)))).toBe(true);
});

test('new playlist name creates and adds without changing the existing list', async ({ page, request }) => {
  const old = await (await request.post('/api/playlists', { data: { name: 'Existing' } })).json();
  await addDialog(page);
  await expect(page.getByRole('combobox', { name: '选择播放列表' })).toHaveValue(String(old.id));
  await page.getByRole('textbox', { name: '新播放列表名称' }).fill('New list');
  await expect(page.getByRole('combobox', { name: '选择播放列表' })).toHaveValue('');
  await page.getByRole('button', { name: '添加到列表', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const lists = await (await request.get('/api/playlists')).json();
  expect(lists.find((list: any) => list.name === 'New list').count).toBe(1);
  expect(lists.find((list: any) => list.id === old.id).count).toBe(0);
});

test('selecting an existing list clears the new-list choice', async ({ page, request }) => {
  const old = await (await request.post('/api/playlists', { data: { name: 'Existing' } })).json();
  await addDialog(page);
  await page.getByRole('textbox', { name: '新播放列表名称' }).fill('Do not create');
  await page.getByRole('combobox', { name: '选择播放列表' }).selectOption(String(old.id));
  await expect(page.getByRole('textbox', { name: '新播放列表名称' })).toHaveValue('');
  await page.getByRole('button', { name: '添加到列表', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const lists = await (await request.get('/api/playlists')).json();
  expect(lists).toHaveLength(1); expect(lists[0].count).toBe(1);
});

test('duplicate new list shows an error without silently adding to it', async ({ page, request }) => {
  await request.post('/api/playlists', { data: { name: 'Existing' } });
  await addDialog(page);
  await page.getByRole('textbox', { name: '新播放列表名称' }).fill('Existing');
  await page.getByRole('button', { name: '添加到列表', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已有同名播放列表');
  const lists = await (await request.get('/api/playlists')).json();
  expect(lists).toHaveLength(1); expect(lists[0].count).toBe(0);
});

test('favorite and watched changes preserve the editing draft; saving commits it', async ({ page, request }) => {
  await page.goto('/?video=2'); await ready(page);
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  await page.getByText('编辑媒体信息', { exact: true }).click();
  const title = page.getByRole('textbox', { name: '显示标题' });
  await title.fill('Saved draft');
  await page.getByRole('textbox', { name: '标签', exact: true }).fill('One, Two');
  await page.locator('.player-top .favorite-action').click();
  await expect(title).toHaveValue('Saved draft');
  await expect(page.getByRole('textbox', { name: '标签', exact: true })).toHaveValue('One, Two');
  await page.locator('.player-top .media-more').click();
  await page.getByRole('menuitem', { name: '标记为已看', exact: true }).click();
  await expect(title).toHaveValue('Saved draft');
  await page.getByRole('button', { name: '保存信息', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '媒体信息已保存' })).toBeVisible();
  const media = await (await request.get('/api/media/2')).json();
  expect(media.title).toBe('Saved draft'); expect(media.tags).toEqual(['One', 'Two']);
  await page.getByRole('button', { name: '返回媒体库', exact: true }).click();
  await expect(page.locator('video')).toHaveCount(0);
});

test('leaving confirms unsaved metadata and cancellation preserves the player', async ({ page }) => {
  await page.goto('/?video=2'); await ready(page);
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  await page.getByText('编辑媒体信息', { exact: true }).click();
  const title = page.getByRole('textbox', { name: '显示标题' });
  await title.fill('Do not discard');
  await page.getByRole('button', { name: '返回媒体库', exact: true }).click();
  await page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await expect(title).toHaveValue('Do not discard');
  await page.getByRole('button', { name: '返回媒体库', exact: true }).click();
  await page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true}).getByRole('button',{name:'放弃修改',exact:true}).click();
  await expect(page.locator('video')).toHaveCount(0);
});

test('modal enters focus, traps Tab, locks background, closes with Escape and restores focus', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: '媒体库设置', exact: true });
  await trigger.click();
  await expect(page.getByRole('textbox', { name: '目录路径', exact:true })).toBeFocused();
  expect(await page.locator('[inert]').count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
  await page.getByRole('button', { name: '关闭设置' }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('[inert]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  await page.getByRole('button', { name: '播放列表', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '播放列表名称', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '播放列表', exact: true })).toBeFocused();
});

test('busy modal ignores Escape until its write finishes', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/roots', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await pending;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 99, path: 'test', available: true }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '媒体库设置' }).click();
  await page.getByRole('textbox', { name: '目录路径' }).fill('test');
  await page.getByRole('button', { name: '添加目录', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭设置' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  release();
  await expect(page.getByRole('button', { name: '关闭设置' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('subtitle conversion clips overlapping cues, drops expired ones, and preserves WebVTT settings', async () => {
  const raw = 'WEBVTT\n\nNOTE original timeline\n\nexpired\n00:00:01.000 --> 00:00:02.000\nExpired\n\noverlap\n00:00:19.000 --> 00:00:21.000 align:start position:10%\nOverlap\n\nlater\n00:00:20.000 --> 00:00:22.000\nAt twenty\n';
  const output = toWebVtt(raw, '.vtt', .5, 20);
  expect(output).toContain('NOTE original timeline');
  expect(output).not.toContain('Expired');
  expect(output).toContain('00:00:00.000 --> 00:00:01.500 align:start position:10%');
  expect(output).toContain('00:00:00.500 --> 00:00:02.500');
  expect(toWebVtt('1\r\n00:00:20,000 --> 00:00:22,000\r\nSRT\r\n', '.srt', -.5, 20)).toContain('00:00:00.000 --> 00:00:01.500');
});

test('paused stream rebuild shifts subtitle cues and restoring original playback restores their timeline', async ({ page }) => {
  await page.goto('/?video=2'); await ready(page);
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 20; });
  await expect(page.getByRole('slider', { name: '视频完整进度' })).toHaveValue(/20/);
  await page.getByLabel('加载外挂字幕').setInputFiles({ name: 'timeline.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nExpired\n\n2\n00:00:19,000 --> 00:00:21,000\nOverlap\n\n3\n00:00:20,000 --> 00:00:22,000\nAt twenty\n') });
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.textTracks[0]?.cues?.length)).toBe(3);
  await page.locator('.player-controls').hover({force:true});
  await page.getByRole('button', { name: '画质', exact: true }).click();
  const response = page.waitForResponse(r => r.url().endsWith('/api/media/2/playback') && r.request().method() === 'POST');
  await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('480p');
  await page.getByRole('dialog',{name:'启用有损兼容播放？',exact:true}).getByRole('button',{name:'接受并继续',exact:true}).click();
  expect((await (await response).json()).offset).toBe(20);
  await ready(page);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.textTracks[0]?.cues?.length)).toBe(2);
  const cues = await page.locator('video').evaluate((v: HTMLVideoElement) => Array.from(v.textTracks[0].cues || []).map(c => [c.startTime,c.endTime]));
  expect(cues.sort((a,b) => a[1]-b[1])).toEqual([[0,1],[0,2]]);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.textTracks[0]?.activeCues?.length)).toBe(2);
  // Going behind the stream start forces an uncached rebuild even if FFmpeg
  // has already generated the entire small synthetic movie.
  const restart = page.waitForResponse(r => r.url().endsWith('/api/media/2/playback') && r.request().method() === 'POST');
  await page.getByRole('slider', { name: '视频完整进度' }).evaluate((element: HTMLInputElement) => {
    element.value = '10'; element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  expect((await (await restart).json()).offset).toBe(10);
  await ready(page);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => Array.from(v.textTracks[0]?.cues || []).map(c => [c.startTime,c.endTime]))).toEqual([[9,11],[10,12]]);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.locator('.player-controls').hover({force:true});
  await page.getByRole('button', { name: '画质', exact: true }).click();
  const original = page.waitForResponse(r => r.url().endsWith('/api/media/2/playback') && r.request().method() === 'POST');
  await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('auto');
  expect((await (await original).json()).offset).toBe(0);
  await ready(page);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.textTracks[0]?.cues?.length)).toBe(3);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  const restored = await page.locator('video').evaluate((v: HTMLVideoElement) => Array.from(v.textTracks[0].cues || []).map(c => [c.startTime,c.endTime]));
  expect(restored).toEqual([[1,2],[19,21],[20,22]]);
});

test('playing quality switch preserves playing state', async ({ page }) => {
  await page.goto('/?video=2'); await ready(page);
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await page.locator('.player-controls').hover({force:true});
  await page.getByRole('button', { name: '画质', exact: true }).click();
  const response = page.waitForResponse(r => r.url().endsWith('/api/media/2/playback') && r.request().method() === 'POST');
  await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('480p');
  await page.getByRole('dialog',{name:'启用有损兼容播放？',exact:true}).getByRole('button',{name:'接受并继续',exact:true}).click();
  await response; await ready(page);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
});

test('audio switching preserves paused/playing states and default audio can return to original playback', async ({ page, request }) => {
  await request.post('/test/two-audio-fixture');
  await page.goto('/?video=2'); await ready(page);
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 20; });
  await expect(page.getByRole('slider', { name: '视频完整进度' })).toHaveValue(/20/);
  await page.locator('.player-controls').hover({force:true});
  await page.getByRole('button', { name: '音轨', exact: true }).click();
  const changed = page.waitForResponse(r => r.url().endsWith('/api/media/2/playback') && r.request().method() === 'POST');
  await page.getByRole('combobox', { name: '音轨', exact: true }).selectOption('2');
  const response = await (await changed).json();
  // Full lossless remuxes can begin at zero; segment offsets depend on the stream.
  // Validate the actual target below instead of assuming a fixed 10s pre-roll.
  expect(response.offset).toBeGreaterThanOrEqual(0);expect(response.offset).toBeLessThanOrEqual(20);expect(response.start).toBe(20);expect(response.mode).toBe('remux');
  await ready(page);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement,offset:number)=>Math.abs(v.currentTime+offset-20),response.offset)).toBeLessThan(.5);
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await page.locator('.player-controls').hover({force:true});
  await page.getByRole('button', { name: '音轨', exact: true }).click();
  const original = page.waitForResponse(r => r.url().endsWith('/api/media/2/playback') && r.request().method() === 'POST');
  await page.getByRole('combobox', { name: '音轨', exact: true }).selectOption('');
  expect((await (await original).json()).mode).toBe('direct');
  await ready(page);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
});

test('browser mode blocks foreign writes and serves frame protection headers', async ({ request }) => {
  const rejected = await request.put('/api/media/2/favorite', { headers: { Origin: 'https://foreign.example' }, data: { favorite: true } });
  expect(rejected.status()).toBe(403);
  expect((await (await request.get('/api/media/2')).json()).favorite).toBe(0);
  const home = await request.get('/');
  expect(home.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(home.headers()['x-frame-options']).toBe('DENY');
});
