import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.post('/test/reset'); });

test('delayed playback API is distinguished from browser load and measurements stay stable while playing', async ({ page }) => {
  await page.route('**/api/media/2/playback', async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve,650));
    await route.fulfill({response});
  });
  await page.goto('/?video=2');
  await page.locator('.playback-diagnostics summary').click();
  await expect(page.getByLabel('播放准备阶段')).toHaveText('本地播放接口');
  await expect(page.getByLabel('播放准备阶段')).toHaveText(/已完成 · [\d.]+ (?:ms|秒)/);
  await expect(page.getByLabel('本地播放接口耗时')).toHaveText(/[\d.]+ (?:ms|秒)/);
  await expect(page.getByLabel('浏览器载入视频耗时')).toHaveText(/[\d.]+ (?:ms|秒)/);
  await expect(page.getByLabel('服务内部处理耗时')).toHaveText(/[\d.]+ (?:ms|秒)/);
  await expect(page.getByLabel('起播耗时')).toHaveText(/[\d.]+ (?:ms|秒)/);
  const measured=await page.getByLabel('播放准备阶段').textContent();
  await page.locator('video').evaluate(v => v.dispatchEvent(new Event('loadedmetadata')));
  await expect(page.getByLabel('播放准备阶段')).toHaveText(measured!);
  await page.locator('.video-wrap').hover();
  await expect(page.getByRole('button',{name:'全屏',exact:true})).toBeEnabled();
});

test('a stalled browser source reports its stage and manual retry preserves original playback quality', async ({ page }) => {
  const requests:Array<{quality:string;force_transcode:boolean}>=[];
  await page.route('**/api/media/2/playback',route=>{requests.push(route.request().postDataJSON());return route.continue();});
  await page.route('**/media/2/file',()=>{});
  await page.clock.install();
  await page.goto('/?video=2');
  await page.locator('.playback-diagnostics summary').click();
  await expect(page.getByLabel('播放准备阶段')).toHaveText('浏览器载入视频');
  await page.clock.runFor(46000);
  await expect(page.getByText('浏览器载入视频超时，请重试；可展开播放信息查看耗时阶段',{exact:true})).toBeVisible();
  await expect(page.getByLabel('播放准备阶段')).toHaveText(/未完成/);
  expect(requests).toHaveLength(1);  // No automatic quality downgrade.
  await page.unroute('**/media/2/file');
  await page.getByRole('button',{name:'重试播放',exact:true}).click();
  await page.clock.resume();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({quality:'auto',force_transcode:false});
});

test('silent audio-only decoding falls back once instead of pretending the video is playable', async ({ page }) => {
  await page.addInitScript(()=>{
    const width=Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype,'videoWidth')!.get!;
    Object.defineProperty(HTMLVideoElement.prototype,'videoWidth',{get(){return (window as any).compatibleStream ? width.call(this):0;}});
  });
  const requests:Array<{prefer_original:boolean;skip_direct?:boolean}>=[];
  await page.route('**/api/media/2/playback',async route=>{
    const body=route.request().postDataJSON();requests.push(body);
    if(body.skip_direct)await page.evaluate(()=>{(window as any).compatibleStream=true;});
    return route.continue();
  });
  await page.goto('/?video=2');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.videoWidth===320 && v.readyState>=2)).toBeTruthy();
  await page.locator('.playback-diagnostics summary').click();
  await expect(page.getByLabel('起播耗时')).toHaveText(/[\d.]+ (?:ms|秒)/);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({prefer_original:false,skip_direct:true});
  await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/重封装/);
});
