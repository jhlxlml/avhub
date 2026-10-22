// Component harness: desktop acceptance is run separately in real Electron.
import {test,expect} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
test('deep folders keep readable name space without changing semantic depth',async({page,request})=>{
  await request.post('/test/folder-fixture');
  await page.route('**/api/roots/50/folders?**',route=>{
    const params=new URL(route.request().url()).searchParams,folder=params.get('folder')||'';
    const depth=folder?folder.split('/').length:0,name=`第 ${depth+1} 层 · 很长的目录名称`;
    return route.fulfill({json:{items:[{name,folder:folder?`${folder}/${name}`:name,count:12345,has_children:depth<8}],page:1,pages:1,total:1,video_count:12345,direct_count:0}});
  });
  await page.goto('/');await page.getByRole('button',{name:'显示目录树',exact:true}).click();
  await page.getByRole('button',{name:'展开目录 folder-library',exact:true}).click();
  for(let depth=1;depth<=8;depth++)await page.getByRole('button',{name:`展开目录 第 ${depth} 层 · 很长的目录名称`,exact:true}).click();
  const leaf=page.getByRole('treeitem',{name:'第 9 层 · 很长的目录名称',exact:true});
  await expect(leaf).toHaveAttribute('aria-level','10');await expect(leaf).toHaveCSS('padding-left','58px');
  expect(await leaf.locator('.tree-node-name').evaluate(el=>el.clientWidth)).toBeGreaterThan(50);
  await expect(leaf.locator('small')).toHaveText('12,345');
});
for(const theme of ['light','dark']) {
  test(`${theme}: folder navigation remains compact, borderless and accessible`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    await request.post('/test/folder-fixture');
    await page.setViewportSize({width:608,height:740});await page.goto('/?root=50');
    await page.getByRole('button',{name:'浏览子目录',exact:true}).click();
    const trigger=page.getByRole('button',{name:'浏览子目录',exact:true});
    const content=page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);
    await expect(content).toBeVisible();
    const folder=page.getByRole('button',{name:'打开子目录 Drama',exact:true});
    await expect(folder).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
    await folder.click();await expect(page).toHaveURL(/folder=Drama/);
    await page.getByRole('button',{name:'显示目录树',exact:true}).click();
    const selected=page.getByRole('treeitem',{name:'Drama',exact:true});
    await expect(selected).toHaveAttribute('aria-selected','true');
    await expect(selected).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
    expect(await page.locator('.app-layout').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
    await page.screenshot({path:`build/ui-refinement/directory-detail-${theme}.png`});
  });
  test(`${theme}: invalid metadata focuses the field and preserves the draft`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    await page.goto('/?video=2');await page.getByText('编辑媒体信息',{exact:true}).click();
    const editor=page.locator('.media-editor'),title=editor.getByRole('textbox',{name:'显示标题',exact:true});
    await title.fill('   ');await editor.getByRole('button',{name:'保存信息',exact:true}).click();
    await expect(title).toBeFocused();await expect(title).toHaveAttribute('aria-invalid','true');
    await expect(editor.getByRole('alert')).toContainText('标题不能为空');
    await title.fill('保留的编辑草稿');await expect(title).not.toHaveAttribute('aria-invalid','true');
    await page.route('**/api/media/2',route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{detail:'测试保存失败'}}):route.continue());
    await editor.getByRole('button',{name:'保存信息',exact:true}).click();
    await expect(editor.getByRole('alert')).toContainText('测试保存失败');
    await expect(title).toHaveValue('保留的编辑草稿');
    await expect(editor.getByRole('button',{name:'保存信息',exact:true})).toBeEnabled();
  });
}
