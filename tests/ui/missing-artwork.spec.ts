// Renderer harness. Actual cache deletion is accepted separately in Electron.
import {test,expect} from '@playwright/test';

const note='仅清理所选自动封面；保留索引、收藏、进度、片单和手动封面。';
const item=(id:number,eligible=true,reason='可清理自动封面')=>({id,title:`失效视频 ${id} · 很长的视频标题`.repeat(3),path:`E:\\示例目录\\${'多级目录\\'.repeat(12)}${id}.mp4`,root_path:'E:\\示例目录',eligible,bytes:32768,reason,manual_cover_kept:id===1});

for(const theme of ['dark','light'])for(const width of [390,1440])test(`${theme} ${width}: missing artwork uses explicit preview, selection and themed confirmation`,async({page,request})=>{
 await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
 await page.setViewportSize({width,height:900});let previews=0,cleans=0,cleaned=false;
 await page.route('**/api/storage/missing-artwork?**',route=>{previews++;return route.fulfill({json:{items:[item(1,!cleaned,cleaned?'没有可清理的自动封面':'可清理自动封面'),item(2,false,'目录离线或不可访问'),item(3,false,'回滚副本仍引用此封面')],total:3,page:1,pages:1,page_size:24,token:'a'.repeat(64),eligible_count:cleaned?0:1,eligible_bytes:cleaned?0:32768,note}});});
 await page.route('**/api/storage/missing-artwork/cleanup',route=>{cleans++;expect(route.request().postDataJSON()).toEqual({token:'a'.repeat(64),media_ids:[1],page:1,page_size:24});cleaned=true;return route.fulfill({json:{removed:1,freed_bytes:32768,skipped:0}});});
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();
 const panel=page.getByRole('region',{name:'失效视频与封面',exact:true});await expect(panel).toBeVisible();expect(previews).toBe(0);
 await panel.getByRole('button',{name:'预览失效封面',exact:true}).click();await expect(panel.locator('li')).toHaveCount(3);
 await expect(panel.getByRole('checkbox').nth(1)).toBeDisabled();await expect(panel.getByRole('checkbox').nth(2)).toBeDisabled();
 await expect(panel.getByRole('button',{name:'清理所选封面',exact:true})).toBeDisabled();
 await panel.getByRole('button',{name:'选中本页可清理项',exact:true}).click();await expect(panel.getByRole('checkbox').first()).toBeChecked();
 await panel.getByRole('button',{name:'清理所选封面（1）',exact:true}).click();
 const confirm=page.getByRole('dialog',{name:'清理所选自动封面？',exact:true});await expect(confirm).toContainText('原视频不会删除');
 await confirm.getByRole('button',{name:'取消',exact:true}).click();expect(cleans).toBe(0);
 expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await panel.screenshot({path:`build/ui-refinement/missing-artwork-${theme}-${width}.png`});
 await panel.getByRole('button',{name:'清理所选封面（1）',exact:true}).click();await page.getByRole('dialog',{name:'清理所选自动封面？',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
 await expect(panel).toContainText('已清理 1 张自动封面');expect(cleans).toBe(1);await expect(panel.getByRole('checkbox').first()).toBeDisabled();
 await expect(panel.getByRole('button',{name:'清理所选封面',exact:true})).toBeDisabled();
});

test('page changes reset selection and a stale preview requires a fresh explicit preview',async({page,request})=>{
 await request.post('/test/reset');
 await page.route('**/api/storage/missing-artwork?**',route=>{const p=Number(new URL(route.request().url()).searchParams.get('page'));return route.fulfill({json:{items:[item(p)],total:48,page:p,pages:2,page_size:24,token:'b'.repeat(64),eligible_count:1,eligible_bytes:32768,note}});});
 await page.route('**/api/storage/missing-artwork/cleanup',route=>route.fulfill({status:409,json:{detail:'失效封面或目录状态已变化，请刷新预览后重新选择'}}));
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();
 const panel=page.getByRole('region',{name:'失效视频与封面',exact:true});await panel.getByRole('button',{name:'预览失效封面',exact:true}).click();
 await panel.getByRole('button',{name:'选中本页可清理项',exact:true}).click();await panel.getByRole('button',{name:'下一页缺失视频',exact:true}).click();
 await expect(panel.getByRole('checkbox').first()).not.toBeChecked();await expect(panel).toContainText('第 2 / 2 页');
 await panel.getByRole('checkbox').first().check();await panel.getByRole('button',{name:'清理所选封面（1）',exact:true}).click();
 await page.getByRole('dialog',{name:'清理所选自动封面？',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
 await expect(panel.getByRole('alert')).toContainText('请刷新预览后重新选择');await expect(panel.getByRole('checkbox')).toHaveCount(0);
 await expect(panel.getByRole('button',{name:'清理所选封面',exact:true})).toBeDisabled();
});
