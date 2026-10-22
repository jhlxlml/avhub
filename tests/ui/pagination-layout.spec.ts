// Component harness only; the Electron workflow verifies the real desktop.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light'])for(const width of [320,390,760,1440])test(`${theme} ${width}px: compact pagination stays aligned and navigates`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.setViewportSize({width,height:850});await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  const nav=page.getByRole('navigation',{name:'媒体库分页',exact:true});await nav.scrollIntoViewIfNeeded();
  for(const name of ['首页','上一页','下一页','末页']){
    const button=nav.getByRole('button',{name,exact:true});await expect(button).toHaveAttribute('title',name);
    await expect(button).toHaveCSS('height','32px');await expect(button).toHaveCSS('width','32px');
    await expect(button).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
  }
  expect(await nav.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(nav.getByRole('spinbutton',{name:'跳转页码',exact:true})).toHaveCSS('border-top-width','0px');
  await expect(nav.getByRole('spinbutton',{name:'跳转页码',exact:true})).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  expect(await page.locator('html').evaluate(el=>el.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(nav.getByRole('button',{name:'首页',exact:true})).toBeDisabled();
  await nav.screenshot({path:`build/ui-refinement/pagination-${theme}-${width}.png`});
  await nav.getByRole('button',{name:'下一页',exact:true}).click();await expect(nav.locator('.pagination-position')).toHaveText('第 2 / 8 页');
  const input=nav.getByRole('spinbutton',{name:'跳转页码',exact:true});await input.fill('8');await input.press('Enter');
  await expect(nav.locator('.pagination-position')).toHaveText('第 8 / 8 页');await expect(nav.getByRole('button',{name:'末页',exact:true})).toBeDisabled();
  await input.fill('');await expect(nav.getByRole('button',{name:'跳转',exact:true})).toBeDisabled();
  await nav.getByRole('button',{name:'首页',exact:true}).click();await expect(nav.locator('.pagination-position')).toHaveText('第 1 / 8 页');
});
