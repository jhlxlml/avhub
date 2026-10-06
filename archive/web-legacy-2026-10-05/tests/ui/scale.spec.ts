import {test,expect} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

test('batch selection spans pages, changes only selected IDs, survives reload and resets on filter',async({page,request})=>{
  await page.goto('/?sort=name');
  await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'批量整理',exact:true}).click();
  await page.getByRole('checkbox',{name:'选择 视频 001',exact:true}).check();
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'选择 视频 049',exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'选择 视频 049',exact:true}).check();
  await expect(page.getByText('已选 2 / 500 · 支持跨页选择',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'编辑所选',exact:true}).click();
  await page.screenshot({path:'test-results/scale-batch.png'});
  await page.getByRole('combobox',{name:'批量收藏',exact:true}).selectOption('yes');
  await page.getByRole('combobox',{name:'批量观看状态',exact:true}).selectOption('yes');
  await page.getByRole('textbox',{name:'批量添加标签',exact:true}).fill('跨页整理, 中文');
  await page.getByRole('button',{name:'应用到 2 个视频',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for(const id of [1,49]) {const m=await(await request.get(`/api/media/${id}`)).json();expect(m.tags).toEqual(['跨页整理','中文']);expect(m.manual_watched).toBe(1);}
  expect((await(await request.get('/api/media/48')).json()).tags).toEqual([]);
  await page.reload();await page.getByRole('button',{name:'收藏',exact:true}).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('batch error stays actionable, retains selection and does not pretend success',async({page})=>{
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'批量整理',exact:true}).click();
  await page.getByRole('button',{name:'选中本页',exact:true}).click();
  await page.getByRole('button',{name:'编辑所选',exact:true}).click();
  await page.getByRole('button',{name:'应用到 48 个视频',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请至少选择一项修改');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByText('已选 48 / 500 · 支持跨页选择',{exact:true})).toBeVisible();
});

test('1000 episodes aggregate into bounded groups and special seasons; renamed group persists',async({page,request})=>{
  await request.post('/test/series-fixture');await page.goto('/?view=series');
  await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'按剧集归类',exact:true}).click();
  await expect(page.locator('.series-groups .card')).toHaveCount(48);
  await page.screenshot({path:'test-results/scale-series.png'});
  await page.getByRole('button',{name:'搜索视频',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索视频',exact:true}).fill('测试剧集');
  await expect(page.locator('.series-groups .card')).toHaveCount(1);
  await page.getByRole('button',{name:'打开剧集 测试剧集',exact:true}).click();
  await expect(page.locator('.series-episode')).toHaveCount(48);
  await page.getByRole('combobox',{name:'选择季',exact:true}).selectOption('0');
  await expect(page.getByRole('button',{name:'离线 测试剧集',exact:true})).toBeDisabled();
  await page.screenshot({path:'test-results/scale-seasons.png'});
  await page.reload();await expect(page.getByRole('combobox',{name:'选择季',exact:true})).toHaveValue('0');
  await page.getByRole('button',{name:'修改剧名',exact:true}).click();
  await page.getByRole('textbox',{name:'分组剧名',exact:true}).fill('改名后的剧集');
  await page.getByRole('button',{name:'保存剧名',exact:true}).click();
  await expect(page.getByRole('heading',{name:'改名后的剧集',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'播放 测试剧集',exact:true}).first().click();
  await expect(page.locator('video')).toBeVisible();
  await page.getByText('编辑媒体信息',{exact:true}).click();
  await expect(page.getByRole('textbox',{name:'剧名',exact:true})).toHaveValue('改名后的剧集');
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await expect(page.getByRole('heading',{name:'改名后的剧集',exact:true})).toBeVisible();
});

test('offline custom cover uploads, resets and preserves an unsaved metadata draft',async({page,request})=>{
  await request.post('/test/thumbnail-fixture');
  const image=await(await request.get('/thumbs/1')).body();
  await page.goto('/?video=1');await expect(page.locator('video')).toBeVisible();
  await page.getByText('编辑媒体信息',{exact:true}).click();
  await page.getByRole('textbox',{name:'显示标题',exact:true}).fill('封面上传期间的草稿');
  await page.getByLabel('导入封面图片',{exact:true}).setInputFiles({name:'本地图片.jpg',mimeType:'image/jpeg',buffer:image});
  await expect(page.getByRole('button',{name:'恢复视频截图',exact:true})).toBeVisible();
  await page.locator('.media-editor').screenshot({path:'test-results/scale-cover.png'});
  await expect(page.getByRole('textbox',{name:'显示标题',exact:true})).toHaveValue('封面上传期间的草稿');
  expect((await(await request.get('/api/media/1')).json()).title).toBe('视频 001');
  expect((await request.get('/thumbs/1')).headers()['content-type']).toContain('image/jpeg');
  await page.getByRole('button',{name:'恢复视频截图',exact:true}).click();
  await expect(page.getByRole('button',{name:'恢复视频截图',exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'显示标题',exact:true})).toHaveValue('封面上传期间的草稿');
});

test('new library dialog remains inside narrow viewport and shares icon language',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(48);
  await page.getByRole('button',{name:'批量整理',exact:true}).click();
  await page.getByRole('button',{name:'选中本页',exact:true}).click();
  await page.getByRole('button',{name:'编辑所选',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await page.screenshot({path:'test-results/scale-batch-mobile.png'});
  const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});
