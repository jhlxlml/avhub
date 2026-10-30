import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');await request.post('/test/thumbnail-fixture');});
test('stalled hover releases its source after a bounded deadline without transcoding or retry',async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{hoverPreview:true}}});
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let reads=0,playback=0;
  await page.route('**/media/*/file',async route=>{reads++;await gate;await route.abort().catch(()=>{});});
  page.on('request',r=>{if(r.method()==='POST'&&/\/api\/media\/\d+\/playback/.test(r.url()))playback++;});
  try{
    await page.goto('/?sort=name');await page.clock.install();
    const card=page.locator('.card').first();await card.locator('.cover').hover();await page.clock.runFor(700);
    await expect(card.locator('.hover-preview')).toHaveCount(1);await expect.poll(()=>reads).toBeGreaterThan(0);
    await card.evaluate(e=>{(window as any).__timedPreview=e.querySelector('.hover-preview');});
    await page.clock.runFor(7000);
    await card.locator('.hover-preview').dispatchEvent('stalled'); // cannot extend the original deadline
    await page.clock.runFor(1100);await expect(card.locator('.hover-preview')).toHaveCount(0);
    expect(await page.evaluate(()=>(window as any).__timedPreview.getAttribute('src'))).toBeNull();
    await expect(card.locator('.thumbnail-ready')).toBeVisible();
    const attempts=reads;await page.clock.runFor(10000);expect(reads).toBe(attempts);expect(playback).toBe(0);
  }finally{release();}
});
for(const theme of ['dark','light'])test(`${theme}: favorite hides like playlist action and preserves the decoded preview and cover`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{hoverPreview:true}}});
  await page.goto('/?sort=name');
  if(theme==='light')await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  const card=page.locator('.card').first(),cover=card.locator('.cover'),star=card.locator('.star');
  await page.mouse.move(0,0);
  await expect(star).toHaveCSS('opacity','0');await expect(card.locator('.queue-add')).toHaveCSS('opacity','0');
  await page.keyboard.press('Tab');await star.focus();await expect(star).toHaveCSS('opacity','1');
  await page.getByRole('button',{name:'搜索视频',exact:true}).focus();await page.mouse.move(0,0);await expect(star).toHaveCSS('opacity','0');
  await cover.hover();await expect(star).toHaveCSS('opacity','1');
  await expect(card.locator('.thumbnail-ready')).toBeVisible();await expect(cover.locator('.hover-preview.visible')).toBeVisible();
  const queries:string[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media')queries.push(r.url());});
  await card.evaluate(element=>{
    const state:any={card:element,img:element.querySelector('img'),video:element.querySelector('video'),removed:0,loads:0};
    state.frames=state.video.getVideoPlaybackQuality().totalVideoFrames;state.src=state.video.currentSrc;
    state.video.addEventListener('loadstart',()=>state.loads++);
    new MutationObserver(records=>{for(const r of records)for(const node of r.removedNodes)if(node===state.card||node===state.img||node===state.video||(node instanceof Element&&(node.contains(state.img)||node.contains(state.video))))state.removed++;})
      .observe(document.querySelector('.media-grid')!,{childList:true,subtree:true});
    (window as any).favoriteStable=state;
  });
  await star.click();await expect(star).toHaveAttribute('aria-pressed','false');
  expect(await card.evaluate(element=>{const s=(window as any).favoriteStable;return element===s.card&&element.querySelector('img')===s.img&&element.querySelector('video')===s.video&&s.video.currentSrc===s.src&&s.removed===0&&s.loads===0;})).toBe(true);
  await expect.poll(()=>page.evaluate(()=>{const s=(window as any).favoriteStable;return s.video.getVideoPlaybackQuality().totalVideoFrames>s.frames&&!s.video.paused;})).toBe(true);
  expect(queries).toHaveLength(0);
  await page.mouse.move(0,0);await expect(star).toHaveCSS('opacity','0');
  await page.screenshot({path:`test-results/favorite-hidden-${theme}.png`});
});
test('failed favorite write preserves the old state and mounted cover',async({page})=>{
  await page.goto('/?sort=name');const card=page.locator('.card').first();await card.locator('.cover').hover();await expect(card.locator('.thumbnail-ready')).toBeVisible();
  await card.evaluate(e=>{(window as any).oldFavoriteImage=e.querySelector('img');});
  await page.route('**/api/media/1/favorite',r=>r.fulfill({status:503,json:{detail:'收藏保存测试失败'}}));
  await card.locator('.star').click();await expect(page.getByRole('alert')).toContainText('收藏保存测试失败');
  await expect(card.locator('.star')).toHaveAttribute('aria-pressed','true');
  expect(await card.evaluate(e=>e.querySelector('img')===(window as any).oldFavoriteImage)).toBe(true);
});

test('favorite finishing after tab switch refreshes the active classification',async({page,request})=>{
  await page.goto('/?sort=name');
  const card=page.locator('.card').filter({has:page.getByRole('button',{name:'播放 视频 002',exact:true})});
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
  await page.route('**/api/media/2/favorite',async route=>{entered();await gate;await route.continue();});
  try{
    await card.locator('.cover').hover();await card.locator('.star').click();await started;
    const oldRead=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/media'&&r.url().includes('favorite=true'));
    await page.getByRole('navigation',{name:'视频分类'}).getByRole('button',{name:'收藏',exact:true}).click();
    await (await oldRead).finished();await expect(page.locator('.card')).toHaveCount(1);
    release();
    await expect(page.getByRole('button',{name:'播放 视频 002',exact:true})).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(2);
    expect((await (await request.get('/api/media?favorite=true&page=1')).json()).total).toBe(2);
  }finally{release();}
});

test('a pre-mutation read cannot overwrite a successful favorite on the same page',async({page})=>{
  await page.goto('/?sort=name');await expect(page.locator('.card')).toHaveCount(48);
  const nav=page.getByRole('navigation',{name:'视频分类'});
  await nav.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
  await page.clock.install();await page.clock.fastForward(21000);
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);let reads=0;
  await page.route('**/api/media?*',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get('favorite')==='true'){await route.continue();return;}
    reads++;
    if(reads===1){const old=await route.fetch();entered();await gate;await route.fulfill({response:old});}
    else await route.continue();
  });
  try{
    await nav.getByRole('button',{name:'全部视频',exact:true}).click();await started;
    const card=page.locator('.card').filter({has:page.getByRole('button',{name:'播放 视频 002',exact:true})}),star=card.locator('.star');
    await card.locator('.cover').hover();await star.click();await expect(star).toHaveAttribute('aria-pressed','true');
    release();await expect.poll(()=>reads).toBeGreaterThanOrEqual(2);
    await expect(star).toHaveAttribute('aria-pressed','true');await expect(page.locator('.card')).toHaveCount(48);
  }finally{release();}
});
