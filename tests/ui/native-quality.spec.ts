import {test,expect} from '@playwright/test';

test.beforeEach(async({request})=>{
  await request.post('/test/reset');
  await request.patch('/api/preferences',{data:{values:{nativePrepare:true}}});
  // Completed copies intentionally survive resets/restarts; isolate this
  // preparation test from settings tests that verify this persistence.
  expect((await request.delete('/api/media/3/native-prepare')).ok()).toBe(true);
});

test('native preparation preserves original playback and the default path uses the prepared MKV',async({page,request})=>{
  await page.goto('/?q=003');await page.getByRole('button',{name:'更多操作 视频 003',exact:true}).click();
  await page.getByRole('menuitem',{name:'无损播放准备',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'无损播放准备'});
  await expect(dialog).toContainText('不做转码或降画质');
  await dialog.getByRole('button',{name:'开始无损准备',exact:true}).click();
  await expect(dialog).toContainText('已准备完成');
  await page.screenshot({path:'test-results/native-prepare-ready.png'});
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  const bodies:any[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/3/playback')bodies.push(r.postDataJSON());});
  await page.getByRole('button',{name:'播放 视频 003',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBe(true);
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc)).toContain('/media/3/prepared');
  await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/无损优化副本直放/);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.currentTime=43.3;v.pause();});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking&&v.readyState>=2)).toBe(true);
  expect(bodies.every(body=>!body.force_transcode&&!body.allow_video_transcode)).toBe(true);
  const clear=await request.delete('/api/media/3/native-prepare');expect(clear.status()).toBe(409);
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await expect.poll(async()=> (await (await request.get('/api/media/3/native-prepare')).json()).in_use).toBe(false);
  expect((await request.delete('/api/media/3/native-prepare')).ok()).toBe(true);
  expect((await request.get('/media/3/file')).ok()).toBe(true);
});

test('default API refuses video downgrade, tone mapping and unapproved audio conversion',async({request})=>{
  await request.post('/test/hdr-fixture');
  for(const body of [{force_transcode:true},{quality:'720p'},{quality:'compat'}]) {
    const result=await request.post('/api/media/6/playback',{data:body});expect(result.status()).toBe(422);
    expect(await result.text()).toContain('不会降低分辨率');
  }
  await request.post('/test/indexed-remux-fixture?container=mp4&audio=ac3');
  const audio=await request.post('/api/media/3/playback',{data:{skip_direct:true,indexed_remux:true}});
  expect(audio.status()).toBe(422);expect(await audio.text()).toContain('不会自动转换音轨');
  expect((await (await request.get('/test/sessions')).json()).count).toBe(0);
});

test('prepared-source failure retries the original at the same paused position without encoding',async({page,request})=>{
  expect((await request.post('/api/media/3/native-prepare')).ok()).toBe(true);
  await expect.poll(async()=> (await (await request.get('/api/media/3/native-prepare')).json()).state).toBe('ready');
  const bodies:any[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/3/playback')bodies.push(r.postDataJSON());});
  await page.goto('/?video=3');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBe(true);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=31.4;});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking&&v.readyState>=2)).toBe(true);
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('error')));
  await expect.poll(()=>bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({skip_prepared:true,prefer_original:true,autoplay:false});
  expect(bodies[1].start).toBeCloseTo(31.4,1);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.paused&&Math.abs(v.currentTime-31.4)<.2&&v.currentSrc.endsWith('/media/3/file'))).toBe(true);
  expect(bodies.every(body=>!body.allow_video_transcode&&!body.force_transcode)).toBe(true);
});

test('native preparation dialog shares light theme and fits a narrow window',async({page})=>{
  await page.goto('/?q=003');await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  await page.setViewportSize({width:390,height:760});
  await page.getByRole('button',{name:'更多操作 视频 003',exact:true}).click();
  await page.getByRole('menuitem',{name:'无损播放准备',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'无损播放准备'});
  await expect(dialog).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(dialog.locator('h2')).toHaveClass('dialog-title');
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/native-prepare-light.png'});
});

test('lossless failure stops rather than automatically escalating to video encoding',async({page})=>{
  const bodies:any[]=[];
  await page.route('**/media/2/file',r=>r.fulfill({status:404,body:'exercise original failure'}));
  await page.route('**/api/media/2/playback',async route=>{
    const body=route.request().postDataJSON();bodies.push(body);
    if(body.prefer_original)return route.continue();
    await route.fulfill({json:{mode:'remux',state:'ready',url:'/test/invalid-native.m3u8',offset:0,complete:true,window_end:120}});
  });
  await page.route('**/test/invalid-native.m3u8',r=>r.fulfill({body:'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n/test/invalid-native.ts\n#EXT-X-ENDLIST\n'}));
  await page.route('**/test/invalid-native.ts',r=>r.fulfill({body:'not a video'}));
  await page.goto('/?video=2');
  await expect(page.getByText('暂时无法播放',{exact:true})).toBeVisible({timeout:15000});
  await expect(page.getByRole('alert')).toContainText('不会自动降低画质');
  expect(bodies.length).toBeGreaterThanOrEqual(2);expect(bodies.every(b=>!b.force_transcode&&!b.allow_video_transcode)).toBe(true);
});

test('lossy quality selection can be declined and needs explicit permission when accepted',async({page})=>{
  const bodies:any[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/2/playback')bodies.push(r.postDataJSON());});
  await page.goto('/?video=2');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBe(true);
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'画质',exact:true}).click();await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('720p');
  expect(bodies).toHaveLength(1);await expect(page.getByRole('button',{name:'画质',exact:true})).toHaveAttribute('title',/原片优先/);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'画质',exact:true}).click();await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('compat');
  await expect.poll(()=>bodies.length).toBe(2);expect(bodies[1]).toMatchObject({allow_video_transcode:true,allow_audio_transcode:true,quality:'compat'});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBe(true);
  await page.getByRole('button',{name:'画质',exact:true}).click();await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('auto');
  await expect.poll(()=>bodies.length).toBe(3);expect(bodies[2]).toMatchObject({allow_video_transcode:false,allow_audio_transcode:false,prefer_original:true,quality:'auto'});
});
