import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.post('/test/reset'); });

test('categories, directory, search, favorites compose without reloading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放 视频 001', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__identity = 'same-page'; });
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button', { name: '全部视频', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('combobox', { name: '按目录筛选' }).selectOption('2');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button', { name: '搜索视频', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索视频' }).fill('002');
  await page.getByRole('button', { name: '收藏 视频 002', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消收藏 视频 002', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button', { name: '全部视频', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '搜索视频' })).toHaveValue('002');
  await expect(page.getByRole('combobox', { name: '按目录筛选' })).toHaveValue('2');
  expect(await page.evaluate(() => (window as any).__identity)).toBe('same-page');
});

test('search is tucked into an icon and can collapse without losing the active query', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '搜索视频' })).toHaveCount(0);
  const searchButton = page.getByRole('button', { name: '搜索视频', exact: true });
  const refreshButton = page.getByRole('button', { name: '刷新媒体库', exact: true });
  expect((await searchButton.boundingBox())!.x).toBeLessThan((await refreshButton.boundingBox())!.x);
  await searchButton.click();
  await page.getByRole('textbox', { name: '搜索视频' }).fill('002');
  await page.getByRole('button', { name: '收起搜索', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '搜索视频' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '搜索（已启用）', exact: true })).toBeVisible();
  await expect(page.getByText('共 1 个结果 · 本页 1 个', { exact: true })).toBeVisible();
});

