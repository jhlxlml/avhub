import { test, expect } from '@playwright/test';

test.beforeEach(async ({request})=>{await request.post('/test/reset');});
const ass=`[Script Info]
ScriptType: v4.00+
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:02.00,0:00:04.50,Default,,0,0,0,,中文 ASS\\N第二行
`;

test('ASS and SSA uploads convert real text, retain delay controls and reject malformed data',async({page,request})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'播放 视频 001',exact:true}).click();
  await page.getByRole('button',{name:'从头开始',exact:true}).click();
  const upload=page.getByLabel('加载外挂字幕');
  const cues=()=>page.locator('track').evaluate(t=>Array.from(t.track.cues||[]).map(c=>({start:c.startTime,text:c.text})));
  await upload.setInputFiles({name:'中文.ass',mimeType:'text/plain',buffer:Buffer.from(ass)});
  await expect(page.locator('track')).toHaveCount(1);
  await expect.poll(cues).toEqual([{start:2,text:'中文 ASS\n第二行'}]);
  await expect(page.getByText(/高级定位|高级样式/)).toBeVisible();
  await page.getByRole('button',{name:'字幕延迟增加 0.1 秒'}).click();
  await expect.poll(cues).toEqual([{start:2.1,text:'中文 ASS\n第二行'}]);
  await page.getByRole('combobox',{name:'字幕轨道'}).selectOption('');
  await expect(page.locator('track')).toHaveCount(0);
  await upload.setInputFiles({name:'utf16.ssa',mimeType:'text/plain',buffer:Buffer.from('\uFEFF'+ass,'utf16le')});
  await expect(page.locator('track')).toHaveCount(1);
  await expect.poll(cues).toEqual([{start:2,text:'中文 ASS\n第二行'}]);
  await upload.setInputFiles({name:'invalid.ass',mimeType:'text/plain',buffer:Buffer.from('not a subtitle')});
  await expect(page.getByText(/没有有效对白|无法转换/)).toBeVisible();
  expect((await(await request.get('/test/sessions')).json()).count).toBe(0);
});

test('actual PQ 10-bit compatibility playback reports SDR policy and renders video',async({page,request})=>{
  await request.post('/test/hdr-fixture');
  await page.route('**/api/media/6/playback',async route=>{
    const data=route.request().postDataJSON();
    await route.continue({postData:JSON.stringify({...data,force_transcode:true,prefer_original:false,allow_video_transcode:true,allow_audio_transcode:true})});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'播放 视频 006',exact:true}).click();
  await page.locator('.playback-diagnostics summary').click();
  await expect(page.getByLabel('播放色彩策略')).toHaveText('PQ HDR → SDR · BT.709 · 8-bit');
  await expect(page.getByLabel('源视频色彩')).toContainText('10-bit');
  await expect(page.getByLabel('源视频色彩')).toContainText('PQ');
  await expect(page.getByLabel('实际解码分辨率')).toHaveText('160×90');
  await expect(page.locator('.color-warning')).toContainText('不是原画');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0);
});

test('disabling subtitles cancels a late ASS conversion without restoring it',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  let started!:()=>void;
  const arrived=new Promise<void>(resolve=>started=resolve);
  await page.route('**/api/subtitles/convert-ass',async route=>{started();await gate;await route.fulfill({contentType:'text/vtt',body:'WEBVTT\n\n00:02.000 --> 00:04.000\nlate'}).catch(()=>{});});
  await page.goto('/');
  await page.getByRole('button',{name:'播放 视频 001',exact:true}).click();
  const select=page.getByRole('combobox',{name:'字幕轨道'});
  await expect(select).toHaveValue('');
  await page.getByLabel('加载外挂字幕').setInputFiles({name:'late.ass',mimeType:'text/plain',buffer:Buffer.from(ass)});
  await arrived;
  await page.getByRole('button',{name:'取消字幕加载'}).click(); release();
  await expect(page.locator('track')).toHaveCount(0);
  await page.waitForTimeout(200);
  await expect(select).toHaveValue('');
  await expect(page.locator('track')).toHaveCount(0);
});

