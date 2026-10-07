import {test,expect} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

test('filter chips clear only their condition, reset pages, and preserve the category',async({page})=>{
  await page.goto('/?view=movies&q=002&format=mp4&watch=unwatched&page=2');
  const filters=page.getByRole('region',{name:'当前筛选条件'});
  await expect(filters.getByRole('button',{name:'移除筛选：搜索：002',exact:true})).toBeVisible();
  await filters.getByRole('button',{name:'移除筛选：搜索：002',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(filters.getByRole('button',{name:'移除筛选：格式：MP4',exact:true})).toBeFocused();
  await expect(page).toHaveURL(/view=movies/);expect(new URL(page.url()).searchParams.get('q')).toBeNull();
  await expect(page.getByRole('combobox',{name:'视频格式'})).toHaveValue('mp4');await expect(page.getByRole('combobox',{name:'观看状态'})).toHaveValue('unwatched');
  await filters.getByRole('button',{name:'清除全部筛选',exact:true}).click();
  await expect(filters).toHaveCount(0);await expect(page.getByRole('button',{name:'电影',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('clearing a season filter preserves the series detail and returns keyboard focus',async({page,request})=>{
  await request.patch('/api/media/2',{data:{kind:'episode',series_title:'季筛选验收',season:1,episode:1}});
  const groups=await(await request.get('/api/series?q=季筛选验收&page=1&page_size=48')).json();const id=groups.items[0].id;
  await page.goto(`/?view=series&grouped=true&show=${id}&season=1`);
  const summary=page.getByRole('region',{name:'当前筛选条件'});await summary.getByRole('button',{name:'移除筛选：季：第 1 季',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(summary).toHaveCount(0);expect(new URL(page.url()).searchParams.get('show')).toBe(String(id));expect(new URL(page.url()).searchParams.has('season')).toBe(false);
  await expect(page.getByRole('combobox',{name:'选择季',exact:true})).toBeFocused();
});

test('root-chip removal also clears subfolder scope and wide/compact resolution controls agree',async({page})=>{
  await page.goto('/?root=1&folder=sub-folder&recursive=false');
  await page.getByRole('region',{name:'当前筛选条件'}).getByRole('button',{name:/^移除筛选：目录：/}).click();
  expect(new URL(page.url()).searchParams.has('root')).toBe(false);expect(new URL(page.url()).searchParams.has('folder')).toBe(false);
  await page.setViewportSize({width:800,height:620});
  await page.getByRole('combobox',{name:'按分辨率筛选',exact:true}).selectOption('FHD');await expect(page).toHaveURL(/resolution=FHD/);
  expect(await page.locator('.toolbar').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.setViewportSize({width:1440,height:850});await expect(page.getByRole('button',{name:'筛选 FHD',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('background preferences live under directories and advanced playback remains opt-in',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'封面悬停预览',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await expect(page.getByRole('checkbox',{name:'封面悬停预览',exact:true})).not.toBeVisible();
  await expect(page.getByRole('checkbox',{name:'MKV 无损播放准备',exact:true})).not.toBeVisible();await page.getByText('高级播放设置',{exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'MKV 无损播放准备',exact:true})).toBeVisible();await expect(page.getByRole('checkbox',{name:'MKV 无损播放准备',exact:true})).not.toBeChecked();
});

test('batch join, duplicate membership, multi-remove and undo retain order',async({page,request})=>{
  const list=await(await request.post('/api/playlists',{data:{name:'批量片单',media_id:1}})).json();
  await page.goto('/?pageSize=24&sort=name');await page.getByRole('button',{name:'批量整理',exact:true}).click();
  for(const title of ['视频 001','视频 002','视频 003'])await page.getByRole('checkbox',{name:`选择 ${title}`,exact:true}).check();
  await page.getByRole('button',{name:'所选加入播放列表',exact:true}).click();await page.getByRole('button',{name:'添加到列表',exact:true}).click();
  await expect(page.getByText('已加入 2 个视频 · 1 个已在列表中',{exact:true})).toBeVisible();
  let result=await(await request.get(`/api/playlists/${list.id}?page=1`)).json();expect(result.items.map((item:any)=>item.id)).toEqual([1,2,3]);
  await page.getByRole('button',{name:'播放列表',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(3);
  await page.getByRole('button',{name:'多选视频',exact:true}).click();await page.getByRole('checkbox',{name:'选择片单视频 视频 001',exact:true}).check();await page.getByRole('checkbox',{name:'选择片单视频 视频 003',exact:true}).check();
  await page.getByRole('button',{name:'移除所选片单视频',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(1);
  await page.getByRole('button',{name:'撤销上次移除',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(3);
  result=await(await request.get(`/api/playlists/${list.id}?page=1`)).json();expect(result.items.map((item:any)=>item.id)).toEqual([1,2,3]);
});

test('undo refuses a concurrent membership change and refresh preserves that change',async({page,request})=>{
  const list=await(await request.post('/api/playlists',{data:{name:'并发片单'}})).json();for(const id of [1,2,3])await request.post(`/api/playlists/${list.id}/items/${id}`);
  await page.goto('/');await page.getByRole('button',{name:'播放列表',exact:true}).click();await page.getByRole('button',{name:'从播放列表移除 视频 002',exact:true}).click();
  await expect(page.locator('.playlist-item-title')).toHaveCount(2);await request.post(`/api/playlists/${list.id}/items/4`);
  await page.getByRole('button',{name:'撤销上次移除',exact:true}).click();await expect(page.getByRole('alert')).toContainText('内容已变化');
  await page.getByRole('button',{name:'刷新列表',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(3);await expect(page.getByRole('button',{name:'撤销上次移除',exact:true})).toBeDisabled();
  const result=await(await request.get(`/api/playlists/${list.id}?page=1`)).json();expect(result.items.map((item:any)=>item.id)).toEqual([1,3,4]);
});

test('new batch playlists are created atomically with the selected videos',async({page,request})=>{
  await page.goto('/?q=00');await page.getByRole('button',{name:'批量整理',exact:true}).click();
  for(const title of ['视频 002','视频 003'])await page.getByRole('checkbox',{name:`选择 ${title}`,exact:true}).check();
  await page.getByRole('button',{name:'所选加入播放列表',exact:true}).click();await page.getByRole('textbox',{name:'新播放列表名称',exact:true}).fill('新建批量验收');await page.getByRole('button',{name:'添加到列表',exact:true}).click();
  await expect(page.getByText('已创建“新建批量验收”并加入 2 个视频',{exact:true})).toBeVisible();
  const lists=await(await request.get('/api/playlists')).json();const list=lists.find((value:any)=>value.name==='新建批量验收');
  const detail=await(await request.get(`/api/playlists/${list.id}?page=1`)).json();expect(detail.items.map((value:any)=>value.id)).toEqual([2,3]);
});

test('playlist selections survive pagination and undo restores both pages',async({page,request})=>{
  const ids=Array.from({length:45},(_,index)=>index+1);const list=await(await request.post('/api/playlists',{data:{name:'跨页片单',media_ids:ids}})).json();
  await page.goto('/');await page.getByRole('button',{name:'播放列表',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(40);await page.getByRole('button',{name:'多选视频',exact:true}).click();
  for(const title of ['视频 001','视频 040'])await page.getByRole('checkbox',{name:`选择片单视频 ${title}`,exact:true}).check();
  await page.getByRole('button',{name:'下一页播放列表视频',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(5);await page.getByRole('checkbox',{name:'选择片单视频 视频 045',exact:true}).check();
  await expect(page.locator('.playlist-bulk-controls')).toContainText('已选 3 / 500');await page.getByRole('button',{name:'移除所选片单视频',exact:true}).click();
  await expect(page.locator('.playlist-item-title')).toHaveCount(2);let detail=await(await request.get(`/api/playlists/${list.id}?page=1&page_size=100`)).json();expect(detail.items.map((value:any)=>value.id)).toEqual(ids.filter(id=>![1,40,45].includes(id)));
  await page.getByRole('button',{name:'撤销上次移除',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(5);detail=await(await request.get(`/api/playlists/${list.id}?page=1&page_size=100`)).json();expect(detail.items.map((value:any)=>value.id)).toEqual(ids);
});

test('simulated task snapshots distinguish directory waits, playback waits and failures',async({page})=>{
  let snapshot={pending:3,failed:0,blocked:3,paused:false,yielding:false,current:null,published:0,error:''};
  await page.route('**/api/thumbnails',route=>route.fulfill({json:snapshot}));await page.goto('/');await page.getByRole('button',{name:'封面任务',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'后台封面任务'});await expect(dialog).toContainText('等待目录连接');
  snapshot={...snapshot,blocked:0,yielding:true};await expect(dialog).toContainText('等待播放空闲',{timeout:10000});
  snapshot={...snapshot,pending:0,failed:2,yielding:false};await expect(dialog).toContainText('有失败任务待检查',{timeout:10000});
  snapshot={...snapshot,error:'任务状态模拟异常'};await expect(dialog.getByRole('alert')).toContainText('任务状态模拟异常',{timeout:10000});
});
