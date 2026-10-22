// Component harness. Native desktop acceptance is run separately.
import {test,expect,type Locator} from '@playwright/test';
async function borderless(control:Locator){
  const colors=await control.evaluate(el=>{const s=getComputedStyle(el);return [s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor];});
  expect(colors.every(c=>c==='rgba(0, 0, 0, 0)')).toBe(true);
}
test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light'])test(`${theme}: equal-level controls are borderless and retain keyboard focus`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  const controls=[page.locator('.folder-filter'),page.getByRole('combobox',{name:'排序方式',exact:true}),page.getByRole('button',{name:/^更多筛选/}),page.getByRole('button',{name:'调整封面大小',exact:true})];
  for(const control of controls){await borderless(control);expect((await control.boundingBox())!.height).toBe(32);}
  for(const group of ['.resolution-filter','.library-view-controls .switch'])await expect(page.locator(group)).toHaveCSS('height','32px');
  await page.getByRole('button',{name:/^更多筛选/}).click();await borderless(page.getByRole('button',{name:/^更多筛选/}));
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();const dialog=page.getByRole('dialog');
  for(const name of ['添加目录','浏览本地文件夹']){const button=dialog.getByRole('button',{name,exact:true});await borderless(button);expect((await button.boundingBox())!.height).toBe(32);}
  const input=page.getByRole('textbox',{name:'目录路径',exact:true});await borderless(input);await input.fill('D:\\Unsaved-borderless');
  await input.focus();await page.keyboard.press('Tab');const add=dialog.getByRole('button',{name:'添加目录',exact:true});
  await expect(add).toBeFocused();await expect(add).toHaveCSS('outline-style','solid');
  await input.fill('');await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await borderless(page.getByRole('combobox',{name:'起播方式',exact:true}));
  await page.screenshot({path:`build/ui-refinement/borderless-settings-${theme}.png`});
});
