// Renderer harness. Real desktop acceptance runs separately.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light'])test(`${theme}: privacy masks previews, disables hover video and persists without changing queries`,async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'},hoverPreview:true}}});
 await request.post('/test/thumbnail-fixture');await page.goto('/?sort=name');await expect(page.locator('.card')).toHaveCount(48);
 const toggle=page.getByRole('button',{name:'开启隐私模式',exact:true});
 const refresh=await page.getByRole('button',{name:'刷新媒体库',exact:true}).boundingBox(),privacy=await toggle.boundingBox(),themeBox=await page.getByRole('button',{name:theme==='dark'?'切换至浅色模式':'切换至深色模式',exact:true}).boundingBox();
 expect(privacy!.width).toBe(32);expect(privacy!.height).toBe(32);expect(privacy!.x-refresh!.x).toBe(38);expect(themeBox!.x-privacy!.x).toBe(38);
 let queries=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media')queries++;});
 const before=page.url();await toggle.click();await expect(page.locator('html')).toHaveAttribute('data-privacy','on');
 const image=page.locator('.card [data-private-media]').first();await expect(image).toHaveCSS('filter','blur(22px)');
 await page.locator('.card .cover').first().hover();await page.waitForTimeout(900);await expect(page.locator('.hover-preview')).toHaveCount(0);expect(page.url()).toBe(before);expect(queries).toBe(0);
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.privacyMode).toBe(true);
 await page.reload();await expect(page.getByRole('button',{name:'关闭隐私模式',exact:true})).toHaveAttribute('aria-pressed','true');await expect(image).toHaveCSS('filter','blur(22px)');
 await page.getByRole('button',{name:'列表',exact:true}).click();await expect(image).toHaveCSS('filter','blur(22px)');
 await page.getByRole('button',{name:'关闭隐私模式',exact:true}).click();await expect(image).toHaveCSS('filter','none');
});
