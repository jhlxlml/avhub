import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function ready(page:Page) {await page.goto('/');await expect(page.locator('.media-grid>.card')).toHaveCount(48);}
async function size(page:Page,label:string) {
  await page.getByRole('button',{name:'调整封面大小',exact:true}).click();
  await page.getByRole('group',{name:'封面大小设置'}).getByRole('button',{name:label,exact:true}).click();
  await page.keyboard.press('Escape');
}
async function columns(page:Page) {return page.locator('.media-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);}

test('light surfaces are consistent across settings, playlists and the player without changing decoded video',async({page,request})=>{
  await ready(page);await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(244, 246, 250)');
  await page.getByRole('button',{name:'媒体库设置'}).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await expect(page.getByRole('tab',{name:'播放偏好',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tab',{name:'播放偏好',exact:true})).toHaveCSS('color','rgb(184, 68, 52)');
  await expect(page.getByRole('textbox',{name:'默认保存目录'})).toHaveCSS('color','rgb(29, 43, 61)');
  await page.screenshot({path:'test-results/appearance-light-settings.png'});
  await page.getByRole('button',{name:'关闭设置'}).click();
  const list=await(await request.post('/api/playlists',{data:{name:'浅色模式片单'}})).json();
  await request.post(`/api/playlists/${list.id}/items/2`);
  await page.getByRole('button',{name:'播放列表',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('.playlist-item-title')).toHaveCSS('color','rgb(29, 43, 61)');
  await page.screenshot({path:'test-results/appearance-light-playlists.png'});
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('button',{name:'播放 视频 002',exact:true}).click();
  const video=page.locator('video');
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
  await video.evaluate((v:HTMLVideoElement)=>{v.pause();v.dataset.appearanceIdentity='unchanged';});
  await expect(page.locator('.player-info')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('.player-shell')).toHaveCSS('background-color','rgb(244, 246, 250)');
  await expect(page.locator('.player-info h2')).toHaveCSS('color','rgb(29, 43, 61)');
  await expect(page.locator('.player-top>span')).toHaveCSS('color','rgb(29, 43, 61)');
  await expect(page.locator('.player-controls')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.locator('.player-controls')).toHaveCSS('background-image','none');
  await expect(page.locator('.player-controls button').first()).toHaveCSS('color','rgb(255, 255, 255)');
  await page.screenshot({path:'test-results/appearance-light-player.png'});
  const source=await video.getAttribute('src');
  await page.getByRole('button',{name:'切换至深色模式',exact:true}).click();
  await expect(video).toHaveAttribute('data-appearance-identity','unchanged');
  expect(await video.getAttribute('src')).toBe(source);
  expect(await video.evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>!v.paused)).toBeTruthy();
});

test('cover resizing changes columns only, retaining cards, lazy loading, queries and pagination',async({page,request})=>{
  await request.post('/test/thumbnail-fixture');
  await ready(page);
  const requests:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/media')requests.push(request.url());});
  const originalColumns=await columns(page),originalUrl=page.url();
  const card=page.locator('.card').first();await card.evaluate(e=>{(e as HTMLElement).dataset.resizeIdentity='retained';});
  await size(page,'紧凑');expect(await columns(page)).toBeGreaterThan(originalColumns);
  await size(page,'宽大');expect(await columns(page)).toBeLessThan(originalColumns);
  await expect(card).toHaveAttribute('data-resize-identity','retained');
  await expect(page.locator('.card')).toHaveCount(48);
  await expect(page.getByRole('combobox',{name:'每页数量'})).toHaveValue('48');
  await expect(page.locator('.thumbnail').first()).toHaveAttribute('loading','lazy');
  await expect(page.locator('.thumbnail').first()).toHaveAttribute('decoding','async');
  await expect(page.locator('.cover').first()).toHaveCSS('aspect-ratio','16 / 9');
  expect(page.url()).toBe(originalUrl);expect(requests).toEqual([]);
  await page.screenshot({path:'test-results/appearance-large-covers.png'});
});

test('appearance survives reload and a new browser context without localStorage',async({page,browser,request,baseURL})=>{
  await ready(page);await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();await size(page,'舒适');
  await expect.poll(async()=>{const data=await(await request.get('/api/preferences')).json();return data.values.appearance;})
    .toEqual({theme:'light',coverSize:'comfortable'});
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('html')).toHaveAttribute('data-cover-size','comfortable');
  const fresh=await browser.newPage();
  try {await fresh.goto(baseURL!);await expect(fresh.locator('.card')).toHaveCount(48);
    await expect(fresh.locator('html')).toHaveAttribute('data-theme','light');
    await expect(fresh.locator('html')).toHaveAttribute('data-cover-size','comfortable');
  } finally {await fresh.close();}
});

test('list rows do not resize and favorite navigation remains usable',async({page})=>{
  await ready(page);await size(page,'宽大');
  await page.getByRole('button',{name:'列表',exact:true}).click();
  await expect(page.getByRole('button',{name:'调整封面大小',exact:true})).toBeDisabled();
  await expect(page.locator('.media-list .cover').first()).toHaveCSS('width','220px');
  await page.getByRole('button',{name:'收藏',exact:true}).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button',{name:'全部视频',exact:true}).click();
  await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'封面墙',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-cover-size','large');
  await expect(page.getByRole('button',{name:'调整封面大小',exact:true})).toBeEnabled();
});

test('size slider supports keyboard selection, Escape and focus return',async({page})=>{
  await ready(page);const toggle=page.getByRole('button',{name:'调整封面大小',exact:true});await toggle.click();
  const slider=page.getByRole('slider',{name:'封面大小',exact:true});await slider.focus();await page.keyboard.press('End');
  await expect(page.locator('html')).toHaveAttribute('data-cover-size','large');
  await expect(slider).toHaveAttribute('aria-valuetext','宽大');
  await page.keyboard.press('Home');await expect(page.locator('html')).toHaveAttribute('data-cover-size','compact');
  await page.keyboard.press('Escape');await expect(toggle).toBeFocused();
  await expect(page.getByRole('group',{name:'封面大小设置'})).toHaveCount(0);
});

test('grouped series share cover sizing without resizing episode rows',async({page,request})=>{
  await request.post('/test/series-fixture');await page.goto('/?view=series&grouped=true');
  await expect(page.locator('.series-groups .card')).toHaveCount(48);
  const original=await columns(page);await size(page,'宽大');
  expect(await columns(page)).toBeLessThan(original);
  await expect(page.locator('.series-groups .card')).toHaveCount(48);
  await page.locator('.series-group-cover').first().click();
  await expect(page.locator('.series-episode').first()).toBeVisible();
  await expect(page.locator('.episode-cover').first()).toHaveCSS('width','112px');
});

for(const width of [320,390])test(`light mode and all cover sizes fit a ${width}px window without horizontal overflow`,async({page})=>{
  await page.setViewportSize({width,height:844});await ready(page);
  await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
  for(const label of ['紧凑','标准','舒适','宽大']) {
    await size(page,label);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  }
  await page.getByRole('button',{name:'调整封面大小',exact:true}).click();
  const bounds=await page.getByRole('group',{name:'封面大小设置'}).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:`test-results/appearance-light-mobile-${width}.png`});
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'媒体库设置'}).click();
  await expect.poll(()=>page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
});

test('corrupted old appearance settings cannot block startup or override valid database values',async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme:'light',coverSize:'compact'}}}});
  await page.addInitScript(()=>localStorage.setItem('avhub.appearance','{"theme":"dark","coverSize":"invalid"}'));
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('html')).toHaveAttribute('data-cover-size','compact');
});
