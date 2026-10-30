// Renderer decoder/interaction harness. Native desktop acceptance is separate.
import {test,expect} from '@playwright/test';
import {revealPlayerControls} from './player-pointer';
test.beforeEach(async({request})=>{await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{playbackControllerEnabled:true,playerEngine:'chromium',resumeBehavior:'restart',autoNext:false}}});});
for(const mode of ['direct','indexed-ts','indexed-remux'])test(`unified ${mode}: decoded pause, latest seek and normal exit preserve the source`,async({page,request})=>{
 const id=mode==='direct'?2:mode==='indexed-ts'?5:3;
 if(mode!=='direct')await request.post(`/test/${mode}-fixture`);
 if(mode==='indexed-remux')await page.route(`**/api/media/${id}/playback`,route=>route.continue({postData:JSON.stringify({...route.request().postDataJSON(),prefer_original:false,skip_direct:true})}));
 await page.goto(`/?video=${id}`);await expect(page.locator('.player-shell')).toHaveAttribute('data-playback-controller','unified');
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBe(true);
 const before=await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.dataset.identity='preserved';return v.currentSrc;});
 await page.keyboard.press('k');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
 for(const target of [15,3,22,12.3])await page.getByRole('slider',{name:'视频完整进度',exact:true}).evaluate((el:HTMLInputElement,target)=>{el.value=String(target);el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));},target);
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-12.3)<.55)).toBe(true);
 await expect(page.locator('video')).toHaveAttribute('data-identity','preserved');expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(before);
 await expect(page.getByRole('alert')).toHaveCount(0);await page.keyboard.press('k');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.paused&&v.currentTime>12.4)).toBe(true);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('video')).toHaveCount(0);
 await expect.poll(async()=>(await(await request.get('/test/sessions')).json()).count).toBe(0);
});
test('flag is optional, strictly boolean and never changes the legacy native preference',async({request})=>{
 await request.patch('/api/preferences',{data:{values:{playerEngine:'mpv'}}});
 expect((await request.patch('/api/preferences',{data:{values:{playbackControllerEnabled:'true'}}})).status()).toBe(422);
 expect((await request.patch('/api/preferences',{data:{values:{playbackControllerEnabled:1}}})).status()).toBe(422);
 await request.patch('/api/preferences',{data:{values:{playbackControllerEnabled:false}}});const values=(await(await request.get('/api/preferences')).json()).values;
 expect(values.playerEngine).toBe('mpv');expect(values.playbackControllerEnabled).toBe(false);
});
test('settings toggle persists and old controls remain reachable without changing layout',async({page,request})=>{
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 const flag=page.getByRole('checkbox',{name:'统一播放控制（试验）',exact:true});await expect(flag).toBeChecked();await flag.uncheck();
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.playbackControllerEnabled).toBe(false);
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.goto('/?video=2');await expect(page.locator('.player-shell')).toHaveAttribute('data-playback-controller','legacy');
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused)).toBe(true);
});
test('unified resume and source-bound subtitle delay retain existing persistence semantics',async({page,request})=>{
 const state=await(await request.get('/api/media/3/playback-state')).json();
 await request.patch('/api/media/3/playback-state',{data:{source:state.source,changes:{subtitle:'embedded:2',delay:.6}}});
 await request.put('/api/media/3/progress',{data:{progress:12,watched:false,updated_at:Date.now()}});await request.patch('/api/preferences',{data:{values:{resumeBehavior:'resume'}}});
 await page.goto('/?video=3');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.currentTime>=12)).toBe(true);
 await revealPlayerControls(page);await page.getByRole('button',{name:'字幕',exact:true}).click();await expect(page.getByRole('combobox',{name:'字幕轨道',exact:true})).toHaveValue('embedded:2');
 expect((await(await request.get('/api/media/3/playback-state')).json()).delay).toBe(.6);
 await page.getByRole('combobox',{name:'字幕轨道',exact:true}).selectOption('');
 await expect.poll(async()=>(await(await request.get('/api/media/3/playback-state')).json()).subtitle).toBe('');
});
test('failed flag save rolls back visible state and preserves default engine',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 await page.route('**/api/preferences',route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{detail:'test flag save failed'}}):route.continue());
 const flag=page.getByRole('checkbox',{name:'统一播放控制（试验）',exact:true});await flag.click();await expect(flag).toBeChecked();await expect(page.getByText('test flag save failed',{exact:true})).toBeVisible();
 await expect(page.getByLabel('默认播放引擎',{exact:true})).toHaveValue('chromium');
});
