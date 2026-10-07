import { test,expect,type Page,type Locator } from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function token(page:Page,name:string) {
  return page.evaluate(name=>{
    const probe=document.createElement('span');probe.style.color=`var(${name})`;document.body.append(probe);
    const value=getComputedStyle(probe).color;probe.remove();return value;
  },name);
}
async function fits(element:Locator) {await expect.poll(()=>element.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();}
async function shot(page:Page,name:string) {await page.screenshot({path:`build/ui-refinement/${name}.png`,fullPage:await page.getByRole('dialog').count()===0});}
async function hoverToken(page:Page,element:Locator,name='--ui-hover') {
  await element.hover();await expect(element).toHaveCSS('background-color',await token(page,name));
}
function contrast(a:string,b:string) {
  const lum=(value:string)=>{
    const rgb=value.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{if(!value.startsWith('color(srgb'))v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}

for(const theme of ['dark','light']) {
  test(`${theme}: library hover, search, filters, folders, bulk editor and task dialog use shared states`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    await request.post('/test/folder-fixture');await page.goto('/');
    await expect(page.locator('.card')).toHaveCount(48);
    await page.getByRole('button',{name:'搜索视频',exact:true}).click();
    const search=page.getByRole('textbox',{name:'搜索视频',exact:true});
    await expect(search).toHaveCSS('border-top-width','0px');
    await expect(search).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await expect(page.locator('.header-search .search')).toHaveCSS('border-top-color',await token(page,'--ui-accent'));
    await search.fill('视频');await hoverToken(page,page.getByRole('button',{name:'清空搜索',exact:true}));
    await page.getByRole('button',{name:'清空搜索',exact:true}).click();
    await page.getByRole('button',{name:'收起搜索',exact:true}).click();
    const filter=page.getByRole('button',{name:'更多筛选',exact:true});await hoverToken(page,filter);await filter.click();
    await expect(page.locator('.advanced-filters')).toHaveCSS('background-color',await token(page,'--ui-surface'));
    await page.route('**/api/roots/50/folders?**',route=>route.fulfill({status:503,json:{detail:'测试：目录暂时不可访问'}}));
    await page.getByRole('combobox',{name:'按目录筛选'}).selectOption('50');
    await page.getByRole('button',{name:'浏览子目录',exact:true}).click();
    await expect(page.locator('.folder-error').getByRole('alert')).toHaveCSS('color',await token(page,'--ui-danger'));
    await page.unroute('**/api/roots/50/folders?**');
    await page.getByRole('button',{name:'重试目录加载',exact:true}).click();
    await hoverToken(page,page.getByRole('button',{name:'打开子目录 Drama',exact:true}));
    await shot(page,`${theme}-library-folders`);
    await page.getByRole('combobox',{name:'按目录筛选'}).selectOption('');
    const bulk=page.getByRole('button',{name:'批量整理',exact:true});await bulk.click();
    await expect(bulk).toHaveCSS('background-color',await token(page,'--ui-accent-soft'));
    await page.getByRole('button',{name:'选中本页',exact:true}).click();await page.getByRole('button',{name:'编辑所选',exact:true}).click();
    await expect(page.getByRole('dialog').locator('.dialog-title>.ui-icon')).toHaveCount(1);await fits(page.getByRole('dialog'));
    await shot(page,`${theme}-bulk-editor`);await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'封面任务',exact:true}).click();
    await expect(page.locator('.thumbnail-task-summary>span').first()).toHaveCSS('background-color',await token(page,'--ui-field'));
    await fits(page.getByRole('dialog'));await shot(page,`${theme}-thumbnail-tasks`);
  });

  test(`${theme}: all settings tabs and errors retain coherent surfaces and contrast`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
    for(const name of ['媒体目录','播放偏好','数据管理','运行诊断']) {
      const tab=page.getByRole('tab',{name,exact:true});await tab.click();
      await expect(tab).toHaveCSS('background-color',await token(page,'--ui-surface'));
      await expect(tab).toHaveCSS('color',await token(page,'--ui-accent'));
      if(name==='数据管理')await expect(page.locator('.storage-sizes>div')).toHaveCount(8);
      if(name==='运行诊断') {
        await page.locator('.runtime-diagnostics summary').click();
        await expect(page.locator('.diagnostic-fields')).toBeVisible();
        await expect(page.locator('.diagnostic-fields')).toHaveCSS('background-color',await token(page,'--ui-field'));
      }
      await fits(page.getByRole('dialog'));await shot(page,`${theme}-settings-${name}`);
    }
    await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
    await page.route('**/api/screenshots/settings',async route=>{
      if(route.request().method()==='PUT')await route.fulfill({status:400,json:{detail:'测试：保存目录不可访问'}});
      else await route.continue();
    });
    await page.getByRole('textbox',{name:'默认保存目录',exact:true}).fill('invalid-test-directory');
    await page.getByRole('button',{name:'保存截图设置',exact:true}).click();
    const error=page.getByRole('alert');await expect(error).toContainText('保存目录不可访问');
    await expect(error).toHaveCSS('color',await token(page,'--ui-danger'));
    expect(contrast(await token(page,'--ui-muted'),await token(page,'--ui-surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(await token(page,'--ui-danger'),await token(page,'--ui-surface'))).toBeGreaterThanOrEqual(4.5);
    await shot(page,`${theme}-settings-error`);
  });

  test(`${theme}: playlist rows, danger hover and rename fields follow the palette`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    const list=await(await request.post('/api/playlists',{data:{name:'精选片单 · 周末影院'}})).json();
    for(const id of [1,2,3])await request.post(`/api/playlists/${list.id}/items/${id}`);
    await page.goto('/');await page.getByRole('button',{name:'播放列表',exact:true}).click();
    await expect(page.locator('.playlist-item-title')).toHaveCount(3);
    await hoverToken(page,page.locator('.playlist-item-play').nth(1));
    await hoverToken(page,page.getByRole('button',{name:'从播放列表移除 视频 002',exact:true}),'--ui-danger-soft');
    await expect(page.getByRole('button',{name:'从播放列表移除 视频 002',exact:true})).toHaveCSS('color',await token(page,'--ui-danger'));
    await page.getByRole('button',{name:'重命名列表',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'重命名播放列表',exact:true})).toHaveCSS('background-color',await token(page,'--ui-field'));
    await fits(page.getByRole('dialog'));await shot(page,`${theme}-playlist-rename`);
  });

  test(`${theme}: player information is themed while video pixels and overlay contrast stay unchanged`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    await page.goto('/?video=2');
    const start=page.getByRole('button',{name:'从头开始',exact:true}),fullscreen=page.getByRole('button',{name:'全屏',exact:true});
    await expect.poll(async()=>await start.isVisible()||await fullscreen.isEnabled()).toBeTruthy();
    if(await start.isVisible())await start.click();
    const video=page.locator('video');await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBeTruthy();
    await video.evaluate((v:HTMLVideoElement)=>{v.pause();v.dataset.polishIdentity='same-decoder';});
    const source=await video.evaluate((v:HTMLVideoElement)=>v.currentSrc);
    const info=page.locator('.player-info');await info.locator('.shortcut-help summary').click();
    await info.locator('.playback-diagnostics summary').click();await info.locator('.media-editor summary').click();
    await expect(info.locator('.shortcut-help')).toHaveCSS('background-color',await token(page,'--ui-field'));
    await expect(page.getByLabel('当前字幕延迟')).toHaveCSS('color',await token(page,'--ui-text'));
    const cover=page.getByRole('button',{name:'选择本地封面',exact:true});
    await expect(cover).toHaveCSS('background-color',await token(page,'--ui-surface'));
    await hoverToken(page,cover);await fits(info);
    await shot(page,`${theme}-player-information`);
    await page.getByRole('textbox',{name:'显示标题',exact:true}).fill('');
    await page.getByRole('button',{name:'保存信息',exact:true}).click();
    const error=info.getByRole('alert');await expect(error).toHaveText('标题不能为空');
    await expect(error).toHaveCSS('color',await token(page,'--ui-danger'));
    await page.getByRole('textbox',{name:'显示标题',exact:true}).fill('视频 002');
    await page.getByRole('button',{name:'保存信息',exact:true}).click();
    await expect(info.locator('.editor-message')).toHaveText('媒体信息已保存');
    await expect(info.locator('.editor-message')).toHaveCSS('color',await token(page,'--ui-success'));
    await expect(info.locator('.playback-diagnostics dt').first()).toHaveCSS('color',await token(page,'--ui-muted'));
    await page.getByRole('button',{name:theme==='dark'?'切换至浅色模式':'切换至深色模式',exact:true}).click();
    await expect(video).toHaveAttribute('data-polish-identity','same-decoder');
    expect(await video.evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(source);
    await expect(video).toHaveCSS('filter','none');await expect(video).toHaveCSS('opacity','1');
    await page.keyboard.press('w');await page.mouse.move(700,800);
    await page.getByRole('button',{name:'字幕',exact:true}).click();
    await expect(page.getByRole('region',{name:'字幕设置弹层'})).toHaveCSS('background-color','rgb(18, 25, 35)');
    await expect(page.getByLabel('当前字幕延迟')).toHaveCSS('color','rgb(232, 237, 245)');
    await page.route('**/api/subtitles/convert-ass',route=>route.fulfill({status:400,json:{detail:'测试字幕转换失败'}}));
    await page.getByLabel('加载外挂字幕').setInputFiles({name:'invalid.ass',mimeType:'text/plain',buffer:Buffer.from('[Script Info]\nTitle: Test\n')});
    const overlayError=page.getByRole('region',{name:'字幕设置弹层'}).getByRole('alert');
    await expect(overlayError).toContainText('测试字幕转换失败');
    await expect(overlayError).toHaveCSS('color','rgb(244, 154, 154)');
    const colors=await overlayError.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
    expect(contrast(colors.color,colors.background)).toBeGreaterThanOrEqual(4.5);
    await overlayError.scrollIntoViewIfNeeded();
    await shot(page,`${theme}-video-overlay`);
  });

  test(`${theme}: grouped series and list rows retain the common surface and hover style`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    await request.post('/test/series-fixture');await page.goto('/?view=series&grouped=true');
    await expect(page.locator('.series-groups .card')).toHaveCount(48);
    await shot(page,`${theme}-series-groups`);
    await page.locator('.series-group-cover').first().click();
    const episode=page.locator('.series-episode:not(:disabled)').first();
    // The clicked cover's coordinates can coincide with the first episode.
    // Leave it before measuring idle style, then explicitly test its hover.
    await page.mouse.move(20,800);
    await expect(episode).toHaveCSS('background-color',await token(page,'--ui-surface'));
    await hoverToken(page,episode,'--ui-field');await fits(page.locator('html'));
    await shot(page,`${theme}-series-episodes`);
    await page.getByRole('button',{name:'全部视频',exact:true}).click();
    await page.getByRole('button',{name:'列表',exact:true}).click();
    const row=page.locator('.media-list .card').first();
    await row.hover();await expect(row).toHaveCSS('background-color',await token(page,'--ui-field'));
    await expect(row).toHaveCSS('border-radius','14px');await fits(page.locator('html'));
    await shot(page,`${theme}-list-rows`);
  });
}

for(const width of [320,390,760])test(`light mode controls and every settings tab fit ${width}px`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme:'light',coverSize:'standard'}}}});
  await page.setViewportSize({width,height:844});await page.goto('/');
  await fits(page.locator('html'));await shot(page,`light-library-${width}`);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  for(const name of ['媒体目录','播放偏好','数据管理','运行诊断']) {
    await page.getByRole('tab',{name,exact:true}).click();
    if(name==='数据管理')await expect(page.locator('.storage-sizes>div')).toHaveCount(8);
    await fits(page.getByRole('dialog'));await shot(page,`light-settings-${name}-${width}`);
  }
});
