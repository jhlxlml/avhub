import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.post('/test/reset'); });

test('startup refuses a stale backend build and explicit retry restores the library', async ({ page }) => {
  await page.route('**/api/health', async route => {
    const response = await route.fetch();
    await route.fulfill({ json:{ ...await response.json(), build_id:'old-backend-test' } });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('服务 old-backend-test');
  await expect(page.getByRole('button', {name:'全部视频', exact:true})).toHaveCount(0);
  await page.unroute('**/api/health');
  await page.getByRole('button', {name:'重试启动',exact:true}).click();
  await expect(page.getByRole('button', {name:'全部视频',exact:true})).toBeVisible();
});

test('runtime diagnostics are lazy, show actual data/build paths, handle retry and fit narrow windows', async ({ page, request }) => {
  const health = await (await request.get('/api/health')).json();
  let reads = 0;
  await page.route('**/api/diagnostics', route => { reads++; return reads===1 ? route.fulfill({status:503,json:{detail:'temporary diagnostic failure'}}) : route.continue(); });
  await page.goto('/');
  await page.getByRole('button', {name:'媒体库设置'}).click();
  expect(reads).toBe(0);
  await page.getByRole('tab', {name:'运行诊断',exact:true}).click();
  await page.locator('.runtime-diagnostics summary').click();
  await expect(page.getByRole('alert')).toContainText('temporary diagnostic failure');
  await page.getByRole('button', {name:'刷新诊断',exact:true}).click();
  await expect(page.locator('.diagnostic-fields')).toContainText(health.data_dir);
  expect(await page.locator('.diagnostic-fields').innerText()).toContain(health.build_id);
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name:'导出诊断',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('avhub-diagnostics.json');
  await page.setViewportSize({width:390,height:700});
  expect(await page.locator('[role="dialog"]').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.getByRole('button', {name:'关闭设置',exact:true}).click();
});

test('a stalled query times out and manual retry succeeds without resetting filters', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.section-title')).toContainText('共 347 个结果');
  await page.clock.install();
  await page.route('**/api/media?*', () => {});
  await page.getByRole('button', {name:'电影',exact:true}).click();
  await page.clock.runFor(16000);
  await expect(page.getByRole('alert')).toContainText('本地服务响应超时');
  await page.unroute('**/api/media?*');
  await page.getByRole('button', {name:'重试',exact:true}).click();
  await page.clock.runFor(300);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/view=movies/);
});

test('a stalled write releases busy state and warns about uncertain submission without automatic replay', async ({ page }) => {
  await page.goto('/?video=2');
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => v.readyState >= 2)).toBe(true);
  await page.clock.install();
  let writes = 0;
  await page.route('**/api/media/2/favorite', () => { writes++; });
  const favorite = page.locator('.player-top .favorite-action');
  await favorite.click();
  await expect(favorite).toBeDisabled();
  await page.clock.runFor(21000);
  await expect(page.getByRole('alert').filter({hasText:'操作可能已提交'})).toBeVisible();
  await expect(favorite).toBeEnabled();
  expect(writes).toBe(1);
});

test('rolling HLS keeps playing after prefix eviction and rewinding an evicted point reopens at the original time', async ({ page }) => {
  let starts = 0; let windowStart = 0;
  await page.route('**/media/3/file', route => route.fulfill({status:404,body:'force remux'}));
  // Exercise the legacy rolling-HLS fallback, not the new indexed VOD path.
  await page.route('**/api/media/3/playback', route => { starts++; return route.continue({postData:JSON.stringify({...route.request().postDataJSON(),indexed_remux:false})}); });
  page.on('response', async response => {
    if (/\/api\/playback\/[^/?]+\?position=/.test(response.url())) {
      try { windowStart = (await response.json()).window_start ?? 0; } catch { /* Page can close while reading. */ }
    }
  });
  await page.goto('/?video=3');
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => v.readyState >= 2 && !v.paused), {timeout:15000}).toBe(true);
  const slider = page.getByRole('slider', {name:'视频完整进度'});
  await slider.evaluate((input:HTMLInputElement) => { input.value='80'; input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); });
  await expect.poll(() => windowStart, {timeout:15000}).toBeGreaterThan(0);
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => !v.paused && v.currentTime > 80)).toBe(true);
  await page.waitForTimeout(2500); // Refresh a playlist with an increased media sequence.
  await expect(page.getByText('暂时无法播放', {exact:true})).toHaveCount(0);
  await page.locator('video').evaluate((v:HTMLVideoElement) => v.pause());
  const before = starts;
  await slider.evaluate((input:HTMLInputElement) => { input.value='5'; input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); });
  await expect.poll(() => starts).toBe(before + 1);
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => v.readyState >= 2 && v.paused)).toBe(true);
  await expect(slider).toHaveValue(/^[5-7](?:\.\d+)?$/);
});

