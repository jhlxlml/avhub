// Renderer behavior harness; real Electron acceptance is recorded separately.
import {test,expect,type Page} from '@playwright/test';
import {waitForDecodedPlayback} from './player-readiness';
const open=async(page:Page)=>{await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'外观',exact:true}).click();};
const choose=async(page:Page,name:string)=>page.getByRole('radio',{name:`${name}主题`,exact:true}).check();
const accent=(page:Page)=>page.locator('html').evaluate(e=>getComputedStyle(e).getPropertyValue('--ui-accent').trim());
test.beforeEach(async({request})=>{await request.post('/test/reset');});

test('theme previews retain library cards and queries; cancel restores colors without writing preferences',async({page,request})=>{
 await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
 const original=await accent(page),url=page.url();await page.locator('.card').first().evaluate(e=>(e as HTMLElement).dataset.themeIdentity='retained');
 const queries:string[]=[],writes:any[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media')queries.push(r.url());if(r.method()==='PATCH'&&r.url().endsWith('/api/preferences')&&r.postDataJSON().values?.appearance)writes.push(r.postDataJSON());});
 await open(page);await choose(page,'蓝色');await expect.poll(()=>accent(page)).not.toBe(original);
 await page.getByRole('button',{name:'浅色',exact:true}).click();await page.getByRole('combobox',{name:'背景风格',exact:true}).selectOption('warm');
 await expect(page.locator('body')).toHaveCSS('background-color','rgb(248, 245, 240)');
 expect((await(await request.get('/api/preferences')).json()).values.appearance).toBeUndefined();expect(writes).toEqual([]);
 await page.getByRole('button',{name:'取消修改',exact:true}).click();await expect.poll(()=>accent(page)).toBe(original);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.getByRole('button',{name:'保存外观',exact:true})).toBeDisabled();await expect(page.locator('.card').first()).toHaveAttribute('data-theme-identity','retained');expect(queries).toEqual([]);expect(page.url()).toBe(url);
});

test('custom colors, system mode and background survive restart; system changes do not rewrite preferences',async({page,request})=>{
 await page.emulateMedia({colorScheme:'light'});await page.goto('/');await open(page);
 await page.getByRole('button',{name:'跟随系统',exact:true}).click();await page.getByRole('textbox',{name:'主题色 HEX',exact:true}).fill('#E5C532');
 await page.getByRole('combobox',{name:'背景风格',exact:true}).selectOption('cool');await page.getByRole('combobox',{name:'强调程度',exact:true}).selectOption('standard');
 await page.getByRole('button',{name:'保存外观',exact:true}).click();await expect(page.getByText('外观已保存',{exact:true})).toBeVisible();
 const saved=(await(await request.get('/api/preferences')).json()).values.appearance;expect(saved).toMatchObject({theme:'system',palette:'custom',accent:'#e5c532',background:'cool',emphasis:'standard',coverSize:'standard'});
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme-mode','system');await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 const light=await accent(page);await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect.poll(()=>accent(page)).not.toBe(light);
 expect((await(await request.get('/api/preferences')).json()).values.appearance).toEqual(saved);
 await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.appearance.theme).toBe('light');
 expect((await(await request.get('/api/preferences')).json()).values.appearance).toMatchObject({palette:'custom',accent:'#e5c532',background:'cool',emphasis:'standard'});
});

