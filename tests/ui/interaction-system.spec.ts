import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.post('/test/reset'); });
async function revealControls(page:Page) {
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-8);
}
async function player(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '播放 视频 002', exact: true }).click();
  // A previous context's final progress beacon can arrive after fixture reset.
  // Accept the legitimate resume choice before checking control readiness.
  const fromStart=page.getByRole('button',{name:'从头开始',exact:true});
  const fullscreen=page.getByRole('button',{name:'全屏',exact:true});
  await expect.poll(async()=>await fromStart.isVisible() || await fullscreen.isEnabled()).toBeTruthy();
  if(await fromStart.isVisible())await fromStart.click();
  await expect(page.getByRole('button', { name: '全屏', exact: true })).toBeEnabled();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState >= 2)).toBeTruthy();
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
  const stage=await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-8);
}

test('subtitle popover has one set of controls, restores focus and keeps playback intact', async ({ page }) => {
  await player(page);
  const source = await page.locator('video').getAttribute('src');
  const trigger = page.getByRole('button', { name: '字幕', exact: true });
  await trigger.click();
  await expect(page.getByRole('region', { name: '字幕设置弹层' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '字幕轨道' })).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: '字幕轨道' })).toBeFocused();
  await page.getByLabel('加载外挂字幕').setInputFiles({ name: 'popup.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nPopup\n') });
  await page.getByRole('button', { name: '字幕延迟增加 0.1 秒' }).click();
  await expect(page.getByLabel('当前字幕延迟')).toHaveText('+0.1 秒');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: '字幕轨道' })).toHaveValue('uploaded');
  await expect(page.locator('video')).toHaveAttribute('src', source!);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBeTruthy();
});

test('subtitle settings work in pure playback and Escape closes only the popover first', async ({ page }) => {
  await player(page);
  await page.getByRole('button', { name: '纯净播放', exact: true }).click();
  await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);await revealControls(page);
  await page.getByRole('button', { name: '字幕', exact: true }).click();
  await page.getByLabel('加载外挂字幕').setInputFiles({ name: 'popup.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nPopup\n') });
  await expect(page.getByRole('combobox', { name: '字幕轨道' })).toHaveValue('uploaded');
  await page.getByRole('combobox', { name: '字幕字号' }).selectOption('34');
  await page.keyboard.press('Escape');
  await expect(page.locator('.player-shell')).toHaveClass(/is-pure-playback/);
  await expect(page.getByRole('region', { name: '字幕设置弹层' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.player-shell')).not.toHaveClass(/is-pure-playback/);
  await expect(page.getByRole('combobox', { name: '字幕字号' })).toHaveValue('34');
});

test('popover Tab stays local, switching menus and outside dismissal are predictable', async ({ page }) => {
  await player(page);
  await page.getByRole('button', { name: '字幕', exact: true }).click();
  const panel = page.getByRole('region', { name: '字幕设置弹层' });
  await panel.getByRole('slider').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '关闭字幕设置' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(panel.getByRole('slider')).toBeFocused();
  await page.getByRole('button', { name: '倍速', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '倍速', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '倍速', exact: true }).click();
  await expect(page.getByRole('region', { name: '倍速设置' })).toHaveCount(0);
  await page.getByRole('button', { name: '画质', exact: true }).click();
  await page.locator('.player-top>span').click();
  await expect(page.getByRole('region', { name: '画质设置' })).toHaveCount(0);
});

test('subtitle popover stays within video fullscreen and Escape preserves fullscreen', async ({ page }) => {
  await player(page);
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBeTruthy();
  await revealControls(page);
  await page.getByRole('button', { name: '字幕', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '字幕轨道' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '字幕设置弹层' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBeTruthy();
  await expect(page.getByRole('button',{name:'退出视频全屏',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(page.getByRole('button',{name:'全屏',exact:true})).toHaveAttribute('aria-pressed','false');
});

for (const width of [390, 560, 760, 960]) test(`controls and popovers fit a ${width}px window`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await player(page);
  const controls = page.locator('.player-controls');
  expect(await controls.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBeTruthy();
  const pip = await page.getByRole('button', { name: '画中画', exact: true }).boundingBox();
  const full = await page.getByRole('button', { name: '全屏', exact: true }).boundingBox();
  expect(pip!.x).toBeLessThan(full!.x);
  const end = controls.locator('.player-end-actions');
  expect(await end.locator('button').last().getAttribute('aria-label')).toBe('全屏');
  await page.getByRole('button', { name: '更多播放工具' }).click();
  await page.getByRole('button', { name: '旋转视频，当前 0 度' }).click();
  await expect(page.getByRole('button', { name: '旋转视频，当前 90 度' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '字幕', exact: true }).click();
  const popover = page.getByRole('region', { name: '字幕设置弹层' });
  await expect(popover).toHaveCSS('opacity', '1');
  const wrapBox = await page.locator('.video-wrap').boundingBox(), box = await popover.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(wrapBox!.x);
  expect(box!.y).toBeGreaterThanOrEqual(wrapBox!.y);
  expect(box!.x + box!.width).toBeLessThanOrEqual(wrapBox!.x + wrapBox!.width);
  await page.getByRole('combobox', { name: '字幕文字颜色' }).selectOption('#ffe38a');
  expect(await popover.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `test-results/interaction-player-${width}.png` });
});

test('resizing out of compact tools dismisses the menu and permits controls to hide', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 844 });
  await player(page);
  await page.getByRole('button', { name: '更多播放工具' }).click();
  await page.setViewportSize({ width: 1440, height: 850 });
  await expect(page.getByRole('region', { name: '更多播放工具' })).toHaveCount(0);
  await page.locator('video').evaluate((v: HTMLVideoElement) => void v.play());
  await page.mouse.move(0, 0);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
  await page.keyboard.press('KeyK');
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
});

test('compact zoom exposes a single one-click reset outside the tools menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await player(page);
  const stage = await page.locator('.video-wrap').boundingBox();
  await page.mouse.move(stage!.x + stage!.width / 2, stage!.y + 24);
  await page.mouse.wheel(0, -120);
  const reset = page.getByRole('button', { name: '还原画面缩放', exact: true });
  await expect(reset).toHaveCount(1);
  await expect(reset).toBeEnabled();
  await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-8);
  await reset.click();
  await expect(page.locator('.video-canvas')).not.toHaveClass(/is-zoomed/);
  await expect(reset).toHaveCount(0);
});

test('shared dialog does not dismiss a drag starting inside and reports write errors consistently', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '媒体库设置', exact: true }).click();
  const title = await page.getByRole('heading', { name: '媒体库设置' }).boundingBox();
  await page.mouse.move(title!.x + 30, title!.y + 10);
  await page.mouse.down(); await page.mouse.move(2, 2); await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.route('**/api/roots', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: '测试目录添加失败' }) }));
  await page.getByRole('textbox', { name: '目录路径' }).fill('D:\\test-only');
  await page.getByRole('button', { name: '添加目录', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('测试目录添加失败');
  await expect(page.getByRole('alert')).toHaveClass(/ui-status.*error/);
  await page.mouse.click(2, 2);
  await page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true}).getByRole('button',{name:'放弃修改',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
