import {test,expect,type Page} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

async function openTs(page:Page) {
  await page.route('**/media/5/file',route=>route.fulfill({status:404,body:'exercise TS fallback'}));
  await page.goto('/?video=5');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
  await page.locator('.playback-diagnostics summary').click();
}

test('indexed TS playing and paused seeks keep the source, decoded picture and original dimensions',async({page,request})=>{
  await request.post('/test/indexed-ts-fixture');
  const starts:Array<any>=[];
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/5/playback'&&r.method()==='POST')starts.push(r.postDataJSON());});
  await openTs(page);
  await expect(page.locator('.playback-diagnostics')).toContainText('TS 关键帧索引直读');
  const source=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
  await page.evaluate(()=>{
    const video=document.querySelector('video')!;
    const state=(window as any).tsFrames={emptied:0,loads:0,seeks:0,black:0,missing:0,active:true};
    video.addEventListener('emptied',()=>state.emptied++);
    video.addEventListener('loadstart',()=>state.loads++);
    video.addEventListener('seeking',()=>state.seeks++);
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=9;
    const context=canvas.getContext('2d',{willReadFrequently:true})!;
    const sample=()=>{
      if(!state.active)return;
      const retained=document.querySelector<HTMLCanvasElement>('.seek-frame:not([hidden])');
      if((video.readyState<2||!video.videoWidth)&&!retained)state.missing++;
      else {
        context.drawImage(retained??video,0,0,16,9);const data=context.getImageData(0,0,16,9).data;
        if(!data.some((channel,i)=>i%4!==3&&channel>1))state.black++;
      }
      requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  });
  for(const paused of [false,true]) {
    if(paused)await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
    for(const target of [101.3,12.2,79.1,3.5,63.4,27.3]) {
      await page.getByRole('slider',{name:'视频完整进度'}).evaluate((input:HTMLInputElement,value:number)=>{
        input.value=String(value);input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      },target);
      await expect(page.getByLabel('跳播耗时')).toHaveAttribute('data-target',String(target));
      await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
      await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.seeking)).toBeFalsy();
      await expect(page.locator('.seek-frame')).toBeHidden();
      const snapshot=await page.locator('video').evaluate((v:HTMLVideoElement)=>({paused:v.paused,time:v.currentTime,source:v.currentSrc,size:[v.videoWidth,v.videoHeight]}));
      expect(snapshot.paused).toBe(paused);expect(snapshot.source).toBe(source);
      expect(snapshot.size).toEqual([320,180]);expect(Math.abs(snapshot.time-target)).toBeLessThan(1);
    }
  }
  const beforeSamePoint=await page.evaluate(()=>(window as any).tsFrames.seeks);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{
    const input=document.querySelector<HTMLInputElement>('input[aria-label="视频完整进度"]')!;
    input.value=String(v.currentTime);input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(()=>(window as any).tsFrames.seeks)).toBe(beforeSamePoint);
  // Clicking the picture after seeking only toggles pause/play; no reset/black frame.
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.play());
  await page.locator('.video-wrap').scrollIntoViewIfNeeded();
  const box=(await page.locator('.video-wrap').boundingBox())!;
  await page.mouse.click(box.x+box.width*.4,box.y+box.height*.35);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
  await page.waitForTimeout(200);
  const frames=await page.evaluate(()=>{const state=(window as any).tsFrames;state.active=false;return state;});
  expect(frames.emptied).toBe(0);expect(frames.loads).toBe(0);expect(frames.black).toBe(0);
  expect(frames.missing).toBe(0);expect(starts).toHaveLength(2);
  await expect.poll(async()=> (await (await request.get('/test/sessions')).json()).count).toBe(1);
  await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
  await expect.poll(async()=> (await (await request.get('/test/sessions')).json())).toEqual({count:0,folders:0});
});

test('unsupported TS indexing falls back once to copy remux, not a quality downgrade',async({page})=>{
  const starts:Array<any>=[];
  await page.route('**/api/media/5/playback',async route=>{
    starts.push(route.request().postDataJSON());const response=await route.fetch();const session=await response.json();
    if(session.delivery==='indexed-ts'){session.state='failed';session.error='test unsupported timestamp';}
    await route.fulfill({response,json:session});
  });
  await openTs(page);
  expect(starts).toHaveLength(3);expect(starts[2]).toMatchObject({indexed_ts:false,force_transcode:false,quality:'auto'});
  await expect(page.locator('.playback-diagnostics')).toContainText('保留原视频编码');
});

test('indexed non-keyframe resume and rewinds on a ten-second GOP do not reconstruct playback',async({page,request})=>{
  await request.put('/api/media/5/progress',{data:{progress:77.3,watched:false,updated_at:1}});
  await page.route('**/media/5/file',route=>route.fulfill({status:404,body:'exercise TS fallback'}));
  let creates=0;
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/5/playback'&&r.method()==='POST')creates++;});
  await page.goto('/?video=5');await page.getByRole('button',{name:'继续播放',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
  await expect(page.getByRole('slider',{name:'视频完整进度'})).toHaveValue(/7[78]/);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await page.locator('.playback-diagnostics summary').click();
  for(const target of [39.9,23.4,10.2]) {
    await page.getByRole('slider',{name:'视频完整进度'}).evaluate((input:HTMLInputElement,value:number)=>{
      input.value=String(value);input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    },target);
    await expect(page.getByLabel('跳播耗时')).toHaveText(/已有分段复用 · [\d.]+ (ms|秒)/);
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(target,0);
    expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
  }
  expect(creates).toBe(2);
});
