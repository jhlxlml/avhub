// Renderer component harness only. Native authorization uses Electron separately.
import {test,expect} from '@playwright/test';

for(const theme of ['dark','light'])for(const width of [390,1440])test(`${theme} ${width}px: directory reads expose errors and retry without granting permissions or writing files`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.setViewportSize({width,height:900});
  let permissions=0,status=0,writes=0;
  page.on('request',request=>{if(request.method()!=='GET'&&/\/api\/file-(?:permissions|operations)/.test(request.url()))writes++;});
  await page.route('**/api/file-permissions?**',route=>++permissions===1?route.fulfill({status:503,json:{detail:'权限读取测试失败'}}):route.continue());
  await page.route('**/api/roots/status?**',route=>++status===1?route.fulfill({status:503,json:{detail:'目录状态测试失败'}}):route.continue());
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'权限读取测试失败'})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText:'目录状态测试失败'})).toBeVisible();
  const alert=page.getByRole('alert').filter({hasText:'权限读取测试失败'});
  const copy=await alert.locator('.settings-read-error-copy').boundingBox(),action=await alert.getByRole('button').boundingBox();
  expect(copy!.x+copy!.width<=action!.x+.1||copy!.y+copy!.height<=action!.y+.1).toBe(true);
  expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:`build/ui-refinement/directory-read-error-${theme}-${width}.png`});
  const row=page.locator('.directory-setting-row').first();await row.getByRole('button',{name:/^文件权限 /}).click();
  await expect(row.getByRole('checkbox',{name:/^允许重命名/})).toBeDisabled();
  await page.getByRole('button',{name:'重试文件权限',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'权限读取测试失败'})).toHaveCount(0);
  await expect(row.locator('.directory-setting-meta')).not.toContainText('权限暂未读取');
  await page.getByRole('button',{name:'重试目录状态',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'目录状态测试失败'})).toHaveCount(0);
  expect(permissions).toBe(2);expect(status).toBe(2);expect(writes).toBe(0);
});
test.beforeEach(async({request})=>{await request.post('/test/reset');});

for(const theme of ['dark','light'])for(const width of [390,1440])test(`${theme} ${width}px: directory rows and expanded permissions share a compact layout`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.setViewportSize({width,height:850});await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const rows=page.locator('.directory-setting-row'),row=rows.first();await expect(rows).toHaveCount(2);
  await expect(row.getByRole('checkbox')).toHaveCount(0);await expect(row.locator('.directory-setting-meta')).toContainText('只读');
  await expect(row.getByRole('button',{name:'扫描此目录',exact:true})).toBeVisible();
  await row.getByRole('button',{name:/^文件权限 /}).click();await expect(row.getByRole('checkbox')).toHaveCount(3);
  await expect(row.getByRole('checkbox',{name:/^允许永久删除/})).not.toBeChecked();
  expect(await row.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:`build/ui-refinement/directory-settings-${theme}-${width}.png`});
  const scan=await row.getByRole('button',{name:'扫描此目录',exact:true}).boundingBox(),remove=await row.getByRole('button',{name:/^移出媒体库 /}).boundingBox();
  expect(remove!.x).toBeGreaterThan(scan!.x);expect(remove!.y).toBe(scan!.y);expect(remove!.height).toBe(scan!.height);
  await expect(row.getByRole('button',{name:/^更多目录操作 /})).toHaveCount(0);
});

test('removing an index uses explicit confirmation and never sends a file operation',async({page})=>{
  let deleted=0;page.on('request',r=>{if(r.method()==='DELETE'&&/\/api\/roots\/\d+$/.test(r.url()))deleted++;});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const row=page.locator('.directory-setting-row').first();await row.getByRole('button',{name:/^移出媒体库 /}).click();
  const confirm=page.getByRole('dialog',{name:'从媒体库移除目录？',exact:true});await expect(confirm).toContainText('原视频不会被删除');
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);expect(deleted).toBe(0);
  await expect(row.getByRole('button',{name:/^移出媒体库 /})).toBeFocused();
  await row.getByRole('button',{name:/^移出媒体库 /}).click();
  await confirm.getByRole('button',{name:'移除目录',exact:true}).click();await expect(page.locator('.directory-setting-row')).toHaveCount(1);expect(deleted).toBe(1);
});

test('cancelled removal restores focus on unlock without stealing a later keyboard choice',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const row=page.locator('.directory-setting-row').first();
  const trigger=row.getByRole('button',{name:/^移出媒体库 /});
  await trigger.click();
  const confirm=page.getByRole('dialog',{name:'从媒体库移除目录？',exact:true});await expect(confirm).toBeVisible();
  // Hold callbacks *after* native frame delivery. The old delayed restoration
  // deterministically stole focus when these frames were released later.
  await page.evaluate(()=>{
    const win=window as any,original=window.requestAnimationFrame;
    win.__heldDirectoryFrames=[];
    window.requestAnimationFrame=callback=>original(time=>win.__heldDirectoryFrames.push(()=>callback(time)));
    win.__releaseDirectoryFrames=()=>{window.requestAnimationFrame=original;for(const run of win.__heldDirectoryFrames.splice(0))run();};
  });
  try{
    await confirm.getByRole('button',{name:'取消',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
    await expect(confirm).toHaveCount(0);await expect(trigger).toBeEnabled();await expect(trigger).toBeFocused();
    const toggle=page.getByRole('checkbox',{name:'封面悬停预览',exact:true}),before=await toggle.isChecked();
    await toggle.focus();await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,80)));
    await page.evaluate(()=>(window as any).__releaseDirectoryFrames());
    await expect(toggle).toBeFocused();await page.keyboard.press('Space');await expect(toggle).toBeChecked({checked:!before});
    await page.keyboard.press('Space');await expect(toggle).toBeChecked({checked:before});
    await expect(page.locator('.directory-setting-row')).toHaveCount(2);
  }finally{await page.evaluate(()=>(window as any).__releaseDirectoryFrames());}
});

