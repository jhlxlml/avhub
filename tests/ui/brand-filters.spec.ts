// Component harness, not packaged EXE icon or desktop hardware acceptance.
import {test,expect} from '@playwright/test';

for(const theme of ['dark','light'])for(const width of [390,1440])test(`${theme} ${width}: About and library share the canonical brand; advanced filters have consistent geometry`,async({page,request})=>{
 await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
 const asset=await request.get('/avhub.svg');expect(asset.ok()).toBe(true);expect(asset.headers()['content-type']).toContain('image/svg+xml');expect(await asset.text()).toContain('<svg');
 await page.setViewportSize({width,height:900});await page.goto('/?q=002&format=mp4&watch=unwatched');
 const logo=page.locator('.brand .logo img');await expect(logo).toHaveAttribute('src','/avhub.svg');
 await expect.poll(()=>logo.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await page.getByRole('button',{name:/^更多筛选/}).click();const panel=page.getByRole('region',{name:'高级筛选',exact:true});
 const fields=panel.getByRole('combobox');await expect(fields).toHaveCount(3);
 for(const control of await fields.all()){
  await expect(control).toHaveCSS('height','32px');await expect(control).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
 }
 for(const button of await panel.getByRole('button').all()){
  expect((await button.boundingBox())!.height).toBe(32);await expect(button).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
 }
 expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await panel.screenshot({path:`build/ui-refinement/advanced-filters-${theme}-${width}.png`});
 await panel.getByRole('combobox',{name:'视频格式',exact:true}).focus();await page.keyboard.press('Tab');
 await expect(panel.getByRole('combobox',{name:'观看状态',exact:true})).toBeFocused();
 await expect(panel.getByRole('combobox',{name:'观看状态',exact:true})).toHaveCSS('outline-style','solid');
 await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'帮助',exact:true}).click();
 await page.getByRole('tab',{name:'关于',exact:true}).click();
 const mark=page.locator('.app-about-mark img');await expect(mark).toHaveAttribute('src','/avhub.svg');
 await expect.poll(()=>mark.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await page.getByRole('region',{name:'关于 AVHub',exact:true}).screenshot({path:`build/ui-refinement/about-brand-${theme}-${width}.png`});
});
