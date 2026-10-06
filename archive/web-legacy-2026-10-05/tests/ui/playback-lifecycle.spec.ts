import {test,expect} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

for(const kind of ['native','indexed-ts','indexed-remux']) {
  test(`${kind}: actual end then rewind retains source, paused target and session until exit`,async({page,request})=>{
    const id=kind==='native'?2:kind==='indexed-ts'?5:3;
    if(kind!=='native')await request.post(`/test/${kind}-fixture`);
    let starts=0;
    await page.route(`**/api/media/${id}/playback`,route=>{
      starts++;
      return route.continue(kind==='indexed-remux'?{postData:JSON.stringify({
        ...route.request().postDataJSON(),prefer_original:false,skip_direct:true})}:{});
    });
    await page.route(`**/api/media/${id}/next?**`,route=>route.fulfill({json:{next:null}}));
    await page.goto(`/?video=${id}`);
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
    await page.locator('.playback-diagnostics summary').click();
    const original=await page.locator('video').evaluate((v:HTMLVideoElement)=>{
      v.currentTime=v.duration-.35;return v.currentSrc;
    });
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.ended)).toBeTruthy();
    await expect(page.getByText('播放结束',{exact:true})).toBeVisible();
    expect((await (await request.get('/test/sessions')).json()).count).toBe(kind==='native'?0:1);
    await page.getByRole('slider',{name:'视频完整进度'}).evaluate((input:HTMLInputElement)=>{
      input.value='12.3';input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    });
    await expect(page.getByText('播放结束',{exact:true})).toHaveCount(0);
    await expect(page.getByLabel('跳播耗时')).toHaveText(/(原片按需读取|已有分段复用) · [\d.]+ (ms|秒)/);
    await expect(page.locator('.seek-frame')).toBeHidden();
    const state=await page.locator('video').evaluate((v:HTMLVideoElement)=>({paused:v.paused,time:v.currentTime,src:v.currentSrc}));
    expect(state.paused).toBeTruthy();expect(state.time).toBeCloseTo(12.3,0);expect(state.src).toBe(original);
    expect(starts).toBe(1);
    await page.getByRole('button',{name:'播放',exact:true}).click();
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.paused&&v.currentTime>12.5)).toBeTruthy();
    await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
    await expect.poll(async()=> (await (await request.get('/test/sessions')).json())).toEqual({count:0,folders:0});
  });
}

for(const container of ['avi','flv']) {
  test(`${container}: unsupported original container opens losslessly in one request`,async({page,request})=>{
    await request.post(`/test/indexed-remux-fixture?container=${container}`);
    const bodies:any[]=[];let originals=0;
    page.on('request',r=>{
      if(new URL(r.url()).pathname==='/api/media/3/playback')bodies.push(r.postDataJSON());
      if(new URL(r.url()).pathname==='/media/3/file')originals++;
    });
    await page.goto('/?video=3');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
    expect(bodies).toHaveLength(1);expect(originals).toBe(0);
    expect(bodies[0]).toMatchObject({prefer_original:false,force_transcode:false,quality:'auto'});
    await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/索引按需封装/);
  });
}

test('metadata without a decoded first frame still has a bounded loading timeout',async({page})=>{
  await page.clock.install();
  let requested=false;
  await page.route('**/media/2/file',()=>{requested=true;});
  await page.goto('/?video=2');
  await expect.poll(()=>requested).toBeTruthy();
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('loadedmetadata')));
  await page.clock.runFor(45001);
  await expect(page.getByText(/浏览器载入视频超时/)).toBeVisible();
});