test('resume prompt does not autoplay; pause/back saves progress; favorites update on return', async ({ page, request }) => {
  await page.goto('/?view=continue&root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await expect(page.getByText('继续上次观看？')).toBeVisible();
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.controls)).toBeFalsy();
  await expect(page.getByRole('slider', { name: '视频完整进度' })).toHaveCount(1);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused && !v.getAttribute('src'))).toBeTruthy();
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(12);
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 34; v.pause(); });
  await expect.poll(async () => (await (await request.get('/api/media/1')).json()).progress).toBeGreaterThanOrEqual(34);
  await page.getByRole('button', { name: '★ 已收藏', exact: true }).click();
  await expect(page.getByRole('button', { name: '☆ 收藏', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
  await expect(page.getByRole('button', { name: '继续观看', exact: true })).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('combobox', { name: '按目录筛选' })).toHaveValue('1');
  await expect(page.getByRole('button', { name: '收藏 视频 001', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await expect(page.getByText('上次看到 00:34')).toBeVisible();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  await expect(page.getByRole('button', { name: /旋转视频/ })).toBeEnabled();
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(10);
  const beforeSkip = await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(beforeSkip + 4);
});

test('browser mode does not expose page fullscreen; video fullscreen remains available', async ({ page }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  await expect(page.getByRole('button', { name: '浏览器全屏', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '应用全屏', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  expect(await page.evaluate(() => document.fullscreenElement?.classList.contains('video-wrap'))).toBeTruthy();
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test('video stage supports mouse play/pause, wheel volume and double-click fullscreen', async ({ page }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  const contrast = await page.locator('.player-controls').evaluate(el => ({
    bar: getComputedStyle(el).backgroundColor,
    button: getComputedStyle(el.querySelector('button')!).backgroundColor,
    iconShadow: getComputedStyle(el.querySelector('button svg')!).filter,
  }));
  expect(contrast.bar).toBe('rgba(0, 0, 0, 0)');
  expect(contrast.button).not.toBe('rgba(0, 0, 0, 0)');
  expect(contrast.iconShadow).toContain('drop-shadow');
  const settingsBox = await page.locator('.player-settings').boundingBox();
  const pipBox = await page.getByRole('button', { name: '画中画', exact: true }).boundingBox();
  const fullscreenBox = await page.getByRole('button', { name: '全屏', exact: true }).boundingBox();
  const controlsBox = await page.locator('.player-control-row').boundingBox();
  expect(settingsBox!.x).toBeLessThan(pipBox!.x);
  expect(pipBox!.x).toBeLessThan(fullscreenBox!.x);
  expect(controlsBox!.x + controlsBox!.width - fullscreenBox!.x - fullscreenBox!.width).toBeLessThan(24);
  await video.click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBeTruthy();
  await video.click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  await video.evaluate((v: HTMLVideoElement) => { v.volume = .5; v.muted = false; });
  const box = await video.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Shift');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.volume)).toBeGreaterThan(.5);
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
  expect(await page.evaluate(() => document.fullscreenElement?.classList.contains('video-wrap'))).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect.poll(() => page.locator('.video-wrap').evaluate(el => el.classList.contains('controls-hidden')), { timeout: 2500 }).toBeTruthy();
  expect(await page.locator('.video-wrap').evaluate(el => getComputedStyle(el).cursor)).toBe('none');
  await page.keyboard.press('Escape');
});

test('video rotation button and R shortcut cycle through quarter turns', async ({ page }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  await page.getByRole('button', { name: '旋转视频，当前 0 度' }).click();
  await expect(video).toHaveClass(/video-rotated-quarter/);
  await expect(page.getByRole('button', { name: '旋转视频，当前 90 度' })).toBeVisible();
  const videoFitsStage = () => page.evaluate(() => {
    const stage = document.querySelector('.video-wrap')!.getBoundingClientRect();
    const frame = document.querySelector('video')!.getBoundingClientRect();
    return frame.left >= stage.left - 1 && frame.top >= stage.top - 1 && frame.right <= stage.right + 1 && frame.bottom <= stage.bottom + 1;
  });
  await expect.poll(videoFitsStage).toBeTruthy();
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await expect.poll(videoFitsStage).toBeTruthy();
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await expect(page.locator('video')).toHaveAttribute('style', /rotate\(180deg\)/);
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await expect(page.locator('video')).not.toHaveClass(/video-rotated-quarter/);
  await expect(page.getByRole('button', { name: '旋转视频，当前 0 度' })).toBeVisible();
});

test('discovers sidecar subtitles, converts SRT, adjusts delay, disables and imports local subtitle', async ({ page }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  const subtitleSelect = page.getByRole('combobox', { name: '字幕轨道' });
  await expect(subtitleSelect.locator('option', { hasText: 'source.srt' })).toHaveCount(1);
  await subtitleSelect.selectOption({ label: 'source.srt' });
  await expect(page.locator('track')).toHaveCount(1);
  const trackCues = () => page.locator('track').evaluate(track => {
    track.track.mode = 'showing';
    return Array.from(track.track.cues || []).map(cue => ({ start: cue.startTime, end: cue.endTime, text: cue.text }));
  });
  await expect.poll(trackCues).toEqual([{ start: 2, end: 4, text: '测试字幕：离线正常' }]);
  await page.getByRole('button', { name: '字幕延迟增加 0.1 秒' }).click();
  await expect(page.getByLabel('当前字幕延迟')).toHaveText('+0.1 秒');
  await expect.poll(trackCues).toEqual([{ start: 2.1, end: 4.1, text: '测试字幕：离线正常' }]);
  await subtitleSelect.selectOption('');
  await expect(page.locator('track')).toHaveCount(0);

  const legacyText = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nUTF-16 本地字幕\r\n';
  await page.getByLabel('加载外挂字幕').setInputFiles({ name: 'local.srt', mimeType: 'text/plain', buffer: Buffer.from(legacyText, 'utf16le') });
  await expect(subtitleSelect).toHaveValue('uploaded');
  await expect.poll(trackCues).toEqual([{ start: 1, end: 2, text: 'UTF-16 本地字幕' }]);
  await page.getByRole('button', { name: '字幕延迟减少 0.1 秒' }).click();
  await expect.poll(trackCues).toEqual([{ start: .9, end: 1.9, text: 'UTF-16 本地字幕' }]);
  await page.getByRole('button', { name: '重置字幕延迟' }).click();
  await expect(page.getByLabel('当前字幕延迟')).toHaveText('0.0 秒');

  const gbkSubtitle = Buffer.concat([Buffer.from('1\r\n00:00:03,000 --> 00:00:04,000\r\n'), Buffer.from('47424b20bcf2cce5d7d6c4bb', 'hex'), Buffer.from('\r\n')]);
  await page.getByLabel('加载外挂字幕').setInputFiles({ name: 'gbk.srt', mimeType: 'text/plain', buffer: gbkSubtitle });
  await expect.poll(trackCues).toEqual([{ start: 3, end: 4, text: 'GBK 简体字幕' }]);
});

test('extracts an embedded text subtitle from MKV and plays it as WebVTT', async ({ page }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 003', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '字幕轨道' })).toBeVisible();
  const subtitleSelect = page.getByRole('combobox', { name: '字幕轨道' });
  const embeddedOption = subtitleSelect.locator('option').filter({ hasText: '内嵌 · und · subrip' });
  await expect(embeddedOption).toHaveCount(1);
  await subtitleSelect.selectOption('embedded:2');
  await expect(page.locator('track')).toHaveCount(1);
  const trackCues = () => page.locator('track').evaluate(track => {
    track.track.mode = 'showing';
    return Array.from(track.track.cues || []).map(cue => ({ start: cue.startTime, end: cue.endTime, text: cue.text }));
  });
  await expect.poll(trackCues).toEqual([{ start: 2, end: 4, text: '测试字幕：离线正常' }]);
});

test('subtitle appearance controls update cue styling and persist locally', async ({ page }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '字幕字号' })).toBeVisible();
  await page.getByRole('combobox', { name: '字幕字号' }).selectOption('38');
  await page.getByRole('combobox', { name: '字幕文字颜色' }).selectOption('#ffe38a');
  await page.getByRole('slider', { name: '字幕背景透明度' }).fill('3');
  const cueStyle = () => page.locator('.video-wrap style').evaluate(element => element.textContent || '');
  await expect.poll(cueStyle).toContain('font-size: 38px');
  await expect.poll(cueStyle).toContain('color: #ffe38a');
  await expect.poll(cueStyle).toContain('rgba(0,0,0,0.85)');
  await page.reload();
  await expect(page).toHaveURL(/video=1/);
  await expect(page.locator('.player-top')).toContainText('视频 001');
  await expect(page.getByRole('combobox', { name: '字幕字号' })).toHaveValue('38');
  await expect(page.getByRole('combobox', { name: '字幕文字颜色' })).toHaveValue('#ffe38a');
  await expect(page.getByRole('slider', { name: '字幕背景透明度' })).toHaveValue('3');
});

test('remembers selected sidecar subtitle and delay for each video', async ({ page }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  const subtitleSelect = page.getByRole('combobox', { name: '字幕轨道' });
  await expect(subtitleSelect.locator('option', { hasText: 'source.srt' })).toHaveCount(1);
  await subtitleSelect.selectOption({ label: 'source.srt' });
  await page.getByRole('button', { name: '字幕延迟增加 0.1 秒' }).click();
  await page.getByRole('button', { name: '字幕延迟增加 0.1 秒' }).click();
  await page.getByRole('button', { name: '字幕延迟增加 0.1 秒' }).click();
  await expect(page.getByLabel('当前字幕延迟')).toHaveText('+0.3 秒');
  const savedPreference = await page.evaluate(() => localStorage.getItem('avhub.subtitle.1'));
  expect(JSON.parse(savedPreference || 'null')).toMatchObject({ id: /source\.srt$/, delay: .3 });
  await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await expect(subtitleSelect).toHaveValue(/source\.srt$/);
  await expect(page.getByLabel('当前字幕延迟')).toHaveText('+0.3 秒');
  const trackCues = () => page.locator('track').evaluate(track => {
    track.track.mode = 'showing';
    return Array.from(track.track.cues || []).map(cue => ({ start: cue.startTime, end: cue.endTime, text: cue.text }));
  });
  await expect.poll(trackCues).toEqual([{ start: 2.3, end: 4.3, text: '测试字幕：离线正常' }]);
});

test('episode end offers next episode, preserves current progress and supports autoplay cancellation', async ({ page, request }) => {
  const next = await (await request.get('/api/media/2')).json();
  await page.route('**/api/media/3/next', route => route.fulfill({ json: { next } }));
  await page.goto('/?view=series');
  await page.getByRole('button', { name: '播放 视频 003', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => Boolean(video.src))).toBeTruthy();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > .2)).toBeTruthy();
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('ended')));
  await expect(page.getByText('下一集：视频 002')).toBeVisible();
  await expect(page.getByText(/秒后自动播放/)).toBeVisible();
  await page.getByRole('button', { name: '取消自动播放', exact: true }).click();
  await expect(page.getByText('自动连播已取消')).toBeVisible();
  await expect.poll(async () => (await (await request.get('/api/media/3')).json()).watched).toBeTruthy();
  await page.getByRole('button', { name: '立即播放下一集', exact: true }).click();
  await expect(page.locator('.player-top').getByText('视频 002')).toBeVisible();
});

test('creates a playlist from library cards and plays its queue in both directions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '加入播放列表 视频 001', exact: true }).click();
  await page.getByRole('textbox', { name: '新播放列表名称' }).fill('周末片单');
  await page.getByRole('button', { name: '添加到列表', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已将“视频 001”加入播放列表');
  await page.getByRole('button', { name: '加入播放列表 视频 002', exact: true }).click();
  await page.getByRole('combobox', { name: '选择播放列表' }).selectOption({ label: '周末片单（1）' });
  await page.getByRole('button', { name: '添加到列表', exact: true }).click();

  await page.getByRole('button', { name: '播放列表', exact: true }).click();
  await page.getByRole('button', { name: /周末片单/ }).click();
  await expect(page.getByText('2 个视频')).toBeVisible();
  await page.getByRole('button', { name: '下移 视频 001', exact: true }).click();
  await expect(page.locator('.playlist-item-title').first()).toHaveText('视频 002');
  await page.getByRole('button', { name: '重命名列表', exact: true }).click();
  await page.getByRole('textbox', { name: '重命名播放列表' }).fill('精选片单');
  await page.getByRole('button', { name: '保存列表名称', exact: true }).click();
  await expect(page.getByRole('heading', { name: '精选片单', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '从头播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放上一条', exact: true })).toBeDisabled();
  await expect(page.locator('.player-top').getByText('视频 002')).toBeVisible();
  await page.getByRole('button', { name: '播放下一条', exact: true }).click();
  await expect(page.locator('.player-top').getByText('视频 001')).toBeVisible();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放上一条', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '播放上一条', exact: true }).click();
  await expect(page.locator('.player-top').getByText('视频 002')).toBeVisible();
  await page.locator('.player-top').getByRole('button', { name: /返回媒体库/ }).click();
  await page.getByRole('button', { name: '播放列表', exact: true }).click();
  await page.getByRole('button', { name: /精选片单/ }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除列表', exact: true }).click();
  await expect(page.getByText('还没有播放列表')).toBeVisible();
});

test('missing playlist videos remain visible, reorderable and removable', async ({ page, request }) => {
  const created = await (await request.post('/api/playlists', { data: { name: '离线测试片单' } })).json();
  await request.post(`/api/playlists/${created.id}/items/1`);
  await request.post(`/api/playlists/${created.id}/items/2`);
  await request.post('/test/media/1/missing');

  await page.goto('/');
  await page.getByRole('button', { name: '播放列表', exact: true }).click();
  await page.getByRole('button', { name: /离线测试片单/ }).click();
  await expect(page.getByText('2 个视频 · 1 个可播放')).toBeVisible();
  await expect(page.getByRole('button', { name: '不可播放 视频 001（文件离线）' })).toBeDisabled();
  await page.getByRole('button', { name: '下移 视频 001', exact: true }).click();
  await expect(page.locator('.playlist-item-title').first()).toHaveText('视频 002');
  await page.getByRole('button', { name: '从头播放', exact: true }).click();
  await expect(page.locator('.player-top').getByText('视频 002')).toBeVisible();
  await page.locator('.player-top').getByRole('button', { name: /返回媒体库/ }).click();
  await page.getByRole('button', { name: '播放列表', exact: true }).click();
  await page.getByRole('button', { name: /离线测试片单/ }).click();
  await page.getByRole('button', { name: '从播放列表移除 视频 001', exact: true }).click();
  await expect(page.getByText('1 个视频')).toBeVisible();
});

test('duplicate playlist names show a clear conflict message', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '播放列表', exact: true }).click();
  const name = page.getByRole('textbox', { name: '播放列表名称' });
  await name.fill('片单');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByRole('heading', { name: '片单', exact: true })).toBeVisible();
  await name.fill('片单');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('已有同名播放列表');
});

