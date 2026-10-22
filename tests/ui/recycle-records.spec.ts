// Explicit renderer/bridge harness. Native bin acceptance is recycle-records.mjs.
import {test,expect} from '@playwright/test';
const entries=[
  {id:'a'.repeat(32),media_id:2,name:'待恢复.mp4',title:'待恢复',source:'D:\\media\\待恢复.mp4',size:1000,created_at:1,status:'available',error:''},
  {id:'b'.repeat(32),media_id:1,name:'已恢复.mp4',title:'已恢复',source:'D:\\media\\已恢复.mp4',size:2000,created_at:2,status:'restored',error:''},
  {id:'c'.repeat(32),media_id:3,name:'待核对.mp4',title:'待核对',source:'D:\\media\\待核对.mp4',size:2000,created_at:3,status:'review',error:'不能唯一确认'},
];
test.beforeEach(async({request,page})=>{
  await request.post('/test/reset');await page.addInitScript(fixture=>{
    const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).recordCalls=[];
    window.avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,fileOperation:async value=>{
      if(value.action==='preview-records')return {ok:true,preview_token:'e'.repeat(32),records:value.recordIds!.map(id=>{const item=fixture.find(item=>item.id===id)!;return {id,eligible:!['review','offline','pending'].includes(item.status),reason:'',action:value.recordAction==='delete'&&item.status!=='available'?'clear':value.recordAction!,name:item.name,source:item.source,size:item.size};})};
      if(value.action==='release-record-preview'||value.action==='cancel-preview')return {ok:true};
      (window as any).recordCalls.push(value);return {ok:true};}} as any;
  },entries);
  await page.route('**/api/recycle-records?**',route=>route.fulfill({json:{items:entries,total:3,page:1,pages:1}}));
});
for(const theme of ['dark','light'])for(const width of [390,1440])test(`${theme} ${width}: compact records and confirmation remain accessible and borderless`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.setViewportSize({width,height:820});await page.goto('/');
  await page.getByRole('button',{name:'回收记录',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await expect(panel).toHaveAccessibleDescription(/Windows 系统回收站/);
  const row=panel.locator('.recycle-record-list>li').first();
  await expect(row.getByRole('button',{name:'恢复',exact:true})).toHaveCSS('height','28px');
  await expect(panel.getByRole('button',{name:'全选本页',exact:true})).toHaveCSS('height','32px');
  await expect(panel.locator('.recycle-record-status').first()).toHaveCSS('border-top-width','0px');
  await expect(row.getByRole('checkbox')).toHaveCSS('width','16px');
  const cover=await row.locator('.recycle-record-cover').boundingBox(),name=await row.locator('strong').boundingBox();
  expect(name!.y).toBeLessThan(cover!.y+cover!.height);
  await row.getByRole('checkbox').check();await expect(row).toHaveAttribute('data-selected','true');
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await page.screenshot({path:`build/recycle-polish-${theme}-${width}.png`});
  await row.getByRole('button',{name:'永久删除 待恢复.mp4',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'永久删除 1 个视频？',exact:true});
  await expect(confirmation).toHaveAccessibleDescription(/无法通过回收站恢复/);
  await expect(confirmation.getByRole('button',{name:'取消确认',exact:true})).toBeFocused();
  await expect(confirmation.locator('.app-confirm-details')).toHaveCSS('border-top-width','0px');
  expect(await confirmation.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
});
for(const theme of ['dark','light'])test(`${theme}: toolbar placement, default empty selection, precise actions and matching modal style`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.goto('/');const organize=page.getByRole('button',{name:'批量整理',exact:true}),records=page.getByRole('button',{name:'回收记录',exact:true});
  const a=await organize.boundingBox(),b=await records.boundingBox();expect(b!.x).toBeGreaterThan(a!.x);expect(Math.abs(a!.y-b!.y)).toBeLessThan(3);
  await records.click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await expect(panel.locator('.recycle-record-list>li')).toHaveCount(3);await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(0);await expect(panel.getByRole('checkbox',{name:'选择回收记录 待核对.mp4'})).toBeDisabled();
  await panel.getByRole('button',{name:'永久删除 待恢复.mp4',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'永久删除 1 个视频？',exact:true});await expect(confirmation).toContainText('无法通过回收站恢复');await expect(confirmation).toContainText('不会清空整个系统回收站');
  expect(await confirmation.evaluate(el=>el.querySelector('.danger-action')===document.activeElement)).toBe(false);
  await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
  await panel.getByRole('button',{name:'恢复',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).recordCalls)).toEqual([{action:'restore-record',id:'a'.repeat(32),confirmed:false,previewToken:'e'.repeat(32)}]);
  await expect(panel.getByRole('button',{name:'关闭回收记录',exact:true})).toBeEnabled();await page.screenshot({path:`build/recycle-records-${theme}.png`});
  await page.setViewportSize({width:760,height:640});expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await panel.getByRole('button',{name:'关闭回收记录',exact:true}).click();await expect(panel).toHaveCount(0);
});
test('mixed batch selection explicitly confirms only recoverable files for deletion',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await panel.getByRole('checkbox',{name:'选择回收记录 待恢复.mp4'}).check();await panel.getByRole('checkbox',{name:'选择回收记录 已恢复.mp4'}).check();
  await panel.getByRole('button',{name:'删除文件及记录',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'永久删除 1 个视频？',exact:true});await expect(confirmation).toContainText('清除 1 条');
  await confirmation.getByRole('button',{name:'永久删除',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).recordCalls)).toEqual([{action:'delete-record',id:'a'.repeat(32),confirmed:true,previewToken:'e'.repeat(32)},{action:'clear-record',id:'b'.repeat(32),confirmed:false,previewToken:'e'.repeat(32)}]);
});

