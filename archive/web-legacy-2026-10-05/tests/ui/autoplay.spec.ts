import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function settings(page:Page) {
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
}
async function ready(page:Page) {
  const restart=page.getByRole('button',{name:'从头开始',exact:true});
  await expect.poll(async()=>{
    if(await restart.isVisible())await restart.click();
    return page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused);
  }).toBeTruthy();
}
async function episodes(request:APIRequestContext) {
  const first=await(await request.patch('/api/media/1',{data:{kind:'episode',title:'第一集',series_title:'连播测试剧',season:0,episode:1}})).json();
  for(const [id,season,episode,title] of [[3,1,2,'第二集'],[2,2,1,'第三集']] as const) {
    const response=await request.patch(`/api/media/${id}`,{data:{kind:'episode',title,series_id:first.series_id,season,episode}});
    expect(response.ok()).toBeTruthy();
  }
}
async function finish(page:Page) {
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.dispatchEvent(new Event('ended'));});
}

test('settings and queue share portable autoplay preferences across reloads',async({page,request})=>{
  await page.goto('/');await settings(page);
  await expect(page.getByRole('checkbox',{name:'视频连播',exact:true})).toBeChecked();
  await expect(page.getByRole('combobox',{name:'连播模式',exact:true})).toHaveValue('sequential');
  await expect(page.getByRole('combobox',{name:'连播范围',exact:true})).toHaveValue('series');
  await page.getByRole('checkbox',{name:'视频连播',exact:true}).uncheck();
  await page.getByRole('combobox',{name:'连播模式',exact:true}).selectOption('random');
  await page.getByRole('combobox',{name:'连播范围',exact:true}).selectOption('directory');
  await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values).toMatchObject({autoNext:false,queueMode:'random',queueScope:'directory'});
  await page.getByRole('button',{name:'关闭设置'}).click();
  await page.goto('/?video=2');await ready(page);
  await page.getByRole('button',{name:'展开待播队列'}).click();
  await expect(page.getByRole('checkbox',{name:'自动连播',exact:true})).not.toBeChecked();
  await expect(page.getByRole('combobox',{name:'播放模式',exact:true})).toHaveValue('random');
  await expect(page.getByRole('combobox',{name:'队列连播范围'})).toHaveValue('directory');
  await page.getByRole('checkbox',{name:'自动连播',exact:true}).check();
  await page.getByRole('combobox',{name:'播放模式',exact:true}).selectOption('sequential');
  await page.getByRole('combobox',{name:'队列连播范围'}).selectOption('series');
  await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values).toMatchObject({autoNext:true,queueMode:'sequential',queueScope:'series'});
  await page.evaluate(()=>localStorage.clear());await page.goto('/');await settings(page);
  await expect(page.getByRole('checkbox',{name:'视频连播',exact:true})).toBeChecked();
  await expect(page.getByRole('combobox',{name:'连播模式',exact:true})).toHaveValue('sequential');
  await expect(page.getByRole('combobox',{name:'连播范围',exact:true})).toHaveValue('series');
});

test('default series autoplay follows seasons and saves completion before switching once',async({page,request})=>{
  await episodes(request);
  expect((await request.put('/api/media/3/progress',{data:{progress:24,updated_at:Date.now()}})).ok()).toBeTruthy();
  await page.goto('/?video=1');await ready(page);
  await expect(page.locator('.queue-heading')).toContainText('同剧集 · 连播测试剧');
  await finish(page);await finish(page);
  await expect(page.getByText('下一集：第二集 · 第 1 季 第 2 集')).toBeVisible();
  await expect(page).toHaveURL(/video=3/,{timeout:14000});
  const saved=await(await request.get('/api/media/1')).json();
  expect(saved.watched).toBeTruthy();expect(saved.progress).toBe(120);
  // No resume button is clicked here: automatic continuation must play without
  // a confirmation, unlike manually opening an unfinished item.
  await expect(page.getByRole('button',{name:'继续播放',exact:true})).toHaveCount(0);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused&&v.currentTime>=24)).toBeTruthy();
  await expect(page.locator('.player-top')).toContainText('第二集');
});

test('last episode stops without leaking into unrelated directory videos',async({page,request})=>{
  await episodes(request);await page.goto('/?video=2');await ready(page);
  await finish(page);await expect(page.getByText('播放结束',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'立即播放下一集'})).toHaveCount(0);
  await expect(page.getByText(/秒后自动播放/)).toHaveCount(0);
  await expect(page).toHaveURL(/video=2/);
});