test('a slow playlist response cannot replace the list selected afterward', async ({ page, request }) => {
  const second = await (await request.post('/api/playlists', { data: { name: '快列表' } })).json();
  const first = await (await request.post('/api/playlists', { data: { name: '慢列表' } })).json();
  await request.post(`/api/playlists/${first.id}/items/1`);
  await request.post(`/api/playlists/${second.id}/items/2`);
  let delayedRequestStarted = false;
  await page.route(`**/api/playlists/${first.id}?**`, async route => {
    delayedRequestStarted = true;
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('button', { name: '播放列表', exact: true }).click();
  await expect.poll(() => delayedRequestStarted).toBeTruthy();
  await page.getByRole('button', { name: /快列表/ }).click();
  await expect(page.getByRole('heading', { name: '快列表', exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole('heading', { name: '快列表', exact: true })).toBeVisible();
});

test('playlist catches HTML even when an outdated service labels it as JSON', async ({ page }) => {
  await page.route('**/api/playlists', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '<!doctype html><html><body>AVHub</body></html>',
  }));
  await page.goto('/');
  await page.getByRole('button', { name: '播放列表', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('本地服务与网页版本不匹配，请完全退出并重新启动 AVHub');
  await expect(page.getByRole('alert')).not.toContainText('Unexpected token');
});

test('unknown API paths return JSON 404 rather than the SPA document', async ({ request }) => {
  const response = await request.get('/api/this-route-does-not-exist');
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toContain('application/json');
  await expect(response.json()).resolves.toEqual({ detail: 'API 接口不存在' });
});

test('backup does not download the SPA page as a database file', async ({ page }) => {
  await page.route('**/api/data-jobs/backup', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body>AVHub</body></html>',
  }));
  await page.goto('/');
  await page.getByRole('button', { name: '媒体库设置', exact: true }).click();
  await page.getByRole('tab', { name:'数据管理', exact:true }).click();
  await page.getByRole('button', { name: '下载媒体库备份', exact: true }).click();
  await expect(page.getByText('本地服务与网页版本不匹配，请完全退出并重新启动 AVHub', { exact: true })).toBeVisible();
});

test('backup restore never reports success for an HTML response mislabeled as JSON', async ({ page }) => {
  await page.route('**/api/data-jobs/inspect', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '<!doctype html><html><body>AVHub</body></html>',
  }));
  await page.goto('/');
  await page.getByRole('button', { name: '媒体库设置', exact: true }).click();
  await page.getByRole('tab', { name:'数据管理', exact:true }).click();
  await page.getByLabel('选择备份文件').setInputFiles({ name: 'backup.db', mimeType: 'application/octet-stream', buffer: Buffer.from('fixture') });
  await page.getByRole('button', { name: '校验并预览备份', exact: true }).click();
  await expect(page.getByText('本地服务与网页版本不匹配，请完全退出并重新启动 AVHub', { exact: true })).toBeVisible();
});

