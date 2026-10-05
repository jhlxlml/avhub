import {test,expect,type Page,type APIRequestContext} from '@playwright/test';

test.beforeEach(async({request})=>{
  await request.post('/test/reset');
  await request.post('/test/indexed-ts-fixture?fresh=true');
  await request.post('/test/ts-index-gate?hold=true');
});

async function openHead(page:Page,request:APIRequestContext) {
  await page.goto('/?video=5');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
  expect(await (await request.get('/test/ts-index-state')).json()).toEqual({head:1,full:1});
  await page.locator('.playback-diagnostics summary').click();
  await expect(page.getByText('正在准备播放…',{exact:true})).toHaveCount(0);
}

async function seek(page:Page,target:number) {
  await page.getByRole('slider',{name:'视频完整进度'}).evaluate((input:HTMLInputElement,value)=>{
    input.value=String(value);input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  },target);
}

test('head plays before full indexing; cached reopen skips both probes',async({page,request})=>{
  await openHead(page,request);
  const src=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
  await request.post('/test/ts-index-gate');
  await seek(page,75.3);
  await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(src);
  await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
  await expect(page.locator('video')).toHaveCount(0);
  await page.goto('/?video=5');
  await page.getByRole('button',{name:'继续播放',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
  expect(await (await request.get('/test/ts-index-state')).json()).toEqual({head:1,full:1});
});

for(const paused of [false,true]) {
  test(`far seeks during background indexing keep the last target, source and paused=${paused}`,async({page,request})=>{
    let creates=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/5/playback')creates++;});
    await openHead(page,request);
    if(paused)await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
    const src=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
    for(const target of [92.5,41.2,73.3])await seek(page,target);
    await expect(page.getByLabel('跳播耗时')).toHaveAttribute('data-target','73.3');
    await expect(page.getByLabel('跳播耗时')).toHaveText(/等待画面/);
    await page.waitForTimeout(500);
    await expect(page.locator('.buffering')).toBeVisible();
    expect(creates).toBe(1);
    await request.post('/test/ts-index-gate');
    await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
    await expect(page.locator('.seek-frame')).toBeHidden();
    await expect(page.locator('.buffering')).toHaveCount(0);
    const state=await page.locator('video').evaluate((v:HTMLVideoElement)=>({time:v.currentTime,paused:v.paused,src:v.currentSrc,size:[v.videoWidth,v.videoHeight]}));
    expect(state.paused).toBe(paused);expect(Math.abs(state.time-73.3)).toBeLessThan(1);
    expect(state.src).toBe(src);expect(state.size).toEqual([320,180]);expect(creates).toBe(1);
  });
}

test('seeking back into the available head cancels a pending far target',async({page,request})=>{
  await openHead(page,request);
  await seek(page,80);await seek(page,2.4);
  await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.paused&&v.currentTime>=2.4)).toBeTruthy();
  await request.post('/test/ts-index-gate');await page.waitForTimeout(500);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeLessThan(5);
});

test('closing while the full probe is pending cancels it and retires the session',async({page,request})=>{
  await openHead(page,request);await seek(page,80);
  await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
  await expect.poll(async()=> (await (await request.get('/test/sessions')).json())).toEqual({count:0,folders:0});
  await request.post('/test/ts-index-gate');await page.waitForTimeout(250);
  expect(await (await request.get('/test/sessions')).json()).toEqual({count:0,folders:0});
});

test('pause shortcut during a pending far seek updates intent without playing the old position',async({page,request})=>{
  await openHead(page,request);await seek(page,73.3);
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  await page.keyboard.press('k');
  await expect(page.getByRole('button',{name:'播放',exact:true})).toBeVisible();
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
  await request.post('/test/ts-index-gate');
  await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(73.3,0);
});

test('late resume waits for its actual range and retains exact non-keyframe position',async({page,request})=>{
  await request.put('/api/media/5/progress',{data:{progress:77.3,watched:false,updated_at:1}});
  await page.goto('/?video=5');await page.getByRole('button',{name:'继续播放',exact:true}).click();
  await expect.poll(async()=> (await (await request.get('/test/ts-index-state')).json())).toEqual({head:1,full:1});
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBe(0);
  await request.post('/test/ts-index-gate');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThanOrEqual(77.3);
});

test('continuous playback and far seek use appended ranges before full indexing finishes',async({page,request})=>{
  await request.post('/test/ts-index-gate?hold=true&until=90&delay=0.1');
  let creates=0;let token='';const failedSegments:string[]=[];
  page.on('response',async r=>{
    if(new URL(r.url()).pathname==='/api/media/5/playback') {creates++;token=(await r.json()).token;}
  });
  page.on('requestfailed',r=>{if(/segment_\d+\.ts/.test(r.url()))failedSegments.push(r.url());});
  await openHead(page,request);
  const source=await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.playbackRate=4;return v.currentSrc;});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime),{timeout:12000}).toBeGreaterThan(26);
  expect((await (await request.get(`/api/playback/${token}`)).json()).complete).toBe(false);
  await seek(page,63.4);
  await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
  expect((await (await request.get(`/api/playback/${token}`)).json()).complete).toBe(false);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(source);
  expect(creates).toBe(1);expect(failedSegments).toEqual([]);
  await expect(page.locator('.buffering')).toHaveCount(0);
  await request.post('/test/ts-index-gate');
});

test('publishing the full timeline does not abort an in-flight video segment',async({page,request})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const failures:string[]=[];let segmentRequests=0;let token='';
  page.on('requestfailed',r=>{if(/segment_000001\.ts/.test(r.url()))failures.push(r.url());});
  page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/media/5/playback')token=(await r.json()).token;});
  await page.route('**/segment_000001.ts',async route=>{
    segmentRequests++;const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>{});
  });
  try {
    await openHead(page,request);
    await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
    await expect.poll(()=>segmentRequests).toBe(1);
    await request.post('/test/ts-index-gate');
    await expect.poll(async()=> (await (await request.get(`/api/playback/${token}`)).json()).complete).toBe(true);
    await page.waitForTimeout(600);
    expect(failures).toEqual([]);expect(segmentRequests).toBe(1);
    release();
    await seek(page,23.3);
    await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
    expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
  }finally {release();}
});

test('a full-index failure after head playback falls back once without video re-encoding',async({page,request})=>{
  const bodies:any[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/5/playback')bodies.push(r.postDataJSON());});
  await openHead(page,request);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());await seek(page,43.3);
  await request.post('/test/ts-index-gate?fail=true');
  await expect.poll(()=>bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({indexed_ts:false,force_transcode:false,quality:'auto',start:43.3,autoplay:false});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/视频无损重封装/);
});