test('a preparation cancelled before the server receives it cannot create an orphan task later', async ({ page, request }) => {
  let body:any;
  await page.route('**/api/media/3/playback', route => { body = route.request().postDataJSON(); });
  await page.goto('/?video=3');
  await expect.poll(() => Boolean(body?.client_token)).toBe(true);
  await page.getByRole('button', {name:'返回媒体库',exact:false}).click();
  await expect(page.getByRole('button', {name:'全部视频',exact:true})).toBeVisible();
  await expect.poll(async () => (await request.post('/api/media/3/playback', {data:{...body,prefer_original:false,force_transcode:true,allow_video_transcode:true,allow_audio_transcode:true}})).status()).toBe(409);
  await expect.poll(async () => (await (await request.get('/test/sessions')).json()).count).toBe(0);
});

test('HTTP 410 cache recovery does not upgrade a lossless remux to transcode or leak the old task', async ({ page, request }) => {
  const starts:Array<{force_transcode:boolean;skip_direct?:boolean}> = [];
  await page.route('**/media/3/file', route => route.fulfill({status:404,body:'force remux'}));
  await page.route('**/api/media/3/playback', route => {
    const body={...route.request().postDataJSON(),indexed_remux:false};starts.push(body);
    return route.continue({postData:JSON.stringify(body)});
  });
  let expired = false;
  await page.route('**/media/hls/**/segment_*.ts', route => {
    if (!expired) { expired = true; return route.fulfill({status:410,body:'expired fragment fixture'}); }
    return route.continue();
  });
  await page.goto('/?video=3');
  await expect(page.getByRole('button', {name:'画质',exact:true})).toHaveAttribute('title', /无损重封装/, {timeout:15000});
  await expect.poll(() => page.locator('video').evaluate((v:HTMLVideoElement) => v.readyState >= 2 && !v.paused), {timeout:15000}).toBe(true);
  expect(starts).toHaveLength(3); // Direct attempt, remux, same-mode cache recovery.
  expect(starts[2]).toMatchObject({force_transcode:false,skip_direct:true});
  await page.getByRole('button', {name:'返回媒体库',exact:false}).click();
  await expect.poll(async () => (await (await request.get('/test/sessions')).json())).toEqual({count:0,folders:0});
});

test('a slow or failed subtitle restore never saves the temporary disabled state', async ({ page, request }) => {
  const detail = await (await request.get('/api/media/1')).json();
  const saved = {id:detail.external_subtitles[0].path,delay:.4};
  await request.patch('/api/preferences', {data:{values:{'subtitle.1':saved}}});
  let waiting = false; let release!:()=>void;
  const gate = new Promise<void>(resolve => {release=resolve;});
  await page.route('**/media/1/subtitle?*', async route => {
    waiting=true; await gate;
    await route.fulfill({status:503,body:'temporary subtitle read failure'});
  });
  await page.goto('/?video=1');
  await expect.poll(()=>waiting).toBe(true);
  await page.waitForTimeout(600);
  expect((await (await request.get('/api/preferences/subtitle/1')).json()).value).toEqual(saved);
  release();
  await expect(page.locator('.subtitle-error')).toContainText('读取字幕失败');
  await page.waitForTimeout(400);
  expect((await (await request.get('/api/preferences/subtitle/1')).json()).value).toEqual(saved);
  await page.unroute('**/media/1/subtitle?*');
  await page.getByRole('button',{name:'返回媒体库',exact:false}).click();
  await page.getByRole('button',{name:'播放 视频 001',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'字幕轨道'})).toHaveValue(saved.id);
  await expect(page.getByLabel('当前字幕延迟')).toHaveText('+0.4 秒');
});

test('a late subtitle preference read from an old Player cannot overwrite the newer choice', async ({ page, request }) => {
  const detail = await (await request.get('/api/media/1')).json();
  const saved = {id:detail.external_subtitles[0].path,delay:.4};
  await request.patch('/api/preferences', {data:{values:{'subtitle.1':saved}}});
  let reads=0; let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/preferences/subtitle/1',async route=>{
    reads++;
    if(reads===1){await gate;await route.fulfill({json:{value:{id:'',delay:0}}});}
    else await route.continue();
  });
  await page.goto('/?video=1');
  await expect.poll(()=>reads).toBe(1);
  await page.getByRole('button',{name:'返回媒体库',exact:false}).click();
  await page.getByRole('button',{name:'播放 视频 001',exact:true}).click();
  const selection=page.getByRole('combobox',{name:'字幕轨道'});
  await expect(selection).toHaveValue(saved.id);
  await page.getByRole('button',{name:'字幕延迟增加 0.1 秒'}).click();
  await expect(page.getByLabel('当前字幕延迟')).toHaveText('+0.5 秒');
  release();
  await page.waitForTimeout(600);
  await page.getByRole('button',{name:'返回媒体库',exact:false}).click();
  await page.getByRole('button',{name:'播放 视频 001',exact:true}).click();
  await expect(selection).toHaveValue(saved.id);
  await expect(page.getByLabel('当前字幕延迟')).toHaveText('+0.5 秒');
});
