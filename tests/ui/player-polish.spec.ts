// Renderer-only compact-layout regression, not desktop playback acceptance.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light'])test(`${theme}: compact information and long queue titles fit without reloading video`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'},autoNext:false}}});
  const response=await request.post('/api/playlists',{data:{name:'很长的待播片单标题'.repeat(8),media_id:2}});expect(response.ok()).toBe(true);const list=await response.json();
  await page.setViewportSize({width:390,height:844});await page.goto(`/?video=2&playlist=${list.id}`);
  const video=page.locator('video');await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState>=2),{timeout:30000}).toBe(true);
  await video.evaluate((v:HTMLVideoElement)=>{v.pause();v.dataset.polish='retained';});const src=await video.getAttribute('src');
  await page.getByText('快捷键帮助',{exact:true}).click();await expect(page.locator('.player-shortcut-grid>div')).toHaveCount(14);
  await page.getByRole('button',{name:'展开待播队列',exact:true}).click();
  for(const width of [760,390,320]){
    await page.setViewportSize({width,height:844});
    for(const selector of ['.player-info','.playback-queue','.player-shortcut-grid'])await expect.poll(()=>page.locator(selector).evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await expect(video).toHaveAttribute('data-polish','retained');await expect(video).toHaveAttribute('src',src!);expect(await video.evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
});
