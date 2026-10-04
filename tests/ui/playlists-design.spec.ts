import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function fixture(request:APIRequestContext,name='周末影院 · 精选片单') {
  await request.post('/test/thumbnail-fixture');
  const list=await(await request.post('/api/playlists',{data:{name}})).json();
  for(const id of [1,2,3,4,5])await request.post(`/api/playlists/${list.id}/items/${id}`);
  return list;
}
async function open(page:Page) {
  await page.goto('/');await page.getByRole('button',{name:'播放列表',exact:true}).click();
  await expect(page.locator('.playlist-summary')).toBeVisible();
}

for(const theme of ['dark','light'])test(`${theme}: playlist has a cover summary, video thumbnails and stable searchable cover`,async({page,request})=>{
  const list=await fixture(request);
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  const requests:string[]=[];page.on('request',r=>{if(r.url().includes(`/api/playlists/${list.id}`))requests.push(r.url());});
  await open(page);
  await expect(page.locator('.playlist-video-items>li')).toHaveCount(5);
  await expect(page.locator('.playlist-hero-cover .thumbnail-ready')).toBeVisible();
  await expect(page.locator('.playlist-video-cover').first().locator('.thumbnail-ready')).toBeVisible();
  await expect(page.locator('.playlist-video-cover').first()).toContainText('02:00');
  await expect(page.locator('.playlist-video-progress')).toHaveCount(1);
  const cover=await page.locator('.playlist-hero-cover img').getAttribute('src');
  const summary=await page.locator('.playlist-summary').boundingBox(),videos=await page.locator('.playlist-videos').boundingBox();
  expect(summary!.x+summary!.width).toBeLessThan(videos!.x);
  await page.locator('.playlist-workspace').screenshot({path:`test-results/playlist-${theme}-desktop.png`});
  await page.getByRole('searchbox',{name:'搜索播放列表视频'}).fill('003');
  await expect(page.locator('.playlist-video-items>li')).toHaveCount(1);
  await expect(page.locator('.playlist-hero-cover img')).toHaveAttribute('src',cover!);
  await expect(page.locator('.playlist-summary')).toContainText('5 个视频');
  await page.getByRole('searchbox',{name:'搜索播放列表视频'}).fill('no-matching-title');
  await expect(page.getByText('没有匹配的视频',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'从头播放',exact:true})).toBeEnabled();
  expect(requests.filter(url=>/\?/.test(url)).every(url=>url.includes('page_size=40'))).toBeTruthy();
});

test('rename, reorder and removal retain persisted order and update the cover',async({page,request})=>{
  const list=await fixture(request);await open(page);
  await page.getByRole('button',{name:'下移 视频 001',exact:true}).click();
  await expect(page.locator('.playlist-item-title').first()).toHaveText('视频 002');
  await page.getByRole('button',{name:'重命名列表',exact:true}).click();
  await page.getByRole('textbox',{name:'重命名播放列表'}).fill('新的精选片单');
  await page.getByRole('button',{name:'保存列表名称'}).click();
  await expect(page.getByRole('heading',{name:'新的精选片单',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'从播放列表移除 视频 002',exact:true}).click();
  await expect(page.locator('.playlist-item-title')).toHaveCount(4);
  await expect(page.locator('.playlist-item-title').first()).toHaveText('视频 001');
  const detail=await(await request.get(`/api/playlists/${list.id}?page=1&page_size=40`)).json();
  expect(detail.name).toBe('新的精选片单');expect(detail.items.map((item:any)=>item.id)).toEqual([1,3,4,5]);
  await page.getByRole('button',{name:'完成',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'播放列表',exact:true}).click();
  await expect(page.getByRole('heading',{name:'新的精选片单',exact:true})).toBeVisible();
});

test('random play starts outside the first row and respects disabled autoplay',async({page,request})=>{
  const list=await fixture(request);
  await request.patch('/api/preferences',{data:{values:{autoNext:false,queueMode:'sequential'}}});
  await open(page);
  let fullScope=false;
  await page.route(`**/api/playlists/${list.id}/queue?**`,async route=>{
    if(new URL(route.request().url()).searchParams.has('media_id')){await route.continue();return;}
    expect(new URL(route.request().url()).searchParams.get('shuffle')).toBe('true');
    fullScope=true;
    const response=await request.get(`/api/playlists/${list.id}/queue?media_id=2&page_size=40`);
    await route.fulfill({json:await response.json()});
  });
  await page.getByRole('button',{name:'随机播放列表',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`video=2.*playlist=${list.id}`));expect(fullScope).toBeTruthy();
  await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values).toMatchObject({queueMode:'random',autoNext:false});
  await page.unrouteAll({behavior:'wait'});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
});

test('empty state, unavailable cover and all-offline list remain usable',async({page,request})=>{
  const list=await(await request.post('/api/playlists',{data:{name:'空片单'}})).json();
  await open(page);
  await expect(page.getByRole('button',{name:'从头播放',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'随机播放列表'})).toBeDisabled();
  await expect(page.locator('.playlist-hero-cover').getByRole('img',{name:'暂无预览图'})).toBeVisible();
  await expect(page.getByText('列表为空，可在视频封面上点击“加入播放列表”。')).toBeVisible();
  await page.getByRole('button',{name:'删除列表',exact:true}).click({trial:true});
  // The existing delete confirmation must still protect a list.
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'删除列表',exact:true}).click();
  await expect(page.getByText(/还没有播放列表/)).toBeVisible();
  expect((await request.get(`/api/playlists/${list.id}?page=1`)).status()).toBe(404);
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await fixture(request,'离线片单');
  for(const id of [1,2,3,4,5])await request.post(`/test/media/${id}/missing`);
  await open(page);
  await expect(page.locator('.playlist-summary')).toContainText('5 个视频 · 0 个可播放');
  await expect(page.getByRole('button',{name:'从头播放',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'随机播放列表'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'不可播放 视频 001（文件离线）'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'从播放列表移除 视频 001',exact:true})).toBeEnabled();
});

for(const width of [320,560,820])test(`playlist adapts to ${width}px without clipping controls or scroll`,async({page,request})=>{
  await fixture(request,'一个非常长的播放列表名字用于核查窄窗口布局与自然换行');
  await page.setViewportSize({width,height:850});await open(page);
  const dialog=page.getByRole('dialog',{name:'播放列表',exact:true});
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
  const controls=dialog.locator('button,input');
  const bounds=await dialog.boundingBox();
  for(const box of await controls.evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right};}))) {
    expect(box.left).toBeGreaterThanOrEqual(bounds!.x-1);expect(box.right).toBeLessThanOrEqual(bounds!.x+bounds!.width+1);
  }
  await dialog.screenshot({path:`test-results/playlist-narrow-${width}.png`});
  await page.getByRole('button',{name:'重命名列表',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'重命名播放列表'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button',{name:'播放列表',exact:true})).toBeFocused();
});