test('select all, invert and clear apply only to selectable current-page records',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await panel.getByRole('checkbox',{name:'选择回收记录 已恢复.mp4'}).check();
  await panel.getByRole('button',{name:'反选本页',exact:true}).click();
  await expect(panel.getByRole('checkbox',{name:'选择回收记录 待恢复.mp4'})).toBeChecked();
  await expect(panel.getByRole('checkbox',{name:'选择回收记录 已恢复.mp4'})).not.toBeChecked();
  await panel.getByRole('button',{name:'全选本页',exact:true}).click();
  await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(2);
  await expect(panel.getByRole('checkbox',{name:'选择回收记录 待核对.mp4'})).not.toBeChecked();
  await expect(panel.getByRole('button',{name:'全选本页',exact:true})).toBeDisabled();
  await panel.getByRole('button',{name:'反选本页',exact:true}).click();await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'全选本页',exact:true}).click();await panel.getByRole('button',{name:'取消选择',exact:true}).click();
  await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
});

test('page, search and refresh changes reset selection without selecting hidden records',async({page})=>{
  await page.route('**/api/recycle-records?**',route=>{
    const url=new URL(route.request().url()),second=url.searchParams.get('page')==='2';
    return route.fulfill({json:{items:second?[{...entries[0],id:'d'.repeat(32),name:'第二页.mp4'}]:entries,total:31,page:second?2:1,pages:2}});
  });
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await panel.getByRole('button',{name:'全选本页',exact:true}).click();await panel.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(panel.getByRole('checkbox',{name:'选择回收记录 第二页.mp4'})).toBeVisible();await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'全选本页',exact:true}).click();await panel.getByRole('button',{name:'刷新回收记录',exact:true}).click();await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'全选本页',exact:true}).click();await panel.getByRole('textbox',{name:'搜索回收记录'}).fill('待恢复');
  await expect(panel.getByRole('checkbox',{name:'选择回收记录 待恢复.mp4'})).toBeVisible();await expect(panel.getByRole('checkbox',{checked:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
});

test('single-item buttons are disabled immediately while search scope is changing',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/recycle-records?**',async route=>{if(new URL(route.request().url()).searchParams.get('q'))await gate;await route.fulfill({json:{items:entries,total:3,page:1,pages:1}});});
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await expect(panel.getByRole('button',{name:'恢复',exact:true})).toBeEnabled();
  await panel.getByRole('textbox',{name:'搜索回收记录'}).fill('新条件');
  await expect(panel.getByRole('button',{name:'恢复',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'永久删除 待恢复.mp4',exact:true})).toBeDisabled();
  release();await expect(panel.getByRole('button',{name:'恢复',exact:true})).toBeEnabled();expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
});

