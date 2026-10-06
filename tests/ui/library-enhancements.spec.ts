import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
test('all sort fields toggle direction, preserve filters and support legacy links',async({page,request})=>{
  await page.goto('/?sort=duration_asc&root=2');
  const select=page.getByRole('combobox',{name:'排序方式',exact:true});
  await expect(select).toHaveValue('duration');
  for(const [field,asc,desc] of [['recent','recent_asc','recent'],['added','added_asc','added'],['name','name','name_desc'],['duration','duration_asc','duration_desc']]) {
    await select.selectOption(field);await expect(page).toHaveURL(new RegExp(`sort=${asc}(?:&|$)`));
    await page.getByRole('button',{name:'切换为降序',exact:true}).click();
    await expect.poll(()=>new URL(page.url()).searchParams.get('sort')||'recent').toBe(desc);
    await expect(page).toHaveURL(/root=2/);
    expect((await request.get(`/api/media?sort=${desc}`)).ok()).toBe(true);
    await page.reload();await expect(select).toHaveValue(field);
    await page.getByRole('button',{name:'切换为升序',exact:true}).click();
  }
  await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  await page.setViewportSize({width:390,height:820});
  await expect(page.getByRole('button',{name:'切换为降序',exact:true})).toBeVisible();
  expect(await page.locator('.library-sort-controls').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/library-sort-light.png'});
});
test('new sort choices persist in URL and metadata sizes omit unknown values',async({page,request})=>{
  await page.goto('/');
  const sort=page.getByRole('combobox',{name:'排序方式',exact:true});
  await expect(sort.locator('option')).toHaveCount(7);
  await expect(sort.locator('option[value="modified"]')).toHaveText('文件修改时间');
  for(const field of ['modified','resolution','size']) {
    await sort.selectOption(field);
    for(const direction of ['desc','asc']) {
      const value=`${field}_${direction}`;
      await expect(page).toHaveURL(new RegExp(`sort=${value}`));
      if(field==='modified') await expect(page.getByRole('button',{name:direction==='desc'?'切换为升序':'切换为降序',exact:true})).toHaveAttribute('title',new RegExp(direction==='desc'?'最近修改优先':'较早修改优先'));
      expect((await request.get(`/api/media?page=1&sort=${value}`)).ok()).toBe(true);
      await page.getByRole('button',{name:direction==='desc'?'切换为升序':'切换为降序',exact:true}).click();
    }
  }
  await page.getByRole('button',{name:'切换为升序',exact:true}).click();
  await page.reload();await expect(sort).toHaveValue('size');
  await expect(page.getByRole('button',{name:'切换为降序',exact:true})).toBeVisible();
  await page.route('**/api/media?*',async route=>{
    const response=await route.fetch(),body=await response.json();
    body.items=body.items.map((item:any,index:number)=>({...item,size:index===0?1073741824:index===1?0:null}));
    await route.fulfill({json:body});
  });
  await page.goto('/?q=003');await expect(page.locator('.card .meta')).toContainText('1.0 GB');
  await page.goto('/?q=00');await expect(page.locator('.card .meta').nth(1)).not.toContainText('0 KB');
});
for(const [value,start] of [['restart',0],['resume',12]] as const) {
  test(`manual ${value} starts correctly in its first original-quality request`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{resumeBehavior:value}}});
    const calls:any[]=[];page.on('request',r=>{if(r.url().endsWith('/api/media/1/playback'))calls.push(r.postDataJSON());});
    await page.goto('/?video=1');await expect.poll(()=>calls.length).toBe(1);
    expect(calls[0]).toMatchObject({start,prefer_original:true,force_transcode:false,quality:'auto'});
    await expect(page.getByText('继续上次观看？',{exact:true})).toHaveCount(0);
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBe(true);
  });
}
test('resume setting saves durably without clearing progress and remains consistent in light/narrow UI',async({page,request})=>{
  await page.goto('/');await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();await page.setViewportSize({width:390,height:820});
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await page.getByRole('combobox',{name:'起播方式',exact:true}).selectOption('resume');
  await expect.poll(async()=> (await (await request.get('/api/preferences')).json()).values.resumeBehavior).toBe('resume');
  expect((await (await request.get('/api/media/1')).json()).progress).toBe(12);
  await expect(page.getByRole('button',{name:'关闭设置'})).toBeEnabled();
  expect(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/library-tools-light.png'});
  await page.getByRole('button',{name:'关闭设置'}).click();await page.reload();
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'起播方式',exact:true})).toHaveValue('resume');
});
test('data tools show the existing location; about dialog uses shared styling and restores settings focus safely',async({page,request})=>{
  const info=await (await request.get('/api/app-info')).json();
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  await expect(page.getByRole('region',{name:'应用数据目录'})).toContainText(info.data_directory);
  await expect(page.getByRole('button',{name:'打开数据目录',exact:true})).toBeEnabled();
  await page.getByRole('tab',{name:'关于',exact:true}).dblclick();
  await expect(page.getByRole('region',{name:'关于 AVHub'})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('region',{name:'关于 AVHub'})).toContainText('自动记住观看进度');
  await expect(page.getByText('请先关闭当前对话框',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText(info.build_id);
  await expect(page.getByRole('button',{name:'打开项目主页',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('automatic continuation restarts an already watched item under resume behavior',async({page,request})=>{
  const first=await (await request.patch('/api/media/1',{data:{kind:'episode',series_title:'起播验证',season:1,episode:1}})).json();
  await request.patch('/api/media/2',{data:{kind:'episode',series_id:first.series_id,season:1,episode:2}});
  await request.put('/api/media/1/progress',{data:{progress:0}});
  await request.put('/api/media/2/progress',{data:{progress:120,watched:true}});
  await request.patch('/api/preferences',{data:{values:{resumeBehavior:'resume',autoNext:true,queueMode:'sequential',queueScope:'series'}}});
  const bodies:any[]=[];page.on('request',r=>{if(r.url().endsWith('/api/media/2/playback'))bodies.push(r.postDataJSON());});
  await page.goto('/?video=1');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBe(true);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.dispatchEvent(new Event('ended'));});
  await expect.poll(()=>bodies.length,{timeout:15000}).toBe(1);
  expect(bodies[0]).toMatchObject({start:0,force_transcode:false,prefer_original:true});
});

test('failed resume save leaves the durable choice unchanged',async({page,request})=>{
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await page.route('**/api/preferences',route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{detail:'起播设置未保存'}}):route.continue());
  await page.getByRole('combobox',{name:'起播方式',exact:true}).selectOption('restart');
  await expect(page.getByRole('region',{name:'起播方式设置'}).getByRole('alert')).toContainText('起播设置未保存');
  await expect(page.getByRole('combobox',{name:'起播方式',exact:true})).toHaveValue('ask');
  expect((await (await request.get('/api/preferences')).json()).values.resumeBehavior).toBeUndefined();
});
