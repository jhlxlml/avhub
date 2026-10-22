// Renderer component harness only. Native authorization uses Electron separately.
import {test,expect} from '@playwright/test';
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
  await row.getByRole('button',{name:/^更多目录操作 /}).click();const menu=row.getByRole('menu');await expect(menu).toBeVisible();
  const box=await menu.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(page.getByRole('dialog')).toBeVisible();
  await expect(row.getByRole('button',{name:/^更多目录操作 /})).toBeFocused();
});

test('removing an index uses explicit confirmation and never sends a file operation',async({page})=>{
  let deleted=0;page.on('request',r=>{if(r.method()==='DELETE'&&/\/api\/roots\/\d+$/.test(r.url()))deleted++;});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const row=page.locator('.directory-setting-row').first();await row.getByRole('button',{name:/^更多目录操作 /}).click();
  await row.getByRole('menuitem',{name:/移出媒体库/}).click();
  const confirm=page.getByRole('dialog',{name:'从媒体库移除目录？',exact:true});await expect(confirm).toContainText('原视频不会被删除');
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);expect(deleted).toBe(0);
  await expect(row.getByRole('button',{name:/^更多目录操作 /})).toBeFocused();
  await row.getByRole('button',{name:/^更多目录操作 /}).click();await row.getByRole('menuitem',{name:/移出媒体库/}).click();
  await confirm.getByRole('button',{name:'移除目录',exact:true}).click();await expect(page.locator('.directory-setting-row')).toHaveCount(1);expect(deleted).toBe(1);
});

test('cancelled removal restores focus on unlock without stealing a later keyboard choice',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const row=page.locator('.directory-setting-row').first();
  const trigger=row.getByRole('button',{name:/^更多目录操作 /});
  await trigger.click();await row.getByRole('menuitem',{name:/移出媒体库/}).click();
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
  await row.getByRole('button',{name:/^更多目录操作 /}).click();await expect(row.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Tab');await expect(row.getByRole('menu')).toHaveCount(0);await expect(page.getByRole('dialog')).toBeVisible();
});
