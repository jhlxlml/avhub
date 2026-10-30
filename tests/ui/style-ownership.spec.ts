// Explicit renderer harness; desktop acceptance covers real window layout.
import {test,expect,type Locator} from '@playwright/test';
const metrics=(element:Locator)=>element.evaluate(node=>{
 const style=getComputedStyle(node);return {height:node.getBoundingClientRect().height,minHeight:style.minHeight,
   background:style.backgroundColor,color:style.color,border:style.borderTopWidth,font:style.fontSize};
});
test.beforeEach(async({request})=>{await request.post('/test/reset');await request.post('/api/playlists',{data:{name:'样式归属验收',media_id:1}});});
for(const theme of ['dark','light'])for(const width of [390,1440])test(`${theme} ${width}: dialog order does not change component style`,async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
 await page.setViewportSize({width,height:850});await page.goto('/');
 const settings=async()=>{
   await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
   const field=page.getByRole('combobox',{name:'起播方式',exact:true});await expect(field).toHaveCSS('min-height','32px');
   const result=await metrics(field);
   await expect(page.getByRole('checkbox',{name:'视频连播',exact:true})).toHaveCSS('width','30px');
   await page.getByText('高级播放设置',{exact:true}).click();
   const number=page.getByRole('spinbutton',{name:'鼠标侧键跳播时长',exact:true});
   await number.scrollIntoViewIfNeeded();const numeric=await metrics(number);expect(numeric.height).toBe(32);
   if(width===1440){
     const first=await field.boundingBox(),second=await number.boundingBox();
     expect(Math.abs(first!.x-second!.x)).toBeLessThanOrEqual(1);
     expect(Math.abs(first!.width-second!.width)).toBeLessThanOrEqual(1);
   }
   await page.getByRole('button',{name:'关闭设置',exact:true}).click();return {select:result,number:numeric};
 };
 const playlists=async()=>{
   await page.getByRole('button',{name:'播放列表',exact:true}).click();await expect(page.locator('.playlist-summary')).toBeVisible();
   const button=page.getByRole('button',{name:'从头播放',exact:true});const result=await metrics(button);expect(result.height).toBe(32);
   await expect(page.getByRole('searchbox',{name:'搜索播放列表视频',exact:true})).toHaveCSS('height','28px');
   expect(await page.locator('.playlist-workspace').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
   await page.getByRole('button',{name:'完成',exact:true}).click();return result;
 };
 const firstSettings=await settings(),firstPlaylist=await playlists();
 expect(await settings()).toEqual(firstSettings);expect(await playlists()).toEqual(firstPlaylist);
});
