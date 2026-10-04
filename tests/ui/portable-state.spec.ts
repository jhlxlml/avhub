import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({request})=>{await request.post('/test/reset');});
async function ready(page:Page) {
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2 && !v.paused)).toBeTruthy();
}

test('SQLite restores preferences with empty browser storage and loads only the current subtitle',async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{audio:{volume:.35,muted:true},playbackSpeed:1.5,subtitleAppearance:{size:38,color:'#ffe38a',background:.85},hoverPreview:true,queueOpen:true,queueMode:'repeat-one',autoNext:false,'subtitle.1':{id:'',delay:0}}}});
  await page.goto('/?root=1&video=1');
  await expect(page.getByRole('combobox',{name:'字幕字号'})).toHaveValue('38');
  await expect(page.getByRole('combobox',{name:'播放模式'})).toHaveValue('repeat-one');
  await expect(page.getByRole('checkbox',{name:'自动连播'})).not.toBeChecked();
  await page.getByRole('button',{name:'从头开始',exact:true}).click();await ready(page);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>[v.volume,v.muted,v.playbackRate])).toEqual([.35,true,1.5]);
  await page.getByRole('combobox',{name:'字幕轨道'}).selectOption({label:'source.srt'});
  await page.getByRole('button',{name:'字幕延迟增加 0.1 秒'}).click();
  await expect.poll(async()=>(await(await request.get('/api/preferences/subtitle/1')).json()).value?.delay).toBe(.1);
  await page.evaluate(()=>localStorage.clear());await page.reload();
  await expect(page).toHaveURL(/video=1/);
  await expect(page.getByLabel('当前字幕延迟')).toHaveText('+0.1 秒');
  await expect(page.getByRole('combobox',{name:'字幕轨道'})).toHaveValue(/source\.srt$/);
  await expect(page.getByRole('combobox',{name:'字幕字号'})).toHaveValue('38');
  await expect(page.getByRole('combobox',{name:'播放模式'})).toHaveValue('repeat-one');
  await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
  await page.getByRole('button',{name:'媒体库设置'}).click();
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'封面悬停预览'})).toBeChecked();
  expect((await(await request.get('/api/preferences')).json()).values['subtitle.1']).toBeUndefined();
});

test('legacy migration ignores malformed values and never overwrites database preferences',async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{playbackSpeed:1.25}}});
  await page.addInitScript(()=>{localStorage.setItem('avhub.playbackSpeed','2');localStorage.setItem('avhub.audio',JSON.stringify({volume:.4,muted:false}));localStorage.setItem('avhub.subtitleAppearance','{"size":999}');});
  await page.goto('/?video=2');await ready(page);
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>[v.volume,v.playbackRate])).toEqual([.4,1.25]);
  await expect(page.getByRole('combobox',{name:'字幕字号'})).toHaveValue('30');
  const values=(await(await request.get('/api/preferences')).json()).values;
  expect(values.playbackSpeed).toBe(1.25);expect(values.audio.volume).toBe(.4);
});

test('failed preference write is visible and retry persists the latest value',async({page,request})=>{
  await page.goto('/?video=2');await ready(page);
  await page.route('**/api/preferences',async route=>{if(route.request().method()==='PATCH')await route.fulfill({status:503,json:{detail:'测试设置失败'}});else await route.continue();});
  await page.getByRole('combobox',{name:'字幕字号'}).selectOption('38');
  await expect(page.getByRole('button',{name:'重试保存设置'})).toBeVisible();
  await page.unroute('**/api/preferences');
  await page.getByRole('button',{name:'重试保存设置'}).click();
  await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.subtitleAppearance?.size).toBe(38);
});