test('ten thousand playlist entries use bounded server pages in manager and player',async({page,request})=>{
  await request.post('/test/large-playlist');
  const urls:string[]=[];
  page.on('request',r=>{if(r.url().includes('/api/playlists/500'))urls.push(r.url());});
  await page.goto('/');
  await page.getByRole('button',{name:'播放列表',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'播放列表',exact:true});
  await expect(dialog.locator('ol>li')).toHaveCount(40);
  await expect(dialog.getByText('1 / 250 页 · 10000 个')).toBeVisible();
  await dialog.getByRole('button',{name:'下一页播放列表视频'}).click();
  await expect(dialog.getByText('2 / 250 页 · 10000 个')).toBeVisible();
  await dialog.getByRole('button',{name:'上移 大片单 00039'}).click();
  await expect(dialog.getByRole('button',{name:'播放 大片单 00039',exact:true})).toHaveCount(0);
  await dialog.getByRole('searchbox',{name:'搜索播放列表视频'}).fill('09998');
  await expect(dialog.locator('ol>li')).toHaveCount(1);
  await expect(dialog.getByRole('button',{name:'播放 大片单 09998',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'从头播放',exact:true}).click();
  await page.getByRole('button',{name:'从头开始',exact:true}).click();
  await page.getByRole('button',{name:'展开待播队列'}).click();
  await expect(page.locator('.playback-queue ol>li')).toHaveCount(40);
  await page.getByRole('searchbox',{name:'搜索待播队列'}).fill('09998');
  await expect(page.locator('.playback-queue ol>li')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'队列播放 大片单 09998'})).toBeVisible();
  // Queue search is outside the video; return the pointer to the player to
  // reveal its intentionally auto-hidden controls before clicking Next.
  await page.locator('.video-wrap').hover();
  await page.getByRole('button',{name:'播放下一条'}).click();
  await expect(page.getByRole('heading',{name:'视频 002',exact:true})).toBeVisible();
  expect(urls.filter(url=>/\/500\?/.test(url)).every(url=>url.includes('page_size=40'))).toBeTruthy();
  expect(urls.some(url=>url.includes('/items/')&&url.includes('/move'))).toBeTruthy();
});

test('hover previews are opt-in, delayed, one at a time and never create playback jobs',async({page,request})=>{
  let playbackCalls=0;
  page.on('request',r=>{if(r.url().includes('/playback'))playbackCalls++;});
  await page.goto('/');
  const first=page.locator('.cover').first();
  await first.hover(); await page.waitForTimeout(750);
  await expect(page.locator('.hover-preview')).toHaveCount(0);
  await page.getByRole('button',{name:'媒体库设置'}).click();
  await page.getByRole('tab',{name:'媒体目录',exact:true}).click();
  await page.getByRole('checkbox',{name:'封面悬停预览'}).check();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.getByRole('button',{name:'全部视频',exact:true}).hover();
  await first.hover(); await page.waitForTimeout(100);
  await expect(page.locator('.hover-preview')).toHaveCount(0);
  await expect(page.locator('.hover-preview.visible')).toHaveCount(1);
  expect(await page.locator('.hover-preview').evaluate((v:HTMLVideoElement)=>v.muted)).toBeTruthy();
  await page.evaluate(()=>{(window as any).__preview=document.querySelector('.hover-preview');});
  await page.locator('.cover').nth(1).hover();
  await expect.poll(()=>page.evaluate(()=>{const v=(window as any).__preview;return v.paused&&!v.getAttribute('src');})).toBeTruthy();
  await expect(page.locator('.hover-preview')).toHaveCount(1);
  await page.getByRole('button',{name:'全部视频',exact:true}).hover();
  await expect(page.locator('.hover-preview')).toHaveCount(0);
  expect(playbackCalls).toBe(0);
  expect((await(await request.get('/test/sessions')).json()).count).toBe(0);
  await page.reload();
  expect(await page.evaluate(()=>localStorage.getItem('avhub.hoverPreview'))).toBe('true');
});

for(const theme of ['dark','light'])for(const layout of ['grid','list'])
test(`hover preview stays unobstructed in ${theme} ${layout} and remains clickable`,async({page,request})=>{
  await request.post('/test/thumbnail-fixture');
  await request.patch('/api/preferences',{data:{values:{hoverPreview:true,appearance:{theme,coverSize:'standard'}}}});
  await page.goto(`/?layout=${layout}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  const card=page.locator('.card').first();
  const cover=card.locator('.cover');
  await expect(card.locator('.thumbnail-ready')).toBeVisible();
  await cover.hover();
  const preview=cover.locator('.hover-preview.visible');
  await expect(preview).toBeVisible();
  await expect(cover.locator('.play')).toHaveCount(0);
  for(const element of [preview,card.locator('.open-video'),cover]){
    await expect(element).toHaveCSS('opacity','1');
    await expect(element).toHaveCSS('filter','none');
  }
  await expect(card.getByRole('button',{name:'取消收藏 视频 001',exact:true})).toBeVisible();
  await expect(cover.locator('.duration')).toBeVisible();
  await expect(cover.locator('.progress')).toBeVisible();
  await cover.screenshot({path:`test-results/hover-preview-${theme}-${layout}.png`});
  await card.getByRole('button',{name:'播放 视频 001',exact:true}).click();
  await expect(page.locator('.player-shell')).toBeVisible();
  await expect(page.getByRole('heading',{name:'视频 001',exact:true})).toBeVisible();
});
