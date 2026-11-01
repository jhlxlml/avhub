// Browser decoder/component harness; actual desktop handoff is tested separately.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{
 await request.post('/test/reset');
 await request.patch('/api/preferences',{data:{values:{playbackSessionCoordinatorEnabled:true,playbackControllerEnabled:false,playerEngine:'chromium',resumeBehavior:'restart',autoNext:false}}});
});
for(const mode of ['direct','indexed-ts','indexed-remux'])test(`session ${mode}: decoded latest seek preserves source and saved progress`,async({page,request})=>{
 const id=mode==='direct'?2:mode==='indexed-ts'?5:3;
 if(mode!=='direct')await request.post(`/test/${mode}-fixture`);
 if(mode==='indexed-remux')await page.route(`**/api/media/${id}/playback`,route=>route.continue({postData:JSON.stringify({...route.request().postDataJSON(),prefer_original:false,skip_direct:true})}));
 await page.goto(`/?video=${id}`);
 await expect(page.locator('.player-shell')).toHaveAttribute('data-playback-session-phase','ready');
 const src=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
 await page.keyboard.press('k');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
 for(const position of [15,3,22,12.3])await page.getByRole('slider',{name:'视频完整进度',exact:true}).evaluate((el:HTMLInputElement,position)=>{el.value=String(position);el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));},position);
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking&&Math.abs(v.currentTime-12.3)<.55&&v.readyState>=2)).toBe(true);
 expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(src);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await expect(page.locator('.player-shell')).toHaveCount(0);
 await expect.poll(async()=>Math.abs((await(await request.get(`/api/media/${id}`)).json()).progress-12.3)).toBeLessThan(.55);
});
test('session save failure blocks Back and retry retains current decoded source',async({page})=>{
 await page.goto('/?video=2');await expect(page.locator('.player-shell')).toHaveAttribute('data-playback-session-phase','ready');
 await page.keyboard.press('k');
 const src=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc);
 await page.route('**/api/media/2/progress',r=>r.fulfill({status:503,json:{detail:'injected progress unavailable'}}));
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'未保存'})).toBeVisible();
 expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(src);
 await page.unroute('**/api/media/2/progress');await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await expect(page.locator('.player-shell')).toHaveCount(0);
});