test('refresh and browser history preserve watch filters, scroll, current video and progress',async({page,request})=>{
  await page.goto('/?root=1&watch=unwatched');
  await expect(page.locator('.card')).toHaveCount(48);
  await page.evaluate(()=>{
    window.scrollTo(0,750);
    document.querySelector<HTMLButtonElement>('[aria-label="播放 视频 003"]')!.click();
  });await ready(page);
  await expect(page).toHaveURL(/watch=unwatched.*video=3/);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.currentTime=30;v.pause();});
  await expect.poll(async()=>(await(await request.get('/api/media/3')).json()).progress).toBeGreaterThanOrEqual(30);
  await page.reload();await expect(page.getByText('继续上次观看？')).toBeVisible();
  await expect(page).toHaveURL(/video=3/);
  await page.evaluate(()=>history.back());
  await expect(page.locator('.player-shell')).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'观看状态'})).toHaveValue('unwatched');
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(750);
  await page.evaluate(()=>history.forward());
  await expect(page.locator('.player-top')).toContainText('视频 003');
  await expect(page.getByText('继续上次观看？')).toBeVisible();
});

test('browser Back rolls back its URL on save failure and succeeds on retry',async({page})=>{
  await page.goto('/?q=003');
  await page.getByRole('button',{name:'播放 视频 003',exact:true}).click();await ready(page);
  await page.route('**/api/media/3/progress',route=>route.fulfill({status:500,json:{detail:'测试返回保存失败'}}));
  await page.evaluate(()=>history.back());
  await expect(page.getByRole('alert')).toContainText('测试返回保存失败');
  await expect(page).toHaveURL(/video=3/);
  await expect(page.locator('.player-top')).toContainText('视频 003');
  await page.unroute('**/api/media/3/progress');
  await page.evaluate(()=>history.back());
  await expect(page.locator('.player-shell')).toHaveCount(0);
  await expect(page).not.toHaveURL(/video=/);
  await expect(page.getByRole('textbox',{name:'搜索视频'})).toHaveValue('003');
});

test('playlist refresh retains context and invalid routes recover safely',async({page,request})=>{
  const list=await(await request.post('/api/playlists',{data:{name:'恢复片单'}})).json();
  for(const id of [1,2])await request.post(`/api/playlists/${list.id}/items/${id}`);
  await page.goto(`/?video=2&playlist=${list.id}`);await ready(page);
  await page.reload();await expect(page.locator('.player-top')).toContainText('视频 002');
  await expect(page.locator('.queue-heading')).toContainText('恢复片单');
  await page.goto('/?video=2&playlist=999999');
  await expect(page.locator('.player-top')).toContainText('视频 002');
  await expect(page).not.toHaveURL(/playlist=/);
  await expect(page.getByRole('alert')).toContainText('片单上下文无法恢复');
  await page.goto('/?video=999999&q=003');
  await expect(page.getByRole('button',{name:'播放 视频 003',exact:true})).toBeVisible();
  await expect(page).not.toHaveURL(/video=/);
  await expect(page.getByRole('alert')).toContainText('无法恢复播放页');
});

test('manual watched status survives autosave, can return to automatic and never invents progress',async({page,request})=>{
  await page.goto('/?q=002');
  await page.getByRole('button',{name:'更多操作 视频 002'}).click();
  await page.getByRole('menuitem',{name:'标记为已看',exact:true}).click();
  // A read-only WAL snapshot is allowed to see the previous committed state
  // while the UI's write is still in flight. Wait for its completion signal.
  await expect(page.getByRole('menu')).toHaveCount(0);
  let media=await(await request.get('/api/media/2')).json();
  expect([media.watched,media.progress,media.last_played]).toEqual([1,0,0]);
  await page.getByRole('button',{name:'播放 视频 002',exact:true}).click();await ready(page);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.currentTime=20;v.pause();});
  await expect.poll(async()=>(await(await request.get('/api/media/2')).json()).progress).toBeGreaterThanOrEqual(20);
  media=await(await request.get('/api/media/2')).json();expect(media.watched).toBe(1);
  await page.getByRole('button',{name:'更多操作 视频 002'}).click();
  await page.getByRole('menuitem',{name:'恢复自动已看判断'}).click();
  await expect.poll(async()=>(await(await request.get('/api/media/2')).json()).manual_watched).toBeNull();
  expect((await(await request.get('/api/media/2')).json()).watched).toBe(0);
});

