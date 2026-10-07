import {test,expect} from '@playwright/test';
import {LibraryPageCache} from '../../frontend/src/libraryCache';

test.beforeEach(async({request})=>{expect((await request.post('/test/reset')).ok()).toBe(true);});

test('library cache is revision-aware, expires old data and evicts least-recently-used pages',()=>{
  const cache=new LibraryPageCache(3);
  for(const key of ['a','b','c'])cache.put(key,1,key);
  expect(cache.get('a',1)?.data).toBe('a');cache.put('d',1,'d');
  expect(cache.size).toBe(3);expect(cache.get('b',1)).toBeUndefined();
  expect(cache.get('a',2)).toBeUndefined();
  cache.put('expired',1,[],Date.now()-cache.retainMs-10);
  expect(cache.get('expired',1)).toBeUndefined();
  cache.put('stale',1,[1],Date.now()-cache.freshMs-10);
  expect(cache.get('stale',1)?.data).toEqual([1]);
  cache.clear();expect(cache.size).toBe(0);
});

test('warm categories switch without repeated requests or loading-placeholder flashes',async({page})=>{
  const queries:string[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media'&&r.method()==='GET')queries.push(r.url());});
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'电影',exact:true}).click();await expect(page.getByRole('button',{name:'播放 视频 003',exact:true})).toHaveCount(0);
  await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'剧集',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
  await page.evaluate(()=>{
    (window as any).categoryFlashes=0;
    new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)
      if(node instanceof Element&&(node.matches('.library-query-placeholder')||node.querySelector('.library-query-placeholder')))(window as any).categoryFlashes++;
    }).observe(document.querySelector('main')!,{childList:true,subtree:true});
  });
  for(let round=0;round<3;round++)for(const [label,count] of [['全部视频',48],['电影',48],['剧集',1]] as const) {
    await page.getByRole('button',{name:label,exact:true}).click();await expect(page.locator('.card')).toHaveCount(count);
  }
  expect(queries).toHaveLength(3);expect(await page.evaluate(()=>(window as any).categoryFlashes)).toBe(0);
});

test('slow uncached classification shows honest feedback and late results never overwrite the active tab',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let began=false;
  await page.route('**/api/media?**',async route=>{
    if(new URL(route.request().url()).searchParams.get('view')!=='movies')return route.continue();
    began=true;const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>{});
  });
  try {
    await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
    await page.getByRole('button',{name:'电影',exact:true}).click();await expect.poll(()=>began).toBe(true);
    await expect(page.getByText('正在加载视频…',{exact:true})).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(0);
    await page.getByRole('button',{name:'剧集',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
    release();await page.waitForTimeout(300);
    await expect(page.getByRole('button',{name:'播放 视频 003',exact:true})).toBeVisible();
    await expect(page.getByText('正在加载视频…',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'全部视频',exact:true}).click();await expect(page.locator('.card')).toHaveCount(48);
  }finally{release();}
});

test('favorite writes invalidate other cached views and preserve accurate counts',async({page})=>{
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button',{name:'全部视频',exact:true}).click();
  await page.getByRole('button',{name:'收藏 视频 002',exact:true}).click();
  await expect(page.getByRole('button',{name:'取消收藏 视频 002',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.locator('.card')).toHaveCount(2);
  await page.getByRole('button',{name:'取消收藏 视频 001',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button',{name:'全部视频',exact:true}).click();await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'播放 视频 002',exact:true})).toBeVisible();
});

test('grouped series cache survives tab unmount and restores group pages without another fetch',async({page,request})=>{
  const fixture=await request.post('/test/series-fixture');expect(fixture.ok()).toBe(true);expect((await fixture.json()).unassigned).toBe(0);
  const ready=await request.get('/api/series?q=测试剧集&page=1&page_size=48');expect(ready.ok()).toBe(true);expect((await ready.json()).items.map((item:any)=>item.title)).toEqual(['测试剧集']);
  let groups=0;
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/series'&&r.method()==='GET')groups++;});
  const firstResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/series');
  await page.goto('/?view=series&grouped=true&q=测试剧集');
  const response=await firstResponse;expect(response.ok()).toBe(true);expect((await response.json()).items.map((item:any)=>item.title)).toEqual(['测试剧集']);
  await expect(page.locator('.series-groups .card')).toHaveCount(1);
  await page.getByRole('button',{name:'全部视频',exact:true}).click();await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'剧集',exact:true}).click();await expect(page.locator('.series-groups .card')).toHaveCount(1);
  await page.getByRole('button',{name:'打开剧集 测试剧集',exact:true}).click();await expect(page.locator('.series-episode')).toHaveCount(48);
  expect(groups).toBe(1);
  // Entering a group intentionally clears the search in the existing UI.
  // Returning must fetch that DIFFERENT query, not reuse the filtered page.
  await page.getByRole('button',{name:'返回剧集库',exact:true}).click();await expect(page.locator('.series-groups .card')).toHaveCount(48);
  expect(groups).toBe(2);
  await page.locator('.series-group-cover').first().click();await expect(page.locator('.series-episode')).toHaveCount(10);
  await page.getByRole('button',{name:'返回剧集库',exact:true}).click();await expect(page.locator('.series-groups .card')).toHaveCount(48);
  expect(groups).toBe(2);
});

test('expired cached view retains correct cards during background refresh and offers retry on failure',async({page})=>{
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'电影',exact:true}).click();await expect(page.locator('.card')).toHaveCount(48);
  await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+21000;});
  await page.route('**/api/media?**',async route=>{
    if(new URL(route.request().url()).searchParams.get('view')!=='all')return route.continue();
    await new Promise(resolve=>setTimeout(resolve,350));
    await route.fulfill({status:500,contentType:'application/json',json:{detail:'测试后台更新失败'}});
  });
  await page.getByRole('button',{name:'全部视频',exact:true}).click();
  await expect(page.locator('.card')).toHaveCount(48);
  await expect(page.getByRole('alert')).toContainText('测试后台更新失败');
  await expect(page.locator('.card')).toHaveCount(48);await expect(page.locator('.library-query-placeholder')).toHaveCount(0);
  await page.unrouteAll({behavior:'wait'});
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.locator('.card')).toHaveCount(48);
});