test('subtitle does not accept an HTML fallback page as caption data', async ({ page }) => {
  await page.route('**/media/3/subtitle/embedded?*', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body>AVHub</body></html>',
  }));
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 003', exact: true }).click();
  const subtitleSelect = page.getByRole('combobox', { name: '字幕轨道' });
  await expect(subtitleSelect).toBeVisible();
  await subtitleSelect.selectOption('embedded:2');
  await expect(page.getByRole('alert')).toHaveText('本地服务与网页版本不匹配，请完全退出并重新启动 AVHub');
});

test('history view lists played videos and clearing an entry keeps the source video', async ({ page, request }) => {
  await page.goto('/?view=history');
  await expect(page.getByRole('button', { name: '播放 视频 001', exact: true })).toBeVisible();
  await expect(page.getByText(/看到 00:12/)).toBeVisible();
  await page.getByRole('button', { name: '清除观看历史 视频 001', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂无观看历史', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部视频', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 视频 001', exact: true })).toBeVisible();
  await expect(page.locator('.card').filter({ has: page.getByRole('button', { name: '播放 视频 001', exact: true }) }).locator('.progress')).toHaveCount(0);
});

test('advanced format, watch-state and duration filters compose and survive reload', async ({ page }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '更多筛选' }).click();
  await page.getByRole('combobox', { name: '视频格式' }).selectOption('mkv');
  await page.getByRole('combobox', { name: '观看状态' }).selectOption('unwatched');
  await page.getByRole('combobox', { name: '视频时长范围' }).selectOption('short');
  await expect(page.getByText('共 2 个结果 · 本页 2 个', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 视频 003', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 视频 004', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('format')).toBe('mkv');
  expect(new URL(page.url()).searchParams.get('watch')).toBe('unwatched');
  expect(new URL(page.url()).searchParams.get('duration')).toBe('short');
  await page.reload();
  await expect(page.getByRole('combobox', { name: '视频格式' })).toHaveValue('mkv');
  await expect(page.getByRole('combobox', { name: '观看状态' })).toHaveValue('unwatched');
  await expect(page.getByRole('combobox', { name: '视频时长范围' })).toHaveValue('short');
  await page.getByRole('combobox', { name: '观看状态' }).selectOption('watched');
  await expect(page.getByRole('heading', { name: '暂无匹配的视频', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.getByText('共 346 个结果 · 本页 48 个', { exact: true })).toBeVisible();
});

test('media editor persists title, series classification, rating and tags', async ({ page, request }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await page.getByText('编辑媒体信息', { exact: true }).click();
  await page.getByRole('textbox', { name: '显示标题' }).fill('手动整理的剧集');
  await page.getByRole('combobox', { name: '媒体类型' }).selectOption('episode');
  await page.getByRole('spinbutton', { name: '季数' }).fill('2');
  await page.getByRole('spinbutton', { name: '集数' }).fill('7');
  await page.getByRole('combobox', { name: '评分' }).selectOption('4');
  await page.getByRole('textbox', { name: '标签' }).fill('精选, 科幻，精选');
  await page.getByRole('button', { name: '保存信息' }).click();
  await expect(page.getByRole('status').filter({ hasText: '媒体信息已保存' })).toBeVisible();
  const saved = await (await request.get('/api/media/1')).json();
  expect(saved.title).toBe('手动整理的剧集');
  expect(saved.kind).toBe('episode');
  expect(saved.season).toBe(2);
  expect(saved.episode).toBe(7);
  expect(saved.rating).toBe(4);
  expect(saved.tags).toEqual(['精选', '科幻']);
  await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
  await expect(page.getByRole('button', { name: '播放 手动整理的剧集', exact: true })).toBeVisible();
});

test('quality selection starts an HLS stream at the requested preset', async ({ page, request }) => {
  const playbackRequests: Array<{ prefer_original?: boolean; force_transcode?: boolean }> = [];
  await page.route('**/api/media/1/playback', async route => {
    playbackRequests.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  await page.getByRole('button', { name: '倍速', exact: true }).click();
  await page.getByRole('combobox', { name: '倍速' }).selectOption('1.5');
  await expect(page.getByRole('button', { name: '倍速', exact: true })).toHaveAttribute('title', '倍速：1.5×');
  await page.getByRole('button', { name: '画质', exact: true }).click();
  await page.getByRole('combobox', { name: '画质' }).selectOption('720p');
  await expect(page.getByRole('button', { name: '画质', exact: true })).toHaveAttribute('title', '画质：720p');
  await expect.poll(async () => (await (await request.get('/test/sessions')).json()).count).toBe(1);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  expect(playbackRequests.at(-1)?.force_transcode).toBeTruthy();
  await page.getByRole('button', { name: '画质', exact: true }).click();
  await page.getByRole('combobox', { name: '画质' }).selectOption('auto');
  await expect.poll(() => playbackRequests.length).toBeGreaterThanOrEqual(3);
  expect(playbackRequests.at(-1)?.prefer_original).toBeTruthy();
  expect(playbackRequests.at(-1)?.force_transcode).toBeFalsy();
  await expect(page.getByRole('button', { name: '画质', exact: true }))
    .toHaveAttribute('title', '播放：原片优先 · 原文件直放');
});

test('random seeks in already-published MKV and TS HLS segments reuse the active playback task', async ({ page }) => {
  const starts = new Map<number, number>();
  await page.route('**/api/media/*/playback', async route => {
    const id = Number(new URL(route.request().url()).pathname.split('/')[3]);
    starts.set(id, (starts.get(id) || 0) + 1);
    const body = route.request().postDataJSON();
    if (body.prefer_original) {
      body.prefer_original = false;
      await route.continue({ postData: JSON.stringify(body) });
    } else await route.continue();
  });

  for (const id of [3, 5]) {
    const name = `视频 ${String(id).padStart(3, '0')}`;
    await page.goto(`/?q=${String(id).padStart(3, '0')}`);
    await page.getByRole('button', { name: `播放 ${name}`, exact: true }).click();
    const restart = page.getByRole('button', { name: '从头开始', exact: true });
    if (await restart.isVisible()) await restart.click();
    await expect(page.getByRole('button', { name: '画质', exact: true }))
      .toHaveAttribute('title', /无损重封装/, { timeout: 20000 });
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBeTruthy();
    await page.locator('.playback-diagnostics summary').click();
    // Let FFmpeg publish later segments, then simulate a browser that only exposes its short buffered range.
    await page.waitForTimeout(1000);
    await page.locator('video').evaluate((video: HTMLVideoElement) => {
      Object.defineProperty(video, 'seekable', {
        configurable: true,
        value: { length: 1, start: () => 0, end: () => 5 },
      });
    });
    const countBeforeSeek = starts.get(id);
    const slider = page.getByRole('slider', { name: '视频完整进度' });
    await slider.evaluate((element: HTMLInputElement) => {
      element.value = '70';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime), { timeout: 15000 })
      .toBeGreaterThan(65);
    await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (?:ms|秒)/, { timeout: 15000 });
    expect(starts.get(id)).toBe(countBeforeSeek);
    await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
    // Returning uses async history.go; wait for it before starting the next
    // document navigation, otherwise that pending traversal can abort goto.
    await expect(page).toHaveURL(url => url.searchParams.get('q') === String(id).padStart(3, '0') && !url.searchParams.has('video'));
    await expect(page.locator('video')).toHaveCount(0);
  }
});

test('playback speed preference carries across videos in the local library', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  await page.getByRole('button', { name: '倍速', exact: true }).click();
  await page.getByRole('combobox', { name: '倍速' }).selectOption('1.5');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
  await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
  await page.getByRole('button', { name: '播放 视频 002', exact: true }).click();
  const restart = page.getByRole('button', { name: '从头开始', exact: true });
  if (await restart.isVisible()) await restart.click();
  else await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  await expect(page.getByRole('button', { name: '倍速', exact: true })).toHaveAttribute('title', '倍速：1.5×');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
});

test('failed original is not tried twice and falls back to lossless video remux first', async ({ page }) => {
  const requests: Array<{ prefer_original?: boolean; force_transcode?: boolean; skip_direct?: boolean }> = [];
  await page.route('**/api/media/1/playback', async route => {
    requests.push(route.request().postDataJSON());
    await route.continue();
  });
  let fileRequests = 0;
  await page.route('**/media/1/file', async route => {
    fileRequests += 1;
    if (fileRequests === 1) await route.fulfill({ status: 404, body: 'simulate browser decode failure' });
    else await route.continue();
  });
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
  expect(requests[0].prefer_original).toBeTruthy();
  expect(requests[1].prefer_original).toBeFalsy();
  expect(requests[1].force_transcode).toBeFalsy();
  expect(requests[1].skip_direct).toBeTruthy();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0)).toBeTruthy();
  await expect(page.getByRole('button', { name: '画质', exact: true }))
    .toHaveAttribute('title', '播放：原片优先 · 视频无损重封装');
  expect(fileRequests).toBe(1);
  expect(requests).toHaveLength(2);
});

test('native MKV seeks to presented frames, including paused seeks, and replay stays original', async ({ page, request }) => {
  const starts: Array<{ prefer_original?: boolean }> = [];
  await page.route('**/api/media/3/playback', async route => {
    starts.push(route.request().postDataJSON());
    await route.continue();
  });
  const head = await request.head('/media/3/file');
  expect(head.status()).toBe(200);
  expect(head.headers()['accept-ranges']).toBe('bytes');
  expect(head.headers()['content-type']).toBe('video/x-matroska');
  await page.goto('/?q=003');
  await page.getByRole('button', { name: '播放 视频 003', exact: true }).click();
  await expect(page.getByRole('button', { name: '画质', exact: true })).toHaveAttribute('title', /原文件直放/);
  await page.locator('.playback-diagnostics summary').click();
  await expect(page.getByLabel('起播耗时')).toHaveText(/[\d.]+ (?:ms|秒)/);
  await expect(page.getByLabel('实际解码分辨率')).toHaveText('320×180');
  for (const [target, paused] of [[80, false], [15, true], [95, true]] as const) {
    if (paused) await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
    await page.getByRole('slider', { name: '视频完整进度' }).evaluate((element: HTMLInputElement, time) => {
      element.value = String(time);
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, target);
    await expect(page.getByLabel('跳播耗时')).toHaveText(/原片按需读取 · [\d.]+ (?:ms|秒)/);
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThanOrEqual(target - .1);
    expect(starts).toHaveLength(1);
    expect((await (await request.get('/test/sessions')).json()).count).toBe(0);
    if (paused) expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBeTruthy();
  }
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('ended')));
  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  await expect.poll(() => starts.length).toBe(2);
  expect(starts[1].prefer_original).toBeTruthy();
  await expect(page.getByRole('button', { name: '画质', exact: true })).toHaveAttribute('title', /原文件直放/);
  await expect(page.getByLabel('起播耗时')).toHaveText(/[\d.]+ (?:ms|秒)/);
  expect((await (await request.get('/test/sessions')).json()).count).toBe(0);
});

