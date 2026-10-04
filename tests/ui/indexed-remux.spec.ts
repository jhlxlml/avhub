import {test,expect} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

for(const [container,audio] of [['mkv','aac'],['avi','mp3'],['mov','aac'],['flv','aac'],['mp4','ac3']]) {
  test(`indexed ${container}/${audio} long-GOP B-frame seeks show the target without rebuilding the source`,async({page,request})=>{
    const fixture=await request.post(`/test/indexed-remux-fixture?container=${container}&audio=${audio}`);
    expect(fixture.ok(),await fixture.text()).toBeTruthy();
    const starts:any[]=[];
    await page.route('**/api/media/3/playback',route=>{
      const body={...route.request().postDataJSON(),prefer_original:false,skip_direct:true};starts.push(body);
      return route.continue({postData:JSON.stringify(body)});
    });
    await page.goto('/?video=3');
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
    await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/索引按需封装/);
    await page.locator('.playback-diagnostics summary').click();
    const source=await page.locator('video').evaluate((v:HTMLVideoElement)=>{
      (window as any).sourceEvents=0;v.addEventListener('loadstart',()=>{(window as any).sourceEvents++;});return v.currentSrc;
    });
    for(const paused of [false,true]) {
      if(paused)await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
      for(const target of [91.3,16.7,66.4,5.5]) {
        await page.getByRole('slider',{name:'视频完整进度'}).evaluate((input:HTMLInputElement,value:number)=>{
          input.value=String(value);input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
        },target);
        await expect(page.getByLabel('跳播耗时')).toHaveAttribute('data-target',String(target));
        await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
        await expect(page.locator('.seek-frame')).toBeHidden();
        const state=await page.locator('video').evaluate((v:HTMLVideoElement)=>({paused:v.paused,seeking:v.seeking,time:v.currentTime,src:v.currentSrc,width:v.videoWidth,height:v.videoHeight}));
        expect(state.paused).toBe(paused);expect(state.seeking).toBe(false);expect(Math.abs(state.time-target)).toBeLessThan(1);
        expect(state.src).toBe(source);expect([state.width,state.height]).toEqual([320,180]);
      }
    }
    expect(starts).toHaveLength(1);expect(await page.evaluate(()=>(window as any).sourceEvents)).toBe(0);
    await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
    await expect.poll(async()=> (await (await request.get('/test/sessions')).json())).toEqual({count:0,folders:0});
  });
}

test('an unsupported remux index falls back once with original quality and audio',async({page,request})=>{
  await request.post('/test/indexed-remux-fixture');
  const starts:any[]=[];
  await page.route('**/api/media/3/playback',async route=>{
    const body={...route.request().postDataJSON(),prefer_original:false,skip_direct:true};starts.push(body);
    const response=await route.fetch({postData:JSON.stringify(body)});const data=await response.json();
    if(data.delivery==='indexed-remux'){data.state='failed';data.error='unsupported fixture';}
    await route.fulfill({response,json:data});
  });
  await page.goto('/?video=3');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBeTruthy();
  expect(starts).toHaveLength(2);expect(starts[1]).toMatchObject({indexed_remux:false,force_transcode:false,quality:'auto'});
  await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/视频无损重封装/);
});

test('indexed remux audio switching retains the selected track and pause state',async({page,request})=>{
  await request.post('/test/indexed-remux-fixture');
  const starts:any[]=[];
  await page.route('**/api/media/3/playback',route=>{
    const body={...route.request().postDataJSON(),prefer_original:false,skip_direct:true};starts.push(body);
    return route.continue({postData:JSON.stringify(body)});
  });
  await page.goto('/?video=3');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBeTruthy();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await page.getByRole('button',{name:'音轨',exact:true}).click();
  await page.getByRole('combobox',{name:'音轨',exact:true}).selectOption('2');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused&&v.readyState>=2)).toBeTruthy();
  await expect.poll(()=>starts.length).toBe(2);
  expect(starts[1]).toMatchObject({audio_track_index:2,autoplay:false,indexed_remux:true});
});