test('opening and closing permission details cannot grant access',async({page})=>{
  let calls=0;await page.exposeFunction('permissionCall',()=>{calls++;});
  await page.addInitScript(()=>{const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,fileOperation:async()=>{await (window as any).permissionCall();return {ok:true};}};});
  await page.route('**/api/file-permissions?**',r=>r.fulfill({json:[1,2].map(root_id=>({root_id,supported:true,rename:false,recycle:false,permanentDelete:false,reason:''}))}));
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();const row=page.locator('.directory-setting-row').first();
  const toggle=row.getByRole('button',{name:/^文件权限 /});await toggle.click();
  await row.getByRole('checkbox',{name:/^允许重命名/}).click();await page.getByRole('dialog',{name:'开启文件整理权限？',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await expect(row.getByRole('checkbox',{name:/^允许重命名/})).not.toBeChecked();await toggle.click();expect(calls).toBe(0);
  await expect(row.locator('.directory-setting-meta')).toContainText('只读');
});

test('permission failure stays unchanged and a retry can enable then disable',async({page})=>{
  let writes=0;await page.exposeFunction('savePermission',()=>({ok:++writes>1}));
  await page.addInitScript(()=>{const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,fileOperation:async()=>await (window as any).savePermission()};});
  await page.route('**/api/file-permissions?**',r=>r.fulfill({json:[1,2].map(root_id=>({root_id,supported:true,rename:false,recycle:false,permanentDelete:false,reason:''}))}));
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();const row=page.locator('.directory-setting-row').first();await row.getByRole('button',{name:/^文件权限 /}).click();
  const checkbox=row.getByRole('checkbox',{name:/^允许重命名/}),confirm=page.getByRole('dialog',{name:'开启文件整理权限？',exact:true});
  for(let attempt=0;attempt<2;attempt++){
    await checkbox.click();await expect(confirm).toBeVisible();await confirm.getByRole('button',{name:'开启权限',exact:true}).click();await expect(checkbox).toBeEnabled();
    await expect(checkbox).toBeChecked({checked:attempt===1});
    if(!attempt)await expect(page.getByRole('alert').filter({hasText:'权限保存未确认'})).toBeVisible();
  }
  await checkbox.click();await expect(checkbox).toBeEnabled();await expect(checkbox).not.toBeChecked();await expect(confirm).toHaveCount(0);expect(writes).toBe(3);
});

for(const theme of ['dark','light'])for(const width of [390,1440])test(`${theme} ${width}: data actions and status controls align`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.addInitScript(()=>{const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,dataLocation:async()=>({current:'D:\\AVHub-data',default:'D:\\AVHub-data',next:'D:\\AVHub-data',locked:false})};});
  await page.setViewportSize({width,height:900});await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  const data=page.getByRole('region',{name:'应用数据目录',exact:true}),buttons=data.locator('.app-data-actions button');await expect(buttons).toHaveCount(3);
  const boxes=await buttons.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height,y:r.y};}));
  for(const box of boxes){expect(box.height).toBe(32);expect(Math.abs(box.width-boxes[0].width)).toBeLessThan(1);if(width>600)expect(box.y).toBe(boxes[0].y);}
  const states=page.getByRole('region',{name:'文件状态管理',exact:true}),select=await states.getByRole('combobox').boundingBox(),refresh=await states.getByRole('button',{name:'刷新状态',exact:true}).boundingBox();
  expect(refresh!.height).toBe(select!.height);if(width>600)expect(refresh!.y).toBe(select!.y);
  expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await data.screenshot({path:`build/ui-refinement/data-actions-${theme}-${width}.png`});
  await states.screenshot({path:`build/ui-refinement/file-state-toolbar-${theme}-${width}.png`});
});

test('long directory paths truncate without pushing actions outside a narrow window',async({page})=>{
  const path='D:\\'+('很长的媒体目录名称\\'.repeat(18))+'视频';
  await page.route(/\/api\/roots(?:\?.*)?$/,async route=>{
    if(route.request().method()!=='GET')return route.continue();
    const response=await route.fetch();const values=await response.json();values[0].path=path;await route.fulfill({response,json:values});
  });
  await page.setViewportSize({width:390,height:850});await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const row=page.locator('.directory-setting-row').first();await expect(row.locator('code')).toHaveAttribute('title',path);
  await expect(row.getByRole('button',{name:'扫描此目录',exact:true})).toBeVisible();
  expect(await row.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const remove=row.getByRole('button',{name:/^移出媒体库 /});await expect(remove).toBeVisible();
  const box=await remove.boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(390);
});