test('shuffle stays within the same series and manual next works with autoplay disabled',async({page,request})=>{
  await episodes(request);
  await request.patch('/api/preferences',{data:{values:{autoNext:false,queueMode:'random'}}});
  await page.goto('/?video=1');await ready(page);await finish(page);
  await expect(page.getByText(/随机下一条：(第二集|第三集)/)).toBeVisible();
  await expect(page.getByText('自动连播已关闭')).toBeVisible();
  await expect(page.getByText(/秒后自动播放/)).toHaveCount(0);
  await page.getByRole('button',{name:'立即播放下一条'}).click();
  await expect(page).toHaveURL(/video=(2|3)/);
});

test('turning autoplay off during countdown cancels the pending transition',async({page,request})=>{
  await episodes(request);await page.goto('/?video=1');await ready(page);
  await page.getByRole('button',{name:'展开待播队列'}).click();await finish(page);
  await expect(page.getByText(/秒后自动播放/)).toBeVisible();
  await page.getByRole('checkbox',{name:'自动连播',exact:true}).uncheck();
  await expect(page.getByText('自动连播已关闭')).toBeVisible();
  await page.clock.install();await page.clock.runFor(10000);
  await expect(page).toHaveURL(/video=1/);
});

test('enabled shuffle automatically plays another episode from the same series',async({page,request})=>{
  await episodes(request);
  await request.patch('/api/preferences',{data:{values:{queueMode:'random',autoNext:true}}});
  await page.goto('/?video=1');await ready(page);await finish(page);
  await expect(page.getByText(/随机下一条：(第二集|第三集)/)).toBeVisible();
  await expect(page).toHaveURL(/video=(2|3)/,{timeout:14000});
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBeTruthy();
});

test('ordinary video automatically advances within its directory and playlists override series',async({page,request})=>{
  // Root 1 has an MP4 and an MKV in the same actual directory.
  await request.post('/test/autoplay-fixture');
  await page.goto('/?video=1');await ready(page);await finish(page);
  await expect(page.getByText('下一条：视频 003')).toBeVisible();
  await page.getByRole('button',{name:'取消自动播放',exact:true}).click();
  await page.getByRole('button',{name:'立即播放下一条'}).click();
  await expect(page).toHaveURL(/video=3/);
  await episodes(request);
  const list=await(await request.post('/api/playlists',{data:{name:'跨剧列表'}})).json();
  for(const id of [1,2])await request.post(`/api/playlists/${list.id}/items/${id}`);
  await page.goto(`/?video=1&playlist=${list.id}`);await ready(page);await finish(page);
  await expect(page.getByText('播放列表下一条：第三集 · 第 2 季 第 1 集')).toBeVisible();
  await page.getByRole('button',{name:'立即播放下一条'}).click();
  await expect(page).toHaveURL(new RegExp(`video=2.*playlist=${list.id}`));
});

test('failed final save prevents autoplay and does not repeatedly retry',async({page,request})=>{
  await episodes(request);await page.goto('/?video=1');await ready(page);
  let writes=0;
  await page.route('**/api/media/1/progress',route=>{writes++;return route.fulfill({status:500,json:{detail:'连播进度保存测试失败'}});});
  await finish(page);await expect(page.getByText(/秒后自动播放/)).toBeVisible();
  await expect(page.getByText('自动连播已取消')).toBeVisible({timeout:14000});
  await expect(page.getByRole('alert')).toContainText('连播进度保存测试失败');
  const stoppedWrites=writes;
  await page.clock.install();await page.clock.runFor(4000);
  expect(writes).toBe(stoppedWrites);await expect(page).toHaveURL(/video=1/);
  await page.unroute('**/api/media/1/progress');
  await page.getByRole('button',{name:'立即播放下一集'}).click();
  await expect(page).toHaveURL(/video=3/);
});

for(const theme of ['dark','light'])test(`autoplay settings remain aligned in ${theme} narrow mode`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.setViewportSize({width:380,height:850});await page.goto('/');await settings(page);
  await expect(page.getByRole('combobox',{name:'连播范围',exact:true})).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
  await page.locator('.autoplay-settings').screenshot({path:`test-results/autoplay-${theme}-narrow.png`});
});

test('disabling autoplay while its final save is pending prevents the transition',async({page,request})=>{
  await episodes(request);await page.goto('/?video=1');await ready(page);
  await page.getByRole('button',{name:'展开待播队列'}).click();
  let holding=false,release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/media/1/progress',async route=>{
    const response=await route.fetch();
    if(holding)await gate;
    await route.fulfill({response});
  });
  try {
    await finish(page);await expect(page.getByText(/秒后自动播放/)).toBeVisible();holding=true;
    await expect(page.locator('.resume').getByText('正在切换…',{exact:true})).toBeVisible({timeout:14000});
    await page.getByRole('checkbox',{name:'自动连播',exact:true}).uncheck();release();
    await expect(page.getByText('自动连播已关闭')).toBeVisible();
    await expect(page.locator('.resume').getByText('正在切换…',{exact:true})).toHaveCount(0);
    await expect(page).toHaveURL(/video=1/);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