test('batch restoration shows live progress and stop leaves subsequent items untouched',async({page})=>{
  await page.route('**/api/recycle-records?**',route=>route.fulfill({json:{items:entries.slice(0,2).map(item=>({...item,status:'available'})),total:2,page:1,pages:1}}));
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await page.evaluate(()=>{const original=window.avhubDesktop!.fileOperation!;(window as any).recordStarted=0;window.avhubDesktop!.fileOperation=async value=>{
    if(value.action==='restore-record'){(window as any).recordStarted++;if((window as any).recordStarted===1)await new Promise<void>(resolve=>{(window as any).recordGate=resolve;});}return original(value);
  };});
  await panel.getByRole('button',{name:'全选本页',exact:true}).click();await panel.getByRole('button',{name:'恢复所选',exact:true}).click();
  await page.getByRole('dialog',{name:'恢复 2 个视频？',exact:true}).getByRole('button',{name:'恢复所选',exact:true}).click();
  await expect(panel.getByRole('region',{name:'回收操作进度'})).toContainText('0 / 2');await expect(panel.locator('[data-state="running"]')).toHaveCount(1);
  await panel.getByRole('button',{name:'停止后续操作',exact:true}).click();await page.evaluate(()=>(window as any).recordGate());
  await expect(panel.locator('[data-state="stopped"]')).toHaveCount(1);await expect(panel.locator('[data-state="success"]')).toHaveCount(1);expect(await page.evaluate(()=>(window as any).recordStarted)).toBe(1);
});

test('failed permanent deletion requires a fresh preview and another explicit confirmation to retry',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await page.evaluate(()=>{const original=window.avhubDesktop!.fileOperation!;(window as any).deleteAttempts=0;(window as any).recordPreviews=0;window.avhubDesktop!.fileOperation=async value=>{
    if(value.action==='preview-records')(window as any).recordPreviews++;
    if(value.action==='delete-record'&&++(window as any).deleteAttempts===1)throw new Error('文件占用，原回收项目仍在');return original(value);
  };});
  await panel.getByRole('button',{name:'永久删除 待恢复.mp4',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'永久删除 1 个视频？',exact:true});await confirmation.getByRole('button',{name:'永久删除',exact:true}).click();
  await expect(panel.locator('[data-state="failed"]')).toContainText('文件占用');const retry=panel.getByRole('button',{name:'重试失败项（重新核对）',exact:true});await expect(retry).toBeEnabled();await retry.click();await expect(confirmation).toBeVisible();
  expect(await page.evaluate(()=>(window as any).deleteAttempts)).toBe(1);await page.keyboard.press('Escape');await expect(retry).toBeEnabled();await retry.click();await confirmation.getByRole('button',{name:'永久删除',exact:true}).click();
  await expect(panel.locator('[data-state="success"]')).toHaveCount(1);expect(await page.evaluate(()=>(window as any).deleteAttempts)).toBe(2);expect(await page.evaluate(()=>(window as any).recordPreviews)).toBe(3);
});

test('stop during preflight labels all eligible tasks unstarted and never invokes a mutation',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await page.evaluate(()=>{const original=window.avhubDesktop!.fileOperation!;window.avhubDesktop!.fileOperation=async value=>{if(value.action==='preview-records')await new Promise<void>(resolve=>{(window as any).preflightGate=resolve;});return original(value);};});
  await panel.getByRole('button',{name:'永久删除 待恢复.mp4',exact:true}).click();await panel.getByRole('button',{name:'取消预检',exact:true}).click();await page.evaluate(()=>(window as any).preflightGate());
  await expect(panel.locator('[data-state="stopped"]')).toContainText('预检期间已停止');await expect(panel.locator('[data-state="queued"]')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);await expect(page.getByRole('dialog',{name:'永久删除 1 个视频？'})).toHaveCount(0);
});

test('closing pending record preflight cancels its scoped request without restoring or deleting',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();
  await page.evaluate(()=>{
    const w=window as any,original=window.avhubDesktop!.fileOperation!;
    window.avhubDesktop!.fileOperation=async value=>{
      if(value.action==='preview-records'){w.recordPreviewRequest=value.requestId;return new Promise((_resolve,reject)=>{w.rejectRecordPreview=reject;});}
      if(value.action==='cancel-preview'){w.recordPreviewCancelled=value.requestId;w.rejectRecordPreview(new Error('已取消预检，未执行文件修改'));return {ok:true};}
      return original(value);
    };
  });
  const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await panel.getByRole('button',{name:'恢复',exact:true}).click();await expect(panel.getByRole('button',{name:'取消预检',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'关闭回收记录',exact:true}).click();await expect(panel).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).recordPreviewCancelled)).toBe(await page.evaluate(()=>(window as any).recordPreviewRequest));
  expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
});