test('TS fallback seeks before the current stream offset without retrying the failed original', async ({ page, request }) => {
  await request.put('/api/media/5/progress', { data: { progress: 60, watched: false, updated_at: 1 } });
  const starts: Array<{ start: number; skip_direct?: boolean; force_transcode?: boolean }> = [];
  let originalRequests = 0;
  await page.route('**/media/5/file', async route => {
    originalRequests++;
    await route.fulfill({ status: 404, body: 'force original fallback' });
  });
  await page.route('**/api/media/5/playback', async route => {
    starts.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto('/?q=005');
  await page.getByRole('button', { name: '播放 视频 005', exact: true }).click();
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 0)).toBeTruthy();
  await page.locator('.playback-diagnostics summary').click();
  await page.getByRole('slider', { name: '视频完整进度' }).evaluate((element: HTMLInputElement) => {
    element.value = '10';
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await expect(page.getByLabel('跳播耗时')).toHaveText(/重新准备播放流 · [\d.]+ (?:ms|秒)/, { timeout: 20000 });
  expect(starts).toHaveLength(3);
  expect(starts[2].start).toBe(10);
  expect(starts[2].skip_direct).toBeTruthy();
  expect(starts[2].force_transcode).toBeFalsy();
  expect(originalRequests).toBe(1);
  await expect.poll(async () => (await (await request.get('/test/sessions')).json()).count).toBe(1);
  await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
  await expect.poll(async () => (await (await request.get('/test/sessions')).json())).toEqual({ count: 0, folders: 0 });
});

test('wheel zoom anchors to the pointer and the control-bar button restores the picture', async ({ page }) => {
  await page.goto('/?root=1');
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).click();
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  const wrap = page.locator('.video-wrap');
  const box = (await wrap.boundingBox())!;
  const point = { x: Math.round(box.x + box.width * .27), y: Math.round(box.y + box.height * .38) };
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => page.locator('.video-canvas').evaluate((canvas: HTMLElement) => new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a)).toBeGreaterThan(1);
  const zoomed = await page.locator('.video-canvas').evaluate((canvas: HTMLElement, pointer) => {
    const box = canvas.parentElement!.getBoundingClientRect();
    const x = pointer.x - box.left - canvas.parentElement!.clientLeft;
    const y = pointer.y - box.top - canvas.parentElement!.clientTop;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(canvas).transform);
    const anchor = new DOMPoint(x, y).matrixTransform(matrix);
    return { scale: matrix.a, anchorX: anchor.x, anchorY: anchor.y, x, y };
  }, point);
  expect(zoomed.scale).toBeGreaterThan(1);
  expect(zoomed.anchorX).toBeCloseTo(zoomed.x, 1);
  expect(zoomed.anchorY).toBeCloseTo(zoomed.y, 1);
  const panBefore = await page.locator('.video-canvas').evaluate((canvas: HTMLElement) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(canvas).transform);
    return { x: matrix.e, y: matrix.f };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 60, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.locator('.video-canvas').evaluate((canvas: HTMLElement) => canvas.classList.contains('is-dragging'))).toBeFalsy();
  const panAfter = await page.locator('.video-canvas').evaluate((canvas: HTMLElement) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(canvas).transform);
    return { x: matrix.e, y: matrix.f };
  });
  expect(panAfter.x).not.toBe(panBefore.x);
  expect(panAfter.y).not.toBe(panBefore.y);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBeTruthy();
  const restore = page.getByRole('button', { name: '还原画面缩放' });
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(restore).toBeDisabled();
  await expect.poll(() => page.locator('.video-canvas').evaluate((canvas: HTMLElement) => getComputedStyle(canvas).transform))
    .toBe('matrix(1, 0, 0, 1, 0, 0)');
});

