// Component harness only; desktop acceptance runs in real Electron separately.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});

for(const theme of ['dark','light'])for(const width of [390,720,1024,1440])test(`${theme} ${width}: header icon slots and gaps are equal, including scan recovery`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.route('**/api/scan',route=>route.request().method()==='GET'?route.fulfill({json:{id:'header-test',root_id:null,state:'interrupted',total:0,processed:0,updated:0,current:'',error_count:0,errors:[],started_at:0,finished_at:null}}):route.continue());
  await page.setViewportSize({width,height:900});await page.goto('/');await expect(page.getByRole('button',{name:'继续上次扫描',exact:true})).toBeVisible();
  const controls=page.locator('.header-search>.search-toggle,.header-actions>.scan-recovery,.header-actions>.ui-icon-button');
  await expect(controls).toHaveCount(7);
  const boxes=await controls.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
  for(let i=0;i<boxes.length;i++){
    expect(boxes[i].width).toBe(32);expect(boxes[i].height).toBe(32);expect(boxes[i].y).toBe(boxes[0].y);
    if(i)expect(Math.abs(boxes[i].x-boxes[i-1].x-boxes[i-1].width-6)).toBeLessThan(.1);
  }
  await expect(page.locator('.header-search')).toHaveCSS('width','32px');
  await page.locator('.header-actions').screenshot({path:`build/ui-refinement/header-icons-${theme}-${width}.png`});
  await page.getByRole('button',{name:'搜索视频',exact:true}).click();await expect(page.getByRole('textbox',{name:'搜索视频',exact:true})).toBeVisible();
  expect(await page.locator('.header-actions').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.getByRole('button',{name:'收起搜索',exact:true}).click();await expect(page.locator('.header-search')).toHaveCSS('width','32px');
});

test('cover sizing enters the slider and exits naturally by Tab or Escape',async({page})=>{
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  const trigger=page.getByRole('button',{name:'调整封面大小',exact:true});
  const panel=page.getByRole('group',{name:'封面大小设置'});
  await trigger.click();await expect(page.getByRole('slider',{name:'封面大小',exact:true})).toBeFocused();
  await page.keyboard.press('End');await expect(page.locator('html')).toHaveAttribute('data-cover-size','large');
  await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
  await trigger.click();await page.keyboard.press('Shift+Tab');await expect(trigger).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('slider',{name:'封面大小',exact:true})).toBeFocused();
  for(let i=0;i<5;i++)await page.keyboard.press('Tab');
  await expect(panel).toHaveCount(0);await expect(trigger).not.toBeFocused();
  await trigger.click();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await expect(panel).toHaveCount(0);await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});

for(const theme of ['dark','light'])test(`${theme}: cover keyboard focus reveals secondary actions without darkening the picture`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.goto('/');const card=page.locator('.card').first();await page.mouse.move(0,0);
  await expect(card.locator('.star')).toHaveCSS('opacity','0');
  const open=card.locator('.open-video');await open.focus();
  await expect(card.locator('.star')).toHaveCSS('opacity','1');await expect(card.locator('.queue-add')).toHaveCSS('opacity','1');
  await expect(open).toHaveCSS('filter','none');await expect(open).toHaveCSS('opacity','1');
  await page.keyboard.press('Tab');await expect(card.locator('.star')).toBeFocused();
  await page.keyboard.press('Space');await expect(card.locator('.star')).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'搜索视频',exact:true}).focus();await expect(card.locator('.star')).toHaveCSS('opacity','0');
});

test('directory tree has one Tab stop, arrow navigation and a fallback after collapse/filtering',async({page,request})=>{
  await request.post('/test/folder-fixture');await page.goto('/');
  await page.getByRole('button',{name:'显示目录树',exact:true}).click();
  const tree=page.getByRole('tree',{name:'媒体目录树'}),sidebar=page.getByRole('complementary',{name:'多级目录树'});
  const stops=tree.locator('[role="treeitem"][tabindex="0"]');await expect(stops).toHaveCount(1);
  const collapse=sidebar.getByRole('button',{name:'全部收起目录',exact:true});await expect(collapse).toBeDisabled();
  const root=tree.getByRole('treeitem',{name:'folder-library',exact:true});await root.focus();await page.keyboard.press('ArrowRight');
  const drama=tree.getByRole('treeitem',{name:'Drama',exact:true});await expect(drama).toBeVisible();
  await page.keyboard.press('ArrowDown');await expect(tree.getByRole('treeitem',{name:'100%_clips',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(drama).toBeFocused();await expect(stops).toHaveCount(1);
  await page.keyboard.press('ArrowRight');const season=tree.getByRole('treeitem',{name:'Season 1',exact:true});await expect(season).toBeVisible();
  await page.keyboard.press('ArrowDown');await expect(season).toBeFocused();await page.keyboard.press('ArrowLeft');await expect(drama).toBeFocused();
  await page.keyboard.press('ArrowLeft');await expect(season).toHaveCount(0);await expect(stops).toHaveCount(1);
  await collapse.click();await expect(collapse).toBeDisabled();await expect(stops).toHaveCount(1);
  await sidebar.getByRole('searchbox').fill('no-such-folder');await expect(tree.getByRole('treeitem')).toHaveCount(0);
  await sidebar.getByRole('searchbox').fill('');await expect(stops).toHaveCount(1);
  await sidebar.getByRole('button',{name:'全部目录',exact:true}).focus();await page.keyboard.press('Tab');await expect(stops).toBeFocused();
  await page.keyboard.press('Tab');expect(await tree.evaluate(el=>el.contains(document.activeElement))).toBe(false);
});

test('directory branch paging preserves a reachable Tab stop after removing the focused row',async({page,request})=>{
  await request.post('/test/many-subfolders');await page.goto('/');
  await page.getByRole('button',{name:'显示目录树',exact:true}).click();
  await page.getByRole('button',{name:'展开目录 many-subfolders',exact:true}).click();
  const tree=page.getByRole('tree',{name:'媒体目录树'}),child=tree.getByRole('treeitem',{name:'folder-00000',exact:true});
  await child.focus();await expect(child).toHaveAttribute('tabindex','0');
  await tree.getByRole('button',{name:'下一页目录 many-subfolders',exact:true}).click();
  await expect(tree.getByRole('treeitem',{name:'folder-00040',exact:true})).toBeVisible();
  await expect(child).toHaveCount(0);await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
  await expect(tree.getByRole('treeitem',{name:'many-subfolders',exact:true})).toHaveAttribute('tabindex','0');
});