test('failure outside current page is located by record ID, not by a shared filename',async({page})=>{
  await page.route('**/api/recycle-records?**',route=>{const second=new URL(route.request().url()).searchParams.get('page')==='2';return route.fulfill({json:{items:second?[{...entries[1],id:'d'.repeat(32)}]:entries,total:31,page:second?2:1,pages:2}});});
  await page.route('**/api/recycle-records/*/location',route=>route.fulfill({json:{page:1,id:entries[0].id}}));
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await page.evaluate(()=>{const original=window.avhubDesktop!.fileOperation!;window.avhubDesktop!.fileOperation=async value=>{if(value.action==='restore-record')throw new Error('文件占用');return original(value);};});
  await panel.getByRole('button',{name:'恢复',exact:true}).click();await expect(panel.locator('[data-state="failed"]')).toHaveCount(1);
  await expect(panel.getByRole('button',{name:'下一页',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(panel.getByRole('button',{name:'重试失败项（重新核对）',exact:true})).toBeDisabled();await expect(panel).toContainText('不在当前页');
  const locate=panel.getByRole('button',{name:'定位失败记录 待恢复.mp4',exact:true});await expect(locate).toBeEnabled();await locate.click({noWaitAfter:true});await expect(panel.locator(`[data-recycle-id="${entries[0].id}"]`)).toBeFocused();
  await expect(panel.getByRole('button',{name:'重试失败项（重新核对）',exact:true})).toBeEnabled();expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
});

test('file-state deep link opens exact page and focuses its record',async({page})=>{
  await page.route('**/api/file-states?**',route=>route.fulfill({json:{items:[{id:2,name:entries[0].name,title:entries[0].title,path:entries[0].source,status:'recycled',recycle_id:entries[0].id}],total:1,page:1,pages:1}}));
  await page.route('**/api/recycle-records/*/location',route=>route.fulfill({json:{page:2}}));
  await page.route('**/api/recycle-records?**',route=>{const second=new URL(route.request().url()).searchParams.get('page')==='2';return route.fulfill({json:{items:second?[entries[0]]:[entries[1]],total:31,page:second?2:1,pages:2}});});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();await page.getByRole('button',{name:'查看回收记录',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'回收记录',exact:true});await expect(panel.locator(`[data-recycle-id="${entries[0].id}"]`)).toBeFocused();await expect(panel).toContainText('2 / 2 页');expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
});

test('cleared deep-link record reports failure without changing files',async({page})=>{
  await page.route('**/api/file-states?**',route=>route.fulfill({json:{items:[{id:2,name:entries[0].name,title:entries[0].title,path:entries[0].source,status:'recycled',recycle_id:entries[0].id}],total:1,page:1,pages:1}}));
  await page.route('**/api/recycle-records/*/location',route=>route.fulfill({status:404,json:{detail:'记录已清除'}}));
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'数据管理',exact:true}).click();await page.getByRole('button',{name:'查看回收记录',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'回收记录',exact:true});await expect(panel).toContainText('无法定位回收记录');await expect(panel).toContainText('记录已清除');await expect(panel.getByRole('button',{name:'关闭回收记录',exact:true})).toBeEnabled();expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
});

test('expired batch stops later items and continuation preflights and confirms again',async({page})=>{
  await page.route('**/api/recycle-records?**',route=>route.fulfill({json:{items:entries.map(item=>item.id===entries[1].id?{...item,status:'available'}:item),total:3,page:1,pages:1}}));
  await page.goto('/');await page.getByRole('button',{name:'回收记录',exact:true}).click();const panel=page.getByRole('dialog',{name:'回收记录',exact:true});
  await page.evaluate(()=>{const original=window.avhubDesktop!.fileOperation!;(window as any).freshPreviews=0;window.avhubDesktop!.fileOperation=async value=>{if(value.action==='preview-records'){(window as any).freshPreviews++;const result=await original(value);return {...result,records:result.records!.map(item=>({...item,action:'delete' as const}))};}if(value.action==='delete-record'&&value.id==='a'.repeat(32))throw new Error('操作预览已失效，请重新核对');return original(value);};});
  await panel.getByRole('button',{name:'全选本页',exact:true}).click();await panel.getByRole('button',{name:'永久删除',exact:true}).click();await page.getByRole('dialog',{name:'永久删除 2 个视频？',exact:true}).getByRole('button',{name:'永久删除',exact:true}).click();
  await expect(panel.locator('[data-state="stopped"]')).toHaveCount(1);expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
  await panel.getByRole('button',{name:'继续未执行项（重新核对）',exact:true}).click();const confirm=page.getByRole('dialog',{name:'永久删除 1 个视频？',exact:true});await expect(confirm).toBeVisible();expect(await page.evaluate(()=>(window as any).freshPreviews)).toBe(2);expect(await page.evaluate(()=>(window as any).recordCalls)).toEqual([]);
  await confirm.getByRole('button',{name:'永久删除',exact:true}).click();await expect(panel.locator('[data-state="success"]')).toHaveCount(1);expect(await page.evaluate(()=>(window as any).recordCalls.map((value:any)=>value.id))).toEqual(['b'.repeat(32)]);
});