test('path actions use the indexed ID, external playback asks permission, and menus ignore player keys',async({page})=>{
  const calls:string[]=[];
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{(window as any).__copied=value;}}}));
  await page.route('**/api/media/2/native/*',route=>{calls.push(route.request().url().split('/').pop()!);return route.fulfill({json:{ok:true}});});
  await page.goto('/?video=2');await ready(page);
  const more=page.getByRole('button',{name:'更多操作 视频 002'});
  await more.click();await page.keyboard.press('r');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem',{name:'复制视频路径'})).toBeFocused();
  await page.screenshot({path:'test-results/player-more-menu.png'});
  await expect(page.getByRole('button',{name:'旋转视频，当前 0 度'})).toBeVisible();
  await page.getByRole('menuitem',{name:'复制视频路径'}).click();
  expect(await page.evaluate(()=>(window as any).__copied)).toMatch(/second\.mp4$/);
  await more.click();await page.getByRole('menuitem',{name:'在资源管理器中显示'}).click();
  await more.click();page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('menuitem',{name:'用系统播放器打开'}).click();
  expect(calls).toEqual(['reveal']);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('menuitem',{name:'用系统播放器打开'}).click();
  expect(calls).toEqual(['reveal','open']);
});

test('return refreshes watched filters after a manual mark in the player',async({page})=>{
  await page.goto('/?q=002&watch=unwatched');
  await page.getByRole('button',{name:'播放 视频 002',exact:true}).click();await ready(page);
  await page.getByRole('button',{name:'更多操作 视频 002'}).click();
  await page.getByRole('menuitem',{name:'标记为已看',exact:true}).click();
  await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
  await expect(page.getByRole('heading',{name:'暂无匹配的视频'})).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'观看状态'})).toHaveValue('unwatched');
});

test('a late old progress response cannot clear a newer save failure',async({page})=>{
  await page.goto('/?q=003');
  await page.getByRole('button',{name:'播放 视频 003',exact:true}).click();await ready(page);
  let held=false,completed=false,release!:()=>void,arrived!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const started=new Promise<void>(resolve=>arrived=resolve);
  await page.route('**/api/media/3/progress',async route=>{
    if(!held){held=true;const response=await route.fetch();arrived();await gate;await route.fulfill({response});completed=true;}
    else await route.fulfill({status:500,json:{detail:'较新的进度保存失败'}});
  });
  try {
    await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.currentTime=18;v.pause();});await started;
    await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
    await expect(page.getByRole('alert')).toContainText('较新的进度保存失败');
    release();await expect.poll(()=>completed).toBeTruthy();
    await expect(page.getByRole('alert')).toContainText('较新的进度保存失败');
  }finally{release();}
  await page.unroute('**/api/media/3/progress');
  await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
  await expect(page.locator('.player-shell')).toHaveCount(0);
});

test('repeat-one respects disabled autoplay; random next and N save before replacing the route',async({page,request})=>{
  const list=await(await request.post('/api/playlists',{data:{name:'模式片单'}})).json();
  for(const id of [2,3])await request.post(`/api/playlists/${list.id}/items/${id}`);
  await page.goto(`/?video=2&playlist=${list.id}`);await ready(page);
  await page.getByRole('button',{name:'展开待播队列'}).click();
  await page.getByRole('combobox',{name:'播放模式'}).selectOption('repeat-one');
  await page.getByRole('checkbox',{name:'自动连播'}).uncheck();
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.dispatchEvent(new Event('ended'));});
  await expect(page.getByText('单条循环：视频 002')).toBeVisible();
  await expect(page.getByText('自动连播已关闭')).toBeVisible();
  await page.getByRole('button',{name:'立即重新播放'}).click();await ready(page);
  await expect(page).toHaveURL(/video=2/);
  await page.getByRole('combobox',{name:'播放模式'}).selectOption('random');
  await page.locator('.playback-queue').screenshot({path:'test-results/queue-playback-modes.png'});
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.currentTime=25;});
  await page.locator('.player-info h2').click();await page.keyboard.press('n');
  await expect(page.locator('.player-top')).toContainText('视频 003');
  await expect(page).toHaveURL(/video=3/);
  expect((await(await request.get('/api/media/2')).json()).progress).toBeGreaterThanOrEqual(25);
  await expect(page.getByRole('combobox',{name:'播放模式'})).toHaveValue('random');
  await expect(page.getByRole('checkbox',{name:'自动连播'})).not.toBeChecked();
});
