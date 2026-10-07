import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});

test('settings have accessible compact categories and lazy storage diagnostics',async({page})=>{
  await page.setViewportSize({width:390,height:844});let reads=0;
  page.on('request',r=>{if(r.url().includes('/api/storage'))reads++;});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await expect(page.getByRole('tablist',{name:'设置分类'})).toBeVisible();expect(reads).toBe(0);
  await expect(page.getByRole('tab',{name:'媒体目录'})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'媒体目录'}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'播放偏好'})).toBeFocused();await expect(page.getByRole('region',{name:'起播方式设置'})).toBeVisible();await expect(page.getByLabel('封面悬停预览')).not.toBeVisible();
  await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'数据管理'})).toBeFocused();
  await expect(page.locator('.storage-sizes>div')).toHaveCount(8);await expect(page.locator('.storage-sizes')).toContainText('无损播放副本');expect(reads).toBe(1);
  expect(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/settings-data-mobile.png'});
  await page.getByRole('tab',{name:'运行诊断'}).click();await page.locator('.runtime-diagnostics summary').click();
  await expect(page.locator('.diagnostic-fields')).toContainText('异常现场');await page.screenshot({path:'test-results/settings-diagnostics-mobile.png'});
});

test('cleanup preview explicitly confirms and refuses stale contents',async({page})=>{
  let calls=0;
  await page.route('**/api/storage',route=>route.fulfill({json:{total_bytes:12,categories:{thumbnails:{bytes:12,files:2}},cleanup:{files:1,bytes:6,rollback_files:0,rollback_days:null,token:'a'.repeat(64),protected_note:'原视频和手动封面不清理'}}}));
  await page.route('**/api/storage/cleanup',route=>{calls++;return route.fulfill({status:409,json:{detail:'可清理内容已变化，请刷新预览后再确认'}});});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置'}).click();await page.getByRole('tab',{name:'数据管理'}).click();
  await expect(page.locator('.storage-preview')).toContainText('可清理 1 个');expect(calls).toBe(0);
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'清理已预览内容'}).click();expect(calls).toBe(0);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'清理已预览内容'}).click();
  await expect(page.getByRole('alert')).toContainText('可清理内容已变化');expect(calls).toBe(1);await expect(page.getByRole('button',{name:'关闭设置'})).toBeEnabled();
});

test('backup cancellation is explicit and busy settings cannot dismiss',async({page})=>{
  let cancelled=false;
  const value=()=>({id:'a'.repeat(32),kind:'backup',state:cancelled?'cancelled':'running',stage:cancelled?'cancelled':'checksumming',done:2,total:10,cancellable:!cancelled,error:'',result:null});
  await page.route('**/api/data-jobs/backup',route=>route.fulfill({status:202,json:value()}));
  await page.route(`**/api/data-jobs/${'a'.repeat(32)}`,route=>route.fulfill({json:value()}));
  await page.route(`**/api/data-jobs/${'a'.repeat(32)}/cancel`,route=>{cancelled=true;return route.fulfill({json:value()});});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置'}).click();await page.getByRole('tab',{name:'数据管理'}).click();
  await page.getByRole('button',{name:'保存完整备份'}).click();await expect(page.getByRole('button',{name:'取消数据任务'})).toBeVisible();
  await expect(page.getByRole('button',{name:'关闭设置'})).toBeDisabled();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'取消数据任务'}).click();await expect(page.getByRole('button',{name:'关闭设置'})).toBeEnabled();
  await expect(page.getByText('任务已取消，原媒体库未被替换',{exact:true})).toBeVisible();
});

test('restore commit disables cancellation, navigation and dismissal until completion',async({page,request})=>{
  const payload=await(await request.get('/api/backup')).body();let identity='';let committing=false;
  page.on('response',async response=>{if(response.url().endsWith('/api/data-jobs/inspect')){try{identity=(await response.json()).id;}catch{}}});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置'}).click();await page.getByRole('tab',{name:'数据管理'}).click();
  await page.getByLabel('选择备份文件').setInputFiles({name:'library.db',mimeType:'application/octet-stream',buffer:payload});
  await page.getByRole('button',{name:'校验并预览备份'}).click();await expect(page.getByRole('region',{name:'备份恢复预览'})).toBeVisible();
  await expect.poll(()=>identity).not.toBe('');const state={id:identity,kind:'restore',state:'running',stage:'committing',done:0,total:0,cancellable:false,error:'',result:null};
  await page.route(`**/api/data-jobs/${identity}/restore`,route=>{committing=true;return route.fulfill({status:202,json:state});});
  await page.route(`**/api/data-jobs/${identity}`,route=>committing?route.fulfill({json:state}):route.continue());
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'恢复所选备份'}).click();
  await expect(page.getByText('提交恢复（不能取消）',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'取消数据任务'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'关闭设置'})).toBeDisabled();await expect(page.getByRole('tab',{name:'媒体目录'})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(()=>{
    const tasks:any=[];window.dispatchEvent(new CustomEvent('avhub-before-quit',{detail:tasks}));return tasks.criticalDataCommit;
  })).toBe(true);
  // Only the UI commit response is simulated; the real backup is never installed.
});