test('return preserves library scroll', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(48);
  await page.evaluate(() => window.scrollTo(0, 900));
  const y = await page.evaluate(() => window.scrollY);
  // Choose a playable entry without causing the browser to scroll before clicking.
  await page.getByRole('button', { name: '播放 视频 001', exact: true }).evaluate((b: HTMLButtonElement) => b.click());
  await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
});

test('direct playback failure falls back to HLS and exit cleans session cache', async ({ page, request }) => {
  await page.route('**/media/2/file', route => route.fulfill({ status: 404, body: 'forced direct failure' }));
  await page.goto('/?root=2');
  await page.getByRole('button', { name: '播放 视频 002', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/test/sessions')).json()).count).toBe(1);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0), { timeout: 20000 }).toBeTruthy();
  await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
  await expect.poll(async () => (await (await request.get('/test/sessions')).json())).toEqual({ count: 0, folders: 0 });
});

test('failed transcode is visible and released, retry creates only one task', async ({ page, request }) => {
  await page.goto('/?q=004');
  await page.getByRole('button', { name: '播放 视频 004', exact: true }).click();
  await expect(page.getByText('暂时无法播放')).toBeVisible();
  await expect.poll(async () => (await (await request.get('/test/sessions')).json()).count).toBe(0);
  await page.getByRole('button', { name: '重试播放', exact: true }).click();
  await expect(page.getByText('暂时无法播放')).toBeVisible();
  await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
  await expect.poll(async () => (await (await request.get('/test/sessions')).json())).toEqual({ count: 0, folders: 0 });
});

test('transcoded resume starts at saved position; closing tab saves and stops task', async ({ page, request }) => {
  await request.put('/api/media/3/progress', { data: { progress: 45, watched: false, updated_at: 1 } });
  await page.goto('/?view=series');
  await page.getByRole('button', { name: '播放 视频 003', exact: true }).click();
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > .2)).toBeTruthy();
  await page.close();
  await expect.poll(async () => (await (await request.get('/api/media/3')).json()).progress).toBeGreaterThan(45);
  await expect.poll(async () => (await (await request.get('/test/sessions')).json())).toEqual({ count: 0, folders: 0 });
});

test('leaving during delayed session creation does not leak the new task', async ({ page, request }) => {
  let created = false;
  await page.route('**/api/media/3/playback', async route => {
    const response = await route.fetch();
    created = true;
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({ response });
  });
  await page.goto('/?view=series');
  await page.getByRole('button', { name: '播放 视频 003', exact: true }).click();
  await expect.poll(() => created).toBeTruthy();
  await page.getByRole('button', { name: '返回媒体库', exact: false }).click();
  await expect.poll(async () => (await (await request.get('/test/sessions')).json())).toEqual({ count: 0, folders: 0 });
});

test('older search response cannot replace newly selected category', async ({ page }) => {
  await page.route('**/api/media?**', async route => {
    const response = await route.fetch();
    if (new URL(route.request().url()).searchParams.get('q') === '001') await new Promise(resolve => setTimeout(resolve, 1000));
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button', { name: '搜索视频', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索视频' }).fill('001');
  await page.waitForTimeout(300);
  await page.getByRole('textbox', { name: '搜索视频' }).fill('003');
  await page.getByRole('button', { name: '剧集', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 视频 003', exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '播放 视频 003', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/library-stable.png', fullPage: true });
});
