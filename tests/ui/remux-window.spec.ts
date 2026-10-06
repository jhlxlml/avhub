import {test,expect,type Page} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');await request.post('/test/indexed-remux-fixture?gop=2');});
async function open(page:Page) {
  await page.route('**/api/media/3/playback',route=>route.continue({postData:JSON.stringify({...route.request().postDataJSON(),prefer_original:false,skip_direct:true})}));
  await page.goto('/?video=3');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBe(true);
  await page.locator('.playback-diagnostics summary').click();
}
async function seek(page:Page,point:number) {
  await page.getByRole('slider',{name:'视频完整进度'}).evaluate((e:HTMLInputElement,t)=>{e.value=String(t);e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));},point);
}

test('short GOP MKV windows retain original dimensions, pause intent and source across real seeks',async({page,request})=>{
  let token='';let creates=0;const timings:string[]=[];
  page.on('response',async r=>{
    if(new URL(r.url()).pathname==='/api/media/3/playback'){creates++;token=(await r.json()).token;}
    if(r.headers()['server-timing'])timings.push(r.headers()['server-timing']);
  });
  await open(page);
  const source=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
  await expect.poll(async()=> (await (await request.get(`/api/playback/${token}`)).json()).remux_stats?.published??0).toBeGreaterThan(8);
  for(const paused of [false,true]) {
    if(paused)await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
    for(const point of [61.3,8.4,94.7,17.3]) {
      await seek(page,point);await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
      await expect(page.locator('.seek-frame')).toBeHidden();
      const state=await page.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused,source:v.currentSrc,size:[v.videoWidth,v.videoHeight]}));
      expect(Math.abs(state.time-point)).toBeLessThan(1);expect(state.paused).toBe(paused);expect(state.source).toBe(source);expect(state.size).toEqual([320,180]);
    }
  }
  const stats=(await (await request.get(`/api/playback/${token}`)).json()).remux_stats;
  expect(stats.batch_failures).toBe(0);expect(stats.processes).toBeLessThan(stats.published);expect(stats.cache_hits).toBeGreaterThan(0);
  expect(creates).toBe(1);expect(timings.some(t=>t.includes('remux;dur='))).toBe(true);
});

test('new user seeks preempt held prefetch without waiting for the old window',async({page,request})=>{
  await request.post('/test/remux-window-gate?hold=true');
  let token='';let creates=0;
  page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/media/3/playback'){creates++;token=(await r.json()).token;}});
  try {
    await open(page);
    await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
    const source=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
    for(const point of [61.3,94.7,17.3]) {
      await seek(page,point);await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
      await expect(page.locator('.seek-frame')).toBeHidden();
      expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
      expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(source);
    }
    const stats=(await (await request.get(`/api/playback/${token}`)).json()).remux_stats;
    expect(stats.cancelled).toBeGreaterThanOrEqual(2);expect(stats.batch_failures).toBe(0);expect(creates).toBe(1);
    await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
    await expect.poll(async()=> (await (await request.get('/test/sessions')).json())).toEqual({count:0,folders:0});
  }finally{await request.post('/test/remux-window-gate');}
});

test('batched MKV preserves selected second AAC track after switching while paused',async({page,request})=>{
  let token='';const bodies:any[]=[];
  page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/media/3/playback'){token=(await r.json()).token;}});
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/3/playback')bodies.push(r.postDataJSON());});
  await open(page);await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await page.getByRole('button',{name:'音轨',exact:true}).click();await page.getByRole('combobox',{name:'音轨',exact:true}).selectOption('2');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.paused)).toBe(true);
  await seek(page,61.3);await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
  expect(bodies.at(-1)).toMatchObject({audio_track_index:2,autoplay:false,force_transcode:false});
  expect((await (await request.get(`/api/playback/${token}`)).json()).remux_stats.batch_failures).toBe(0);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
});
