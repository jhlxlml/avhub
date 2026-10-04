import {test,expect,type Page} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function open(page:Page,id=2) {
  await page.goto(`/?video=${id}`);
  if(id===1)await page.getByRole('button',{name:'从头开始',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
}

test('fast native seeks never flash a loading indicator or reload the source, including paused seeks',async({page})=>{
  const requests:string[]=[];
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/2/playback'&&r.method()==='POST')requests.push(r.url());});
  let startups=0;
  await page.addInitScript(()=>{
    (window as any).seekFeedback={indicators:0,loads:0,seeks:0};
    document.addEventListener('loadstart',e=>{if(e.target instanceof HTMLVideoElement)(window as any).seekFeedback.loads++;},true);
    document.addEventListener('seeking',e=>{if(e.target instanceof HTMLVideoElement)(window as any).seekFeedback.seeks++;},true);
    new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes)
        if(node instanceof Element&&node.matches('.buffering,.resume[role="status"]'))(window as any).seekFeedback.indicators++;
    }).observe(document,{childList:true,subtree:true});
  });
  await open(page);
  const initial=await page.evaluate(()=>(window as any).seekFeedback);
  // Starting at zero must not issue a redundant seek to zero.
  expect(initial.seeks).toBe(0);startups=initial.loads;
  await page.locator('.playback-diagnostics summary').click();
  for(const paused of [false,true]) {
    if(paused)await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
    for(const target of [90,15,65,30]) {
      await page.getByRole('slider',{name:'视频完整进度'}).evaluate((input:HTMLInputElement,value)=>{
        input.value=String(value);input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      },target);
      await expect(page.getByLabel('跳播耗时')).toHaveAttribute('data-target',String(target));
      await expect(page.getByLabel('跳播耗时')).toHaveText(/原片按需读取 · [\d.]+ (ms|秒)/);
      await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.seeking)).toBeFalsy();
      expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(paused);
    }
  }
  await page.waitForTimeout(450);
  const final=await page.evaluate(()=>(window as any).seekFeedback);
  expect(final.indicators).toBe(initial.indicators);expect(final.loads).toBe(startups);expect(requests).toHaveLength(1);
});

test('transient waiting and healthy stalled downloads do not show feedback; genuine paused waits do',async({page})=>{
  await open(page);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await page.clock.install();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{
    Object.defineProperty(v,'readyState',{configurable:true,value:4});
    v.dispatchEvent(new Event('stalled'));
  });
  await page.clock.runFor(600);
  await expect(page.locator('.buffering')).toHaveCount(0);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{
    Object.defineProperty(v,'readyState',{configurable:true,value:1});
    v.dispatchEvent(new Event('waiting'));
  });
  await page.clock.runFor(200);
  await expect(page.locator('.buffering')).toHaveCount(0);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{
    Object.defineProperty(v,'readyState',{configurable:true,value:4});v.dispatchEvent(new Event('canplay'));
  });
  await page.clock.runFor(500);await expect(page.locator('.buffering')).toHaveCount(0);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{
    Object.defineProperty(v,'readyState',{configurable:true,value:1});v.dispatchEvent(new Event('waiting'));
  });
  // Repeated events must not keep resetting the deadline of a real wait.
  await page.clock.runFor(200);
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('stalled')));
  await page.clock.runFor(200);await expect(page.locator('.buffering')).toBeVisible();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{
    Object.defineProperty(v,'readyState',{configurable:true,value:2});v.dispatchEvent(new Event('seeked'));
  });
  await expect(page.locator('.buffering')).toHaveCount(0);
  await page.clock.runFor(1000);await expect(page.locator('.buffering')).toHaveCount(0);
});

test('playing needs future data while pause with a decoded frame does not',async({page})=>{
  await open(page);await page.clock.install();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{
    Object.defineProperty(v,'requestVideoFrameCallback',{configurable:true,value:undefined});
    Object.defineProperty(v,'readyState',{configurable:true,value:2});v.dispatchEvent(new Event('waiting'));
  });
  await page.clock.runFor(400);await expect(page.locator('.buffering')).toBeVisible();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await expect(page.locator('.buffering')).toHaveCount(0);
});

