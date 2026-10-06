import { test,expect } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

test('metadata completes while covers run; directory controls unlock and tasks pause independently',async({page,request})=>{
  const {path}=await(await request.get('/test/scan-source')).json();
  const root=await(await request.post('/api/roots',{data:{path}})).json();
  await request.post('/test/thumbnail-delay?seconds=15');
  await request.post(`/api/scan?root_id=${root.id}`);
  await expect.poll(async()=>(await(await request.get('/api/scan')).json()).state).toBe('completed');
  await expect.poll(async()=>(await(await request.get('/api/thumbnails')).json()).pending).toBe(1);
  await page.goto('/');
  const icon=page.getByRole('button',{name:'封面任务',exact:true});
  await expect(icon).toBeVisible();expect((await icon.boundingBox())!.width).toBeLessThanOrEqual(44);
  await icon.click();
  const tasks=page.getByRole('dialog',{name:'后台封面任务'});
  await tasks.getByRole('button',{name:'暂停封面任务',exact:true}).click();
  await expect(tasks.getByRole('button',{name:'恢复封面任务',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭封面任务',exact:true}).click();
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await expect(page.getByRole('button',{name:'浏览本地文件夹',exact:true})).toBeEnabled();
  await expect(page.locator('.root-list>div').filter({hasText:path}).getByRole('button',{name:'移除',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.reload();await icon.click();
  await expect(tasks.getByRole('button',{name:'恢复封面任务',exact:true})).toBeVisible();
  expect((await(await request.get('/api/thumbnails')).json()).pending).toBe(1);
  await page.screenshot({path:'test-results/thumbnail-tasks-desktop.png'});
});

test('timestamp cover regeneration keeps playback and unsaved metadata draft',async({page,request})=>{
  await request.post('/test/thumbnail-task-fixture');
  await request.post('/api/thumbnails/pause');
  await page.goto('/?video=1');await expect(page.locator('video')).toBeVisible();
  await page.getByRole('button',{name:'从头开始',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate((video:HTMLVideoElement)=>!video.paused&&video.currentTime>0)).toBe(true);
  await page.getByText('编辑媒体信息',{exact:true}).click();
  const title=page.getByRole('textbox',{name:'显示标题',exact:true});await title.fill('截图期间保留的草稿');
  await page.getByRole('spinbutton',{name:'封面截图时间',exact:true}).fill('10');
  await page.getByRole('button',{name:'重新生成截图',exact:true}).click();
  await expect(page.getByText('已排队生成，暂停的任务可在顶栏“封面任务”中恢复。',{exact:true})).toBeVisible();
  const queued=await(await request.get('/api/media/1/thumbnail')).json();expect(queued.frame_time).toBe(10);
  await request.post('/api/thumbnails/resume');
  await expect.poll(async()=>(await(await request.get('/api/thumbnails')).json()).yielding).toBe(true);
  // Covers intentionally yield to active playback; a pause resumes decoding
  // without discarding the metadata draft or changing the manual pause flag.
  await page.locator('video').evaluate((video:HTMLVideoElement)=>video.pause());
  await expect.poll(async()=>(await(await request.get('/api/media/1/thumbnail')).json()).state).toBe('idle');
  await expect(page.locator('.cover-editor-preview img')).toBeVisible();
  await expect(title).toHaveValue('截图期间保留的草稿');
  expect((await(await request.get('/api/media/1')).json()).title).toBe('视频 001');
  await expect(page.locator('video')).toBeVisible();
});

test('thumbnail failure details do not mark video unplayable and dialog fits mobile',async({page,request})=>{
  await request.post('/test/thumbnail-task-fixture');await request.post('/api/thumbnails/pause');
  await page.route('**/api/thumbnails',route=>route.fulfill({json:{pending:0,failed:1,blocked:0,paused:true,current:null,published:0,error:''}}));
  await page.route('**/api/thumbnails/failed?*',route=>route.fulfill({json:{items:[{media_id:1,title:'截图待检查',last_error:'解码器测试错误',frame_time:60}],total:1,page:1,pages:1}}));
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'封面任务',exact:true}).click();
  const tasks=page.getByRole('dialog',{name:'后台封面任务'});
  await tasks.getByText('查看截图失败原因',{exact:true}).click();
  await expect(tasks.getByText('解码器测试错误',{exact:true})).toBeVisible();
  await expect(tasks.getByText(/截图失败不代表视频无法播放/)).toBeVisible();
  const bounds=(await tasks.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  await tasks.getByRole('button',{name:'重试此封面',exact:true}).click();
  await expect.poll(async()=>(await(await request.get('/api/media/1/thumbnail')).json()).state).toBe('pending');
  await page.screenshot({path:'test-results/thumbnail-tasks-mobile.png'});
});
