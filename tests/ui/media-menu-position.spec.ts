// Isolated renderer harness; desktop acceptance runs in real Electron.
import {test,expect,type Page} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function fits(page:Page){
  const box=await page.getByRole('menu').boundingBox();expect(box).not.toBeNull();
  const viewport=page.viewportSize()!;expect(box!.x).toBeGreaterThanOrEqual(7);expect(box!.y).toBeGreaterThanOrEqual(7);
  expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width-7);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height-7);
}
for(const theme of ['dark','light'])test(`${theme}: bottom corner menu flips, stays clickable and restores modal focus`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'compact'}}}});await page.setViewportSize({width:820,height:500});
  await page.goto('/');const trigger=page.locator('.media-grid .media-more').last();await trigger.scrollIntoViewIfNeeded();
  const rect=await trigger.boundingBox();await page.evaluate(y=>window.scrollBy(0,y-(innerHeight-40)),rect!.y);
  await trigger.click();await expect(page.getByRole('menu')).toHaveAttribute('data-placement','above');await fits(page);
  await page.getByRole('menuitem',{name:'编辑信息与封面',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await trigger.click();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  await trigger.click();await page.screenshot({path:`build/media-menu-bottom-${theme}.png`});
});
test('narrow and short viewport clamps left edge, scrolls internally and supports keyboard',async({page})=>{
  await page.setViewportSize({width:320,height:210});await page.goto('/');const trigger=page.locator('.media-more').first();await trigger.scrollIntoViewIfNeeded();await trigger.click();
  await fits(page);expect(await page.getByRole('menu').evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
  await page.keyboard.press('End');await expect(page.getByRole('menuitem',{name:'在资源管理器中显示',exact:true})).toBeFocused();
  await fits(page);await page.keyboard.press('Home');await expect(page.getByRole('menuitem',{name:'编辑信息与封面',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('menu')).toHaveCount(0);
});
test('resize and scrolling follow the anchor; offscreen or hidden anchors dismiss the menu',async({page})=>{
  await page.goto('/');const trigger=page.locator('.media-more').first();await trigger.click();await fits(page);
  await page.setViewportSize({width:500,height:850});await expect.poll(async()=>{
    const box=await page.getByRole('menu').boundingBox();return !!box&&box.x>=7&&box.x+box.width<=493&&box.y+box.height<=843;
  }).toBe(true);
  await page.mouse.click(10,180);await expect(page.getByRole('menu')).toHaveCount(0);
  await trigger.scrollIntoViewIfNeeded();await trigger.click();await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await expect(page.getByRole('menu')).toHaveCount(0);
});
test('portal escapes clipping ancestors while keeping menu actions functional',async({page,request})=>{
  await request.put('/api/media/1/watched',{data:{watched:true}});
  await page.goto('/');const card=page.locator('.card').first();await card.evaluate(element=>{(element as HTMLElement).style.overflow='hidden';(element as HTMLElement).style.contain='paint';});
  await card.locator('.media-more').click();await fits(page);expect(await page.getByRole('menu').evaluate(element=>!!element.closest('.card'))).toBe(false);
  await page.getByRole('menuitem',{name:'标记为未看',exact:true}).click();await expect(page.getByRole('menu')).toHaveCount(0);expect((await(await request.get('/api/media/1')).json()).watched).toBe(0);
});