test('hidden controls stop progress DOM mutations but keyboard seeks and reveal use current time',async({page,request})=>{
  await page.goto('/?video=1');await page.getByRole('button',{name:'从头开始',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.paused&&v.currentTime>0)).toBe(true);
  await page.locator('.player-top').hover();await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
  await page.locator('.seek-control').evaluate(element=>{
    (window as any).__progressChanges=0;new MutationObserver(records=>{(window as any).__progressChanges+=records.length;}).observe(element,{attributes:true,attributeFilter:['style']});
  });
  await page.waitForTimeout(1600);expect(await page.evaluate(()=>(window as any).__progressChanges)).toBe(0);
  const before=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime);await page.keyboard.press('ArrowRight');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(before+4.5);
  await expect(page.locator('.video-wrap')).toHaveClass(/controls-hidden/);
  const stage=await page.locator('.video-wrap').boundingBox();await page.mouse.move(stage!.x+stage!.width/2,stage!.y+stage!.height-20);const now=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime);
  const shown=Number(await page.getByRole('slider',{name:'视频完整进度'}).inputValue());expect(Math.abs(shown-now)).toBeLessThan(1);
  await expect.poll(async()=>(await(await request.get('/api/thumbnails')).json()).yielding).toBe(true);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());await expect.poll(async()=>(await(await request.get('/api/thumbnails')).json()).yielding).toBe(false);
  expect((await(await request.get('/api/thumbnails')).json()).paused).toBe(false);
});

test('native backup download verifies its prefix and refuses an HTML fallback',async({page})=>{
  await page.route('**/api/data-jobs/*/download',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html>stale service</html>'}));
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置'}).click();await page.getByRole('tab',{name:'数据管理'}).click();
  await page.getByRole('button',{name:'保存媒体库备份'}).click();await expect(page.getByRole('alert')).toContainText('本地服务与网页版本不匹配');
});

test('an expired ready preview can be discarded and another backup selected',async({page,request})=>{
  const payload=await(await request.get('/api/backup')).body();let identity='';
  page.on('response',async response=>{if(response.url().endsWith('/api/data-jobs/inspect'))identity=(await response.json()).id;});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置'}).click();await page.getByRole('tab',{name:'数据管理'}).click();
  await page.getByLabel('选择备份文件').setInputFiles({name:'library.db',mimeType:'application/octet-stream',buffer:payload});
  await page.getByRole('button',{name:'校验并预览备份'}).click();await expect(page.getByRole('region',{name:'备份恢复预览'})).toBeVisible();
  await expect.poll(()=>identity).not.toBe('');
  await page.route(`**/api/data-jobs/${identity}/cancel`,route=>route.fulfill({status:404,json:{detail:'数据任务已过期，请重新开始'}}));
  await page.getByRole('button',{name:'放弃恢复预览'}).click();await expect(page.getByRole('region',{name:'备份恢复预览'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'校验并预览备份'})).toBeEnabled();await expect(page.getByRole('region',{name:'媒体库备份'}).getByRole('alert')).toHaveCount(0);
});

for(const failure of ['rejected','preferences','uncertain'] as const){
  test(`restore ${failure} reconciles commit protection without replaying the write`,async({page,request})=>{
    const payload=await(await request.get('/api/backup')).body();let identity='',submits=0,unavailable=failure==='uncertain';
    page.on('response',async response=>{if(response.url().endsWith('/api/data-jobs/inspect'))identity=(await response.json()).id;});
    await page.goto('/');await page.getByRole('button',{name:'媒体库设置'}).click();await page.getByRole('tab',{name:'数据管理'}).click();
    await page.getByLabel('选择备份文件').setInputFiles({name:'library.db',mimeType:'application/octet-stream',buffer:payload});
    await page.getByRole('button',{name:'校验并预览备份'}).click();await expect(page.getByRole('region',{name:'备份恢复预览'})).toBeVisible();
    await expect.poll(()=>identity).not.toBe('');
    await page.route(`**/api/data-jobs/${identity}/restore`,route=>{submits++;return failure==='uncertain'?route.abort():route.fulfill({status:409,json:{detail:'扫描仍在运行，请稍后重试'}});});
    if(failure==='preferences'){
      await page.route('**/api/preferences',route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{detail:'设置保存失败'}}):route.continue());
      await page.getByRole('tab',{name:'媒体目录'}).click();await page.getByRole('checkbox',{name:'封面悬停预览'}).check();await page.getByRole('tab',{name:'数据管理'}).click();
    }
    if(failure==='uncertain')await page.route(`**/api/data-jobs/${identity}`,route=>unavailable?route.abort():route.continue());
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'恢复所选备份'}).click();
    if(failure==='uncertain'){
      await expect(page.getByRole('button',{name:'重新检查恢复状态'})).toBeVisible();await expect(page.getByRole('button',{name:'关闭设置'})).toBeDisabled();
      unavailable=false;await page.getByRole('button',{name:'重新检查恢复状态'}).click();
    }else await expect(page.getByRole('region',{name:'媒体库备份'}).getByRole('alert').filter({hasText:failure==='preferences'?'设置尚未保存':'扫描仍在运行'})).toBeVisible();
    await expect(page.getByRole('region',{name:'备份恢复预览'})).toBeVisible();await expect(page.getByRole('button',{name:'关闭设置'})).toBeEnabled();
    expect(await page.evaluate(()=>{const tasks:any=[];window.dispatchEvent(new CustomEvent('avhub-before-quit',{detail:tasks}));return tasks.criticalDataCommit===true;})).toBe(false);
    expect(submits).toBe(failure==='preferences'?0:1);
  });
}
