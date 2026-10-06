import {test,expect} from '@playwright/test';
import {resolutionTier} from '../../frontend/src/mediaLabels';

test('resolution tiers are orientation-independent and do not overstate cropped dimensions',()=>{
  for(const [w,h,tier] of [[7680,4320,'8K'],[3840,2160,'4K'],[2160,3840,'4K'],[2560,1440,'QHD'],[1920,1080,'FHD'],[1080,1920,'FHD'],[1280,720,'HD'],[640,480,'SD'],[3840,1600,'QHD']] as const)
    expect(resolutionTier(w,h)).toBe(tier);
  for(const [w,h] of [[0,1080],[-1920,1080],[NaN,720],[Infinity,1080],[undefined,undefined]])expect(resolutionTier(w,h)).toBeNull();
});
test('resolution filters are separate, request real server filtering and restore on refresh',async({page,request})=>{
  await request.post('/test/reset');await page.goto('/?sort=name&root=1&page=2');
  const filters=page.getByRole('group',{name:'分辨率筛选',exact:true});
  await expect(filters.getByRole('button')).toHaveCount(7);
  await expect(filters.getByRole('button',{name:'筛选 2K',exact:true})).toBeVisible();
  const filterBox=await filters.boundingBox(),viewBox=await page.locator('.library-view-controls').boundingBox();
  expect(filterBox!.x+filterBox!.width).toBeLessThan(viewBox!.x);
  expect(Math.abs(filterBox!.y-viewBox!.y)).toBeLessThan(4);
  await page.screenshot({path:'test-results/resolution-filter-toolbar-dark.png'});
  const request2k=page.waitForRequest(r=>r.url().includes('/api/media?')&&new URL(r.url()).searchParams.get('resolution')==='QHD');
  await filters.getByRole('button',{name:'筛选 2K',exact:true}).click();await request2k;
  await page.reload();await expect(filters.getByRole('button',{name:'筛选 2K',exact:true})).toHaveAttribute('aria-pressed','true');
  const request4k=page.waitForRequest(r=>r.url().includes('/api/media?')&&new URL(r.url()).searchParams.get('resolution')==='4K');
  await filters.getByRole('button',{name:'筛选 4K',exact:true}).click();
  const url=new URL((await request4k).url());expect(url.searchParams.get('root_id')).toBe('1');expect(url.searchParams.get('page')).toBe('1');expect(url.searchParams.get('sort')).toBe('name');
  await expect(page.getByText('暂无匹配的视频',{exact:true})).toBeVisible();
  await page.reload();await expect(filters.getByRole('button',{name:'筛选 4K',exact:true})).toHaveAttribute('aria-pressed','true');
  await filters.getByRole('button',{name:'全部分辨率',exact:true}).click();
  await expect(page.locator('.card').first()).toBeVisible();await expect(page).not.toHaveURL(/resolution=/);
  expect((await request.get('/api/media?resolution=invalid')).status()).toBe(422);
  await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();await page.setViewportSize({width:390,height:820});
  expect(await filters.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/resolution-filter-light.png'});
  await page.setViewportSize({width:1797,height:850});
  await page.screenshot({path:'test-results/resolution-filter-toolbar-light.png'});
});

test('badges sit below previews and remain legible in grid, list, light and narrow layouts',async({page,request})=>{
  await request.post('/test/reset');
  const samples=[[3840,2160],[1920,1080],[1280,720],[2560,1440],[2160,3840],[640,480],[0,0]];
  await page.route('**/api/media?*',async route=>{
    const body=await(await route.fetch()).json();
    body.items=body.items.slice(0,samples.length).map((item:any,i:number)=>({...item,width:samples[i][0],height:samples[i][1],size:1073741824,kind:i===1?'episode':'movie',season:1,episode:2}));
    body.total=body.items.length;body.pages=1;
    await route.fulfill({json:body});
  });
  await page.goto('/?sort=name');
  await expect(page.locator('.video-specs .resolution-badge')).toHaveText(['4K','FHD','HD','2K','4K','SD']);
  await expect(page.locator('.cover .resolution-badge')).toHaveCount(0);
  await expect(page.locator('.resolution-badge').first()).toHaveAttribute('title',/3840×2160/);
  await expect(page.locator('.card').nth(1)).toContainText('第 1 季 · 第 2 集');
  await expect(page.locator('.card').nth(6).locator('.resolution-badge')).toHaveCount(0);
  await page.screenshot({path:'test-results/resolution-badges-dark.png'});
  await page.getByRole('button',{name:'列表',exact:true}).click();
  await expect(page.locator('.media-list .resolution-badge')).toHaveCount(6);
  await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  await page.setViewportSize({width:390,height:820});
  for(const element of await page.locator('.video-specs').all())expect(await element.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/resolution-badges-light-list.png'});
  await page.getByRole('button',{name:'封面墙',exact:true}).click();
  await expect(page.locator('.media-grid')).toBeVisible();
  for(const element of await page.locator('.video-specs').all())expect(await element.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/resolution-badges-light-grid.png'});
});
