// Renderer harness only; actual preload/OS dispatch is covered by Electron acceptance.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request,page})=>{
  await request.post('/test/reset');await page.addInitScript(()=>{
    (window as any).externalActions=[];
    const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};
    window.avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,mediaAction:async(id:number,action:string)=>{(window as any).externalActions.push([id,action]);return {ok:true};}} as any;
  });
});
for(const theme of ['dark','light'])test(`${theme}: external player icon is right aligned, opens directly and never opens the internal player`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'compact'}}}});
  await page.goto('/');const card=page.locator('.card').first(),button=card.getByRole('button',{name:/用系统播放器打开/});
  await expect(button).toBeVisible();const spec=await card.locator('.video-specs').boundingBox(),box=await button.boundingBox(),more=await card.locator('.media-more').boundingBox();
  expect(Math.abs(spec!.x+spec!.width-box!.x-box!.width)).toBeLessThan(2);expect(more!.y+more!.height).toBeLessThanOrEqual(box!.y);
  const url=page.url();let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss();});await button.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).externalActions.length)).toBe(1);expect(await page.evaluate(()=>(window as any).externalActions)).toEqual([[1,'open']]);
  expect(page.url()).toBe(url);expect(dialogs).toBe(0);await expect(page.locator('.toast')).toHaveCount(0);
  await card.locator('.media-more').click();await expect(page.getByRole('menuitem',{name:'用系统播放器打开'})).toHaveCount(0);await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:820});expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:`build/external-player-${theme}.png`});
  await page.getByRole('button',{name:'列表',exact:true}).click();await expect(page.locator('.external-player-button')).toHaveCount(0);
});
test('offline items stay disabled and dispatch failure has useful feedback',async({page})=>{
  await page.route('**/api/media?**',async route=>{const response=await route.fetch();const value=await response.json();value.items=value.items.map((item:any)=>({...item,missing:item.id===4?1:item.missing}));await route.fulfill({json:value});});
  await page.goto('/');await expect(page.locator('.card').filter({has:page.getByRole('button',{name:'用系统播放器打开 视频 004',exact:true})}).locator('.external-player-button')).toBeDisabled();
  await page.evaluate(()=>{window.avhubDesktop!.mediaAction=async()=>{throw new Error('未设置默认播放器');};});
  await page.getByRole('button',{name:'用系统播放器打开 视频 001',exact:true}).click();await expect(page.locator('.toast')).toContainText('未设置默认播放器');
});