test('failed save retains the preview and draft; discarding never retries the rejected theme later',async({page,request})=>{
 await page.goto('/');const original=await accent(page);await open(page);await choose(page,'青绿色');
 await page.route('**/api/preferences',route=>route.request().method()==='PATCH'&&route.request().postDataJSON().values?.appearance?route.fulfill({status:503,json:{detail:'isolated theme failure'}}):route.continue());
 await page.getByRole('button',{name:'保存外观',exact:true}).click();await expect(page.getByText(/保存失败：isolated theme failure/)).toBeVisible();await expect(page.getByRole('radio',{name:'青绿色主题',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();const confirm=page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true});await expect(confirm).toContainText('外观主题');await confirm.getByRole('button',{name:'放弃修改',exact:true}).click();
 await expect.poll(()=>accent(page)).toBe(original);await page.unroute('**/api/preferences');await page.waitForTimeout(400);
 expect((await(await request.get('/api/preferences')).json()).values.appearance).toBeUndefined();
});

test('invalid HEX cannot save; close confirmation protects incomplete input and cancellation restores preview',async({page})=>{
 await page.goto('/');const original=await accent(page);await open(page);await page.getByRole('textbox',{name:'主题色 HEX',exact:true}).fill('#12');
 await expect(page.getByRole('button',{name:'保存外观',exact:true})).toBeDisabled();expect(await accent(page)).toBe(original);
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true}).getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('textbox',{name:'主题色 HEX',exact:true})).toHaveValue('#12');
 await page.getByRole('button',{name:'取消修改',exact:true}).click();await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a stale write receipt does not commit the preview or claim a successful save',async({page,request})=>{
 await page.goto('/');await open(page);await choose(page,'暖橙');
 await page.route('**/api/preferences',route=>route.request().method()==='PATCH'&&route.request().postDataJSON().values?.appearance?route.fulfill({json:{ok:true,appearance:{theme:'dark',coverSize:'standard'}}}):route.continue());
 await page.getByRole('button',{name:'保存外观',exact:true}).click();await expect(page.getByText(/外观设置尚未确认保存/)).toBeVisible();await expect(page.getByText('外观已保存',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('radio',{name:'暖橙主题',exact:true})).toBeChecked();expect((await(await request.get('/api/preferences')).json()).values.appearance).toBeUndefined();
});

test('reset stays a preview until saved and preserves the independent cover-size setting',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{appearance:{theme:'light',coverSize:'large',palette:'blue',accent:'#2464be',background:'warm',emphasis:'standard'}}}});
 await page.goto('/');const original=await accent(page);await open(page);await page.getByRole('button',{name:'恢复默认',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.getByRole('button',{name:'取消修改',exact:true}).click();await expect.poll(()=>accent(page)).toBe(original);await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByRole('button',{name:'恢复默认',exact:true}).click();await page.getByRole('button',{name:'保存外观',exact:true}).click();await expect(page.getByText('外观已保存',{exact:true})).toBeVisible();
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-cover-size','large');expect((await(await request.get('/api/preferences')).json()).values.appearance).toMatchObject({theme:'dark',palette:'violet',background:'neutral',emphasis:'soft',coverSize:'large'});
});

test('quick theme switching preserves custom colors without replacing the decoded video or requesting conversion',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{resumeBehavior:'restart',appearance:{theme:'light',coverSize:'standard',palette:'teal',accent:'#18766e',background:'warm',emphasis:'soft'}}}});
 const attempts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/media/2/playback'))attempts.push(r.postDataJSON());});
 await page.goto('/?video=2');await waitForDecodedPlayback(page);await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.dataset.themeIdentity='decoded';});
 await page.getByRole('button',{name:'切换至深色模式',exact:true}).click();await expect(page.locator('video')).toHaveAttribute('data-theme-identity','decoded');await expect(page.locator('.player-controls')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 expect(attempts).toHaveLength(1);expect(attempts[0]).toMatchObject({prefer_original:true,force_transcode:false});expect(attempts[0].allow_video_transcode).not.toBe(true);
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.appearance.theme).toBe('dark');
 expect((await(await request.get('/api/preferences')).json()).values.appearance.palette).toBe('teal');
});

test('appearance controls fit narrow settings and keep keyboard radio navigation',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await open(page);const first=page.getByRole('radio',{name:'紫色主题',exact:true});await first.focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('radio',{name:'蓝色主题',exact:true})).toBeChecked();
 await expect.poll(()=>page.locator('.settings-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await expect(page.getByRole('textbox',{name:'主题色 HEX',exact:true})).toBeVisible();
});
