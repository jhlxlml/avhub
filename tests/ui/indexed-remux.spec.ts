import {test,expect} from '@playwright/test';
import {revealPlayerControls} from './player-pointer';
// Renderer/decoder harness only. Real desktop acceptance lives in
// electron/test/chromium-direct-performance.mjs.

test.beforeEach(async({request})=>{await request.post('/test/reset');});

for(const [container,audio] of [['mkv','aac'],['avi','mp3'],['mov','aac'],['flv','aac'],['mp4','ac3']]) {
  test(`indexed ${container}/${audio} long-GOP B-frame seeks show the target without rebuilding the source`,async({page,request})=>{
    const fixture=await request.post(`/test/indexed-remux-fixture?container=${container}&audio=${audio}`);
    expect(fixture.ok(),await fixture.text()).toBeTruthy();
    const starts:any[]=[];
    await page.route('**/api/media/3/playback',route=>{
      // AC3 fixture exercises deliberately authorized AUDIO-only conversion;
      // the original video still uses copy, not permission to encode video.
      const body={...route.request().postDataJSON(),prefer_original:false,skip_direct:true,...(audio==='ac3'?{allow_audio_transcode:true}:{})};starts.push(body);
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
  await revealPlayerControls(page);
  await page.getByRole('button',{name:'音轨',exact:true}).click();
  await page.getByRole('combobox',{name:'音轨',exact:true}).selectOption('2');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused&&v.readyState>=2)).toBeTruthy();
  await expect.poll(()=>starts.length).toBe(2);
  expect(starts[1]).toMatchObject({audio_track_index:2,autoplay:false,indexed_remux:true});
});

test('manual MP4 lossless delivery keeps position, pause and original quality; original restores and reopening resets',async({page,request})=>{
  expect((await request.post('/test/indexed-remux-fixture?container=mp4&audio=aac')).ok()).toBeTruthy();
  const starts:any[]=[];
  await page.route('**/api/media/3/playback',route=>{starts.push(route.request().postDataJSON());return route.continue();});
  await page.goto('/?video=3');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused&&v.videoWidth===320)).toBeTruthy();
  expect(starts).toHaveLength(1);expect(starts[0]).toMatchObject({prefer_original:true,force_transcode:false,quality:'auto'});
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=31.2;});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking)).toBeTruthy();
  await revealPlayerControls(page);await page.getByRole('button',{name:'倍速',exact:true}).click();
  await page.getByRole('combobox',{name:'倍速',exact:true}).selectOption('1.5');
  await revealPlayerControls(page);await page.getByRole('button',{name:'画质',exact:true}).click();
  await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('lossless');
  await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/本次无损封装.*索引按需封装/);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused&&v.readyState>=2&&Math.abs(v.currentTime-31.2)<.3&&v.playbackRate===1.5)).toBeTruthy();
  expect(starts).toHaveLength(2);expect(starts[1]).toMatchObject({prefer_original:false,skip_direct:true,force_transcode:false,quality:'auto',allow_video_transcode:false,allow_audio_transcode:false,autoplay:false});
  const source=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
  for(const target of [91.3,16.7]){
    await page.getByRole('slider',{name:'视频完整进度'}).evaluate((input:HTMLInputElement,value:number)=>{input.value=String(value);input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));},target);
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement,target:number)=>!v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-target)<1,target)).toBeTruthy();
    const state=await page.locator('video').evaluate((v:HTMLVideoElement)=>({paused:v.paused,time:v.currentTime,src:v.currentSrc}));
    expect(state.paused).toBe(true);expect(Math.abs(state.time-target)).toBeLessThan(1);expect(state.src).toBe(source);
  }
  expect(starts).toHaveLength(2);
  await revealPlayerControls(page);await page.getByRole('button',{name:'画质',exact:true}).click();
  await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('auto');
  await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/原片优先.*原文件直放/);
  expect(starts[2]).toMatchObject({prefer_original:true,skip_direct:false,allow_video_transcode:false,allow_audio_transcode:false,autoplay:false});
  await page.reload();
  await page.getByRole('button',{name:'继续播放',exact:true}).click();
  await expect.poll(()=>starts.length).toBe(4);expect(starts[3].prefer_original).toBe(true);
  await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/原片优先.*原文件直放/);
});

test('lossless option cannot inherit permission to convert an incompatible MP4 audio track',async({page,request})=>{
  await request.post('/test/indexed-remux-fixture?container=mp4&audio=ac3');
  await page.goto('/?video=3');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  await revealPlayerControls(page);await page.getByRole('button',{name:'画质',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'画质',exact:true}).locator('option[value=lossless]')).toHaveAttribute('disabled','');
  const response=await request.post('/api/media/3/playback',{data:{start:0,force_transcode:false,prefer_original:false,skip_direct:true,quality:'auto',indexed_remux:true,allow_video_transcode:false,allow_audio_transcode:false}});
  expect(response.status()).toBe(422);
});

test('lossless choice revokes prior lossy permission and errors offer a direct original return',async({page,request})=>{
  await request.post('/test/indexed-remux-fixture?container=mp4&audio=aac');
  const starts:any[]=[];
  await page.route('**/api/media/3/playback',route=>{
    const body=route.request().postDataJSON();starts.push(body);
    if(starts.length===3)return route.fulfill({status:422,json:{detail:'隔离测试：缓存空间不足'}});
    return route.continue();
  });
  await page.goto('/?video=3');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
  await revealPlayerControls(page);await page.getByRole('button',{name:'画质',exact:true}).click();
  await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('compat');
  await page.getByRole('dialog',{name:'启用有损兼容播放？',exact:true}).getByRole('button',{name:'接受并继续',exact:true}).click();
  await expect.poll(()=>starts.length).toBe(2);
  expect(starts[1]).toMatchObject({allow_video_transcode:true,allow_audio_transcode:true});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
  await revealPlayerControls(page);await page.getByRole('button',{name:'画质',exact:true}).click();
  await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('lossless');
  await expect(page.getByText('隔离测试：缓存空间不足',{exact:true})).toBeVisible();
  expect(starts[2]).toMatchObject({force_transcode:false,allow_video_transcode:false,allow_audio_transcode:false,prefer_original:false,skip_direct:true});
  await page.getByRole('button',{name:'返回原片播放',exact:true}).click();
  await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/原片优先.*原文件直放/);
  expect(starts[3]).toMatchObject({force_transcode:false,allow_video_transcode:false,allow_audio_transcode:false,prefer_original:true,skip_direct:false});
});

test('explicit lossless indexing failure stops instead of silently replacing the delivery path',async({page,request})=>{
  await request.post('/test/indexed-remux-fixture?container=mp4&audio=aac');
  const starts:any[]=[];
  await page.route('**/api/media/3/playback',route=>{
    const body=route.request().postDataJSON();starts.push(body);
    if(body.strict_remux)return route.fulfill({json:{mode:'remux',state:'failed',delivery:'indexed-remux',offset:0,error:'隔离测试：索引不可用'}});
    return route.continue();
  });
  await page.goto('/?video=3');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
  await revealPlayerControls(page);await page.getByRole('button',{name:'画质',exact:true}).click();
  await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('lossless');
  await expect(page.getByText('隔离测试：索引不可用',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'返回原片播放',exact:true})).toBeVisible();
  expect(starts).toHaveLength(2);expect(starts[1]).toMatchObject({strict_remux:true,allow_video_transcode:false,allow_audio_transcode:false});
});