test('slow startup stays visible and does not leave stale feedback after retry or exit',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/media/2/playback',async route=>{
    const response=await route.fetch();await gate;await route.fulfill({response});
  });
  await page.goto('/?video=2');
  await expect(page.getByText('正在准备播放…',{exact:true})).toBeVisible();
  release();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3)).toBeTruthy();
  await expect(page.getByText('正在准备播放…',{exact:true})).toHaveCount(0);
  await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
  await expect(page.locator('.video-wrap')).toHaveCount(0);
  await page.waitForTimeout(450);await expect(page.locator('.buffering')).toHaveCount(0);
});

test('long-GOP remux resumes at a non-keyframe and uncached paused rewinds present the requested frame',async({page,request})=>{
  // Preserve regression coverage of the legacy windowed compatibility path.
  await page.route('**/api/media/5/playback',route=>route.continue({postData:JSON.stringify({...route.request().postDataJSON(),indexed_ts:false})}));
  await request.put('/api/media/5/progress',{data:{progress:77.3,watched:false,updated_at:1}});
  await page.route('**/media/5/file',route=>route.fulfill({status:404,body:'exercise lossless fallback'}));
  await page.goto('/?video=5');
  await page.getByRole('button',{name:'继续播放',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=3&&!v.paused)).toBeTruthy();
  await expect(page.getByRole('slider',{name:'视频完整进度'})).toHaveValue(/7[78]/);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
  await page.locator('.playback-diagnostics summary').click();
  for(const target of [39.9,23.4,10.2]) {
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/media/5/playback'&&r.request().method()==='POST');
    await page.getByRole('slider',{name:'视频完整进度'}).evaluate((input:HTMLInputElement,value:number)=>{
      input.value=String(value);input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    },target);
    const session=await (await response).json();
    expect(session.mode).toBe('remux');expect(session.start).toBe(target);
    expect(session.offset).toBeCloseTo(Math.max(0,target-10));
    await expect(page.getByLabel('跳播耗时')).toHaveText(/重新准备播放流 · [\d.]+ (ms|秒)/);
    await expect(page.locator('.seek-frame')).toBeHidden();
    expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBeTruthy();
    // Paused frame must be the actual requested point, not the following GOP.
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement,offset:number)=>v.currentTime+offset,session.offset)).toBeCloseTo(target,0);
  }
  await expect.poll(async()=> (await (await request.get('/test/sessions')).json()).count).toBe(1);
});

test('completed remux near the actual tail never waits indefinitely for a slightly longer indexed duration',async({page,request})=>{
  await request.put('/api/media/5/progress',{data:{progress:119.8,watched:false,updated_at:1}});
  await page.route('**/media/5/file',route=>route.fulfill({status:404,body:'exercise lossless fallback'}));
  // Simulate a stream that is complete a fraction earlier than its indexed tail.
  const shorten=async (route:import('@playwright/test').Route)=>{
    const response=await route.fetch({...(route.request().method()==='POST'?{postData:JSON.stringify({...route.request().postDataJSON(),indexed_ts:false})}:{})});const body=await response.json();
    if(body.state==='ready'&&body.token) {
      body.complete=true;body.window_end=119.82;
    }
    await route.fulfill({response,json:body});
  };
  await page.route('**/api/media/5/playback',shorten);
  await page.route('**/api/playback/*',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    await shorten(route);
  });
  await page.goto('/?video=5');
  await page.getByRole('button',{name:'继续播放',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.videoWidth===320)).toBeTruthy();
  await expect(page.getByText('正在准备播放…',{exact:true})).toHaveCount(0);
  await expect(page.getByText('暂时无法播放',{exact:true})).toHaveCount(0);
});
