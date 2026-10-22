import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
mkdirSync(path.join(root,'build'),{recursive:true});const folder=mkdtempSync(path.join(root,'build','electron-library-refinement-'));
const media=path.join(folder,'media');mkdirSync(media);
const source=path.join(media,'Refinement 01.mp4');
const encoded=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=12','-t','24','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',source],{windowsHide:true,timeout:30000});assert.equal(encoded.status,0,encoded.stderr?.toString());
const sources=[source];for(let index=2;index<=6;index++){const destination=path.join(media,`Refinement 0${index}.mp4`);copyFileSync(source,destination);sources.push(destination);}
const fingerprint=()=>sources.map(filename=>({hash:createHash('sha256').update(readFileSync(filename)).digest('hex'),mtime:statSync(filename).mtimeMs}));const originals=fingerprint();
let desktop;const errors=[];let playbackRequests=0;
try{
  desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:path.join(folder,'profile'),AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/playback'))playbackRequests++;});
  await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();await desktop.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setContentSize(1440,900);window.showInactive();});
  const origin=new URL(page.url()).origin;
  const shot=async name=>{await page.waitForTimeout(200);await page.screenshot({path:path.join(folder,name+'.png'),animations:'disabled'});};
  const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
  const registered=await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=> (await api('/api/scan')).state,{timeout:30000}).toBe('completed');
  let items=(await api('/api/media?page=1&sort=name')).items;assert.equal(items.length,6);
  for(let index=0;index<items.length;index++)await api(`/api/media/${items[index].id}`,'PATCH',{title:`示例视频 ${index+1}`,kind:'movie'});
  items=(await api('/api/media?page=1&sort=name')).items;
  await page.goto(origin+`/?view=movies&root=${registered.id}&q=示例&format=mp4&watch=unwatched`);await expect(page.locator('.card')).toHaveCount(6);
  await expect(page.locator('.library-heading .library-filter-summary')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'当前筛选条件'})).toHaveCount(0);
  await page.getByRole('button',{name:/^更多筛选/}).click();
  const summary=page.getByRole('region',{name:'当前筛选条件'});await summary.getByRole('button',{name:'移除筛选：搜索：示例',exact:true}).click();
  assert.equal(new URL(page.url()).searchParams.has('q'),false);await expect(page.getByRole('button',{name:'电影',exact:true})).toHaveAttribute('aria-pressed','true');await expect(summary).toContainText('格式：MP4');
  await shot('wide-filter-summary');
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(800,620));
  await page.getByRole('combobox',{name:'按分辨率筛选',exact:true}).selectOption('SD');await expect(page.locator('.card')).toHaveCount(6);await expect(summary).toContainText('分辨率：SD');
  assert.equal(await page.locator('#app-scroll-area').evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
  await shot('compact-toolbar-dark');
  await summary.getByRole('button',{name:'清除全部筛选',exact:true}).click();await expect(summary).toHaveCount(0);await expect(page.locator('.card')).toHaveCount(6);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await expect(page.getByRole('checkbox',{name:'封面悬停预览',exact:true})).toBeVisible();await shot('directory-background-settings');
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await expect(page.getByRole('checkbox',{name:'封面悬停预览',exact:true})).not.toBeVisible();await expect(page.getByRole('checkbox',{name:'MKV 无损播放准备',exact:true})).not.toBeVisible();
  await page.getByText('高级播放设置',{exact:true}).click();await expect(page.getByRole('checkbox',{name:'MKV 无损播放准备',exact:true})).not.toBeChecked();await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.getByRole('button',{name:'封面任务',exact:true}).click();const tasks=page.getByRole('dialog',{name:'后台封面任务'});await tasks.getByRole('button',{name:'暂停封面任务',exact:true}).click();await expect(tasks).toContainText('已暂停');await tasks.getByRole('button',{name:'恢复封面任务',exact:true}).click();await page.getByRole('button',{name:'关闭封面任务',exact:true}).click();
  await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();await shot('compact-toolbar-light');
  // Controlled slow/error response in the real desktop renderer, not a browser-only test.
  let releaseListRead;const listReadGate=new Promise(resolve=>{releaseListRead=resolve;});
  const rejectListRead=async route=>{if(route.request().method()!=='GET')return route.continue();await listReadGate;await route.fulfill({status:503,json:{detail:'验收：片单读取暂时失败'}});};
  await page.route('**/api/playlists',rejectListRead);
  await page.getByRole('button',{name:'播放列表',exact:true}).click();
  const feedbackPanel=page.getByRole('dialog',{name:'播放列表',exact:true});
  await expect(feedbackPanel.getByRole('status')).toContainText('正在加载列表');
  await expect(feedbackPanel.getByText('创建或选择一个列表',{exact:true})).toHaveCount(0);
  releaseListRead();await expect(feedbackPanel.getByRole('alert')).toContainText('片单读取暂时失败');
  await expect(feedbackPanel.locator('.is-empty')).toHaveCount(0);await shot('playlist-read-error-light');
  await page.unroute('**/api/playlists',rejectListRead);
  await feedbackPanel.getByRole('button',{name:'刷新列表',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(feedbackPanel.getByRole('alert')).toHaveCount(0);await expect(feedbackPanel.getByText('创建或选择一个列表',{exact:true})).toBeVisible();
  await feedbackPanel.getByRole('button',{name:'完成',exact:true}).click();
  const titles=await page.locator('.card .video-title').allTextContents(),expected=titles.map(title=>items.find(item=>item.title===title).id);
  const list=await api('/api/playlists','POST',{name:'第二轮验收片单',media_id:expected[0]});
  await page.getByRole('button',{name:'批量整理',exact:true}).click();await page.getByRole('button',{name:'选中本页',exact:true}).click();await page.getByRole('button',{name:'所选加入播放列表',exact:true}).click();
  // Wait for the async list options and explicitly choose the intended target.
  await page.getByRole('combobox',{name:'选择播放列表',exact:true}).selectOption(String(list.id));await page.getByRole('button',{name:'添加到列表',exact:true}).click();
  await expect(page.getByText('已加入 5 个视频 · 1 个已在列表中',{exact:true})).toBeVisible();let detail=await api(`/api/playlists/${list.id}?page=1`);assert.deepEqual(detail.items.map(item=>item.id),expected);
  await page.getByRole('button',{name:'播放列表',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(6);await page.getByRole('button',{name:'多选视频',exact:true}).click();
  for(const index of [1,4])await page.getByRole('checkbox',{name:`选择片单视频 ${titles[index]}`,exact:true}).check();await page.getByRole('button',{name:'移除所选片单视频',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(4);await page.getByRole('button',{name:'撤销上次移除',exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(6);
  detail=await api(`/api/playlists/${list.id}?page=1`);assert.deepEqual(detail.items.map(item=>item.id),expected);
  assert.equal(await page.getByRole('dialog',{name:'播放列表',exact:true}).evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);await shot('playlist-bulk-undo-light');
  await page.getByRole('button',{name:`从播放列表移除 ${titles[0]}`,exact:true}).click();await expect(page.locator('.playlist-item-title')).toHaveCount(5);
  const concurrent=expected.slice(1).reverse();await api(`/api/playlists/${list.id}/items`,'PUT',{media_ids:concurrent});await page.getByRole('button',{name:'撤销上次移除',exact:true}).click();await expect(page.getByRole('alert')).toContainText('内容已变化');await page.getByRole('button',{name:'刷新列表',exact:true}).click();await expect(page.getByRole('button',{name:'撤销上次移除',exact:true})).toBeDisabled();
  detail=await api(`/api/playlists/${list.id}?page=1`);assert.deepEqual(detail.items.map(item=>item.id),concurrent);await shot('playlist-concurrent-order-protected');await page.getByRole('button',{name:'完成',exact:true}).click();
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));await page.getByRole('button',{name:'切换至深色模式',exact:true}).click();await page.getByRole('button',{name:'播放列表',exact:true}).click();await page.getByRole('button',{name:'多选视频',exact:true}).click();await page.getByRole('button',{name:'选择本页片单视频',exact:true}).click();await shot('playlist-bulk-dark');await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('button',{name:'批量整理',exact:true}).click();
  const filtersButton=page.getByRole('button',{name:/^更多筛选/});if(await filtersButton.getAttribute('aria-expanded')==='true')await filtersButton.click();
  const collapseSearch=page.getByRole('button',{name:'收起搜索',exact:true});if(await collapseSearch.count())await collapseSearch.click();
  const dismissFeedback=page.locator('.toast').getByRole('button',{name:'关闭提示',exact:true});if(await dismissFeedback.count())await dismissFeedback.click();
  await shot('library-mira-dark');
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await shot('settings-mira-dark');await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();await shot('library-mira-light');
  // Real desktop keyboard acceptance for the library's compact controls.
  const sizeTrigger=page.getByRole('button',{name:'调整封面大小',exact:true});
  await sizeTrigger.click();await expect(page.getByRole('slider',{name:'封面大小',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(sizeTrigger).toBeFocused();
  await sizeTrigger.click();for(let i=0;i<5;i++)await page.keyboard.press('Tab');
  await expect(page.getByRole('group',{name:'封面大小设置'})).toHaveCount(0);
  await page.getByRole('button',{name:'显示目录树',exact:true}).click();
  const directoryTree=page.getByRole('tree',{name:'媒体目录树'}),directoryRow=directoryTree.getByRole('treeitem').first();
  await expect(directoryTree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
  await directoryRow.focus();await page.keyboard.press('ArrowRight');await expect(directoryRow).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('ArrowLeft');await expect(directoryRow).toHaveAttribute('aria-expanded','false');
  await page.keyboard.press('Tab');assert.equal(await directoryTree.evaluate(el=>el.contains(document.activeElement)),false);
  const firstCover=page.locator('.card .cover').first();await firstCover.locator('.open-video').focus();
  await expect(firstCover.locator('.star')).toHaveCSS('opacity','1');await expect(firstCover.locator('.queue-add')).toHaveCSS('opacity','1');
  await shot('library-keyboard-navigation-light');
  await page.getByRole('button',{name:'隐藏目录树',exact:true}).click();
  // Real desktop metadata dialog: validation must focus the field, not discard it.
  await page.locator('.media-more').first().click();
  await page.getByRole('menuitem',{name:'编辑信息与封面',exact:true}).click();
  const editorDialog=page.getByRole('dialog',{name:'编辑媒体信息与封面',exact:true});
  const editorTitle=editorDialog.getByRole('textbox',{name:'显示标题',exact:true});
  const previousTitle=await editorTitle.inputValue();
  await editorTitle.fill('   ');await editorDialog.getByRole('button',{name:'保存信息',exact:true}).click();
  await expect(editorTitle).toBeFocused();await expect(editorTitle).toHaveAttribute('aria-invalid','true');
  await expect(editorDialog.getByRole('alert')).toContainText('标题不能为空');
  await shot('metadata-validation-light');
  await editorTitle.fill(previousTitle);await editorDialog.getByRole('button',{name:'完成',exact:true}).click();
  await expect(editorDialog).toHaveCount(0);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await shot('settings-mira-light');
  const rootSetting=page.locator('.directory-setting-row').first();
  for(const name of ['添加目录','浏览本地文件夹']){
    const control=page.getByRole('button',{name,exact:true});await expect(control).toHaveCSS('height','32px');await expect(control).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
  }
  await expect(rootSetting.getByRole('checkbox')).toHaveCount(0);
  await rootSetting.getByRole('button',{name:/^文件权限 /}).click();await expect(rootSetting.getByRole('checkbox')).toHaveCount(3);
  const renameGrant=rootSetting.getByRole('checkbox',{name:/^允许重命名/});await expect(renameGrant).not.toBeChecked();
  // This fixture lives inside the protected application tree; it must remain
  // read-only. Real grants are tested with owned TEMP samples in file-management.
  await expect(renameGrant).toBeDisabled();
  await shot('directory-permissions-light');
  await rootSetting.getByRole('button',{name:/^更多目录操作 /}).click();await expect(rootSetting.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');await expect(rootSetting.getByRole('menu')).toHaveCount(0);await expect(page.getByRole('dialog',{name:'媒体库设置',exact:true})).toBeVisible();
  await rootSetting.getByRole('button',{name:/^更多目录操作 /}).click();await rootSetting.getByRole('menuitem',{name:/移出媒体库/}).click();
  const removeDialog=page.getByRole('dialog',{name:'从媒体库移除目录？',exact:true});await expect(removeDialog).toContainText('原视频不会被删除');
  await removeDialog.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.directory-setting-row')).toHaveCount(1);
  const previewSwitch=page.getByRole('checkbox',{name:'封面悬停预览',exact:true});await expect(previewSwitch).toHaveCSS('width','30px');
  const previewBefore=await previewSwitch.isChecked();await previewSwitch.focus();await page.keyboard.press('Space');await expect(previewSwitch).toBeChecked({checked:!previewBefore});await expect(previewSwitch).toBeFocused();
  await page.keyboard.press('Space');await expect(previewSwitch).toBeChecked({checked:previewBefore});
  let screenshotReads=0,failScreenshotRead=true;
  const screenshotRead=async route=>{if(route.request().method()!=='GET')return route.continue();screenshotReads++;return failScreenshotRead?route.fulfill({status:503,json:{detail:'验收：截图设置首次读取失败'}}):route.continue();};
  await page.route('**/api/screenshots/settings',screenshotRead);
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  const screenshotSection=page.getByRole('region',{name:'视频截图设置',exact:true});
  await expect(screenshotSection.getByRole('alert')).toContainText('首次读取失败');failScreenshotRead=false;
  await screenshotSection.getByRole('button',{name:'重新读取截图设置',exact:true}).click();
  const screenshotDirectory=screenshotSection.getByLabel('默认保存目录',{exact:true});await expect(screenshotDirectory).toBeEnabled();
  const savedDirectory=await screenshotDirectory.inputValue();await screenshotDirectory.fill('D:\\AVHub-unsaved-test-draft');
  await page.getByRole('tab',{name:'数据管理',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await expect(screenshotDirectory).toHaveValue('D:\\AVHub-unsaved-test-draft');assert.equal(screenshotReads,2);
  await screenshotDirectory.fill(savedDirectory);await page.unroute('**/api/screenshots/settings',screenshotRead);
  const mouseSeconds=page.getByRole('spinbutton',{name:'鼠标侧键跳播时长',exact:true}),savedSeconds=await mouseSeconds.inputValue();
  await mouseSeconds.fill('0');await expect(mouseSeconds).toHaveAttribute('aria-invalid','true');await expect(mouseSeconds).toHaveAccessibleDescription(/1–120 之间/);await mouseSeconds.fill(savedSeconds);
  const autoplaySwitch=page.getByRole('checkbox',{name:'视频连播',exact:true});await expect(autoplaySwitch).toHaveCSS('width','30px');
  await expect(page.getByRole('combobox',{name:'起播方式',exact:true})).toHaveCSS('min-height','32px');await shot('playback-preferences-mira-light');
  const settingsScroll=page.locator('.settings-content');
  await settingsScroll.evaluate(el=>el.scrollTop=el.scrollHeight);
  await expect.poll(()=>settingsScroll.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('button',{name:'关闭设置',exact:true})).toBeInViewport();
  await expect(page.getByRole('heading',{name:'媒体库设置',exact:true})).toBeInViewport();
  assert.equal(await page.getByRole('dialog',{name:'媒体库设置',exact:true}).evaluate(el=>el.scrollTop),0);
  await shot('settings-fixed-header-scrolled-light');
  for(const tab of ['数据管理','帮助','运行诊断']){
    await page.getByRole('tab',{name:tab,exact:true}).click();
    await expect(settingsScroll).toHaveJSProperty('scrollTop',0);
    if(tab==='数据管理'){
      await expect(page.getByRole('checkbox',{name:'备份包含缩略图',exact:true})).toHaveCSS('width','30px');
      await expect(page.locator('.storage-sizes>div').first()).toBeVisible();
      await page.getByRole('region',{name:'媒体库备份',exact:true}).scrollIntoViewIfNeeded();await shot('workspace-backup-light');
      await page.getByRole('region',{name:'应用存储',exact:true}).scrollIntoViewIfNeeded();await shot('workspace-storage-light');
    }
    if(tab==='帮助'){
      await page.getByRole('tab',{name:'快捷操作',exact:true}).click();
      await expect(page.getByRole('tab',{name:'快捷操作',exact:true})).toHaveCSS('border-top-width','0px');
    }
    if(tab==='运行诊断'){
      await page.locator('.runtime-diagnostics>summary').click();await expect(page.locator('.diagnostic-fields')).toBeVisible();
    }
    assert.equal(await page.getByRole('dialog',{name:'媒体库设置',exact:true}).evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await shot(`workspace-${tab}-light`);
  }
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  assert.deepEqual(fingerprint(),originals);assert.equal(playbackRequests,0);assert.deepEqual(errors,[]);
  // Actual Electron error presentation + retry, not only a browser CSS harness.
  let rejectPlayback=true;
  let rejectQueue=true;
  const queueRead=route=>rejectQueue?route.fulfill({status:503,json:{detail:'验收：待播队列读取失败'}}):route.continue();
  await page.route('**/api/media/*/siblings?**',queueRead);
  await page.route('**/api/media/*/playback',route=>rejectPlayback?route.fulfill({status:422,json:{detail:'验收：原画播放暂时失败，原视频与观看记录已保留。可以重试，不会自动降低分辨率或转换音轨。'}}):route.continue());
  await page.getByRole('button',{name:`播放 ${titles[0]}`,exact:true}).click();
  const errorCard=page.locator('.video-wrap>.resume[role="alert"]');await expect(errorCard).toBeVisible();
  await expect(errorCard.getByRole('button',{name:'仅兼容音轨（视频原画）',exact:true})).toHaveCount(0); // generated source is silent
  const errorGeometry=await errorCard.evaluate(el=>({width:el.getBoundingClientRect().width,cssWidth:getComputedStyle(el).width,dpr:devicePixelRatio}));
  console.log('Playback error card CSS geometry:',JSON.stringify(errorGeometry));
  // Fractional Windows DPI can expose a 480.00003px CSS bounding rectangle.
  assert.ok(errorGeometry.width<=480.1,JSON.stringify(errorGeometry));assert.equal(await errorCard.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await shot('player-error-mira-light');rejectPlayback=false;
  await errorCard.getByRole('button',{name:'重试播放',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:30000}).toBe(true);
  const originalPlaybackSource=await page.locator('video').evaluate(v=>{v.pause();return v.currentSrc;});
  for(const theme of ['light','dark']){
    if(theme==='dark')await page.getByRole('button',{name:'切换至深色模式',exact:true}).click();
    const bar=await page.locator('.player-controls').boundingBox();await page.mouse.move(bar.x+bar.width/2,bar.y+bar.height-6);
    await page.getByRole('button',{name:'画质',exact:true}).click();
    const popover=page.getByRole('region',{name:'画质设置',exact:true});await expect(popover).toBeVisible();await expect(popover).toHaveCSS('backdrop-filter','none');
    await shot(`player-settings-mira-${theme}`);await page.keyboard.press('Escape');
    assert.equal(await page.locator('video').evaluate(v=>v.currentSrc),originalPlaybackSource);
  }
  const queuePanel=page.getByRole('region',{name:'待播队列',exact:true});
  const expandQueue=page.getByRole('button',{name:'展开待播队列',exact:true});if(await expandQueue.isVisible())await expandQueue.click();
  await expect(queuePanel.getByRole('alert')).toContainText('待播队列读取失败');await expect(queuePanel.getByRole('combobox',{name:'播放模式',exact:true})).toHaveCSS('height','32px');
  await shot('queue-read-error-dark');rejectQueue=false;
  const framesBeforeQueueRetry=await page.locator('video').evaluate(v=>{v.dataset.queueReloads='0';v.addEventListener('loadstart',()=>{v.dataset.queueReloads=String(Number(v.dataset.queueReloads)+1);});return v.getVideoPlaybackQuality().totalVideoFrames;});
  await page.locator('video').evaluate(v=>v.play());await queuePanel.getByRole('button',{name:'重试待播队列',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(queuePanel.getByRole('alert')).toHaveCount(0);await expect(queuePanel.locator('li')).toHaveCount(6);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(framesBeforeQueueRetry);
  assert.equal(await page.locator('video').evaluate(v=>v.currentSrc),originalPlaybackSource);assert.equal(await page.locator('video').getAttribute('data-queue-reloads'),'0');
  await page.unroute('**/api/media/*/siblings?**',queueRead);
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  // Presentation-only long paths: no file operation is executed against this fixture.
  const layoutTitle='长标题 · '+'文件名与目录层级验收_'.repeat(16),layoutPath='D:\\'+('长目录层级_'.repeat(6)+'\\').repeat(7)+'原视频.mp4';
  const layoutMedia=async route=>{const response=await route.fetch(),value=await response.json();await route.fulfill({response,json:{...value,items:value.items.map((item,index)=>index===0?{...item,title:layoutTitle,path:layoutPath}:item)}});};
  const layoutActions=route=>route.fulfill({json:{rename:true,recycle:true,reason:''}});
  const operationsBefore=await api('/api/file-operations');
  await page.route('**/api/media?**',layoutMedia);await page.route('**/api/media/*/file-actions',layoutActions);
  for(const theme of ['dark','light']){
    if(theme==='light')await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
    await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(800,600));
    await page.reload();const trigger=page.getByRole('button',{name:`更多操作 ${layoutTitle}`,exact:true});await trigger.click();
    await page.getByRole('menuitem',{name:'重命名文件',exact:true}).click();const fileDialog=page.getByRole('dialog',{name:'重命名视频文件',exact:true});
    const nameInput=fileDialog.getByRole('textbox',{name:'新文件名',exact:true});await nameInput.fill('仅为未执行的长文件名草稿_'.repeat(12));
    const body=fileDialog.locator('.file-action-content');await body.evaluate(el=>el.scrollTop=el.scrollHeight);
    await expect(fileDialog.getByRole('heading',{name:'重命名文件',exact:true})).toBeInViewport();await expect(fileDialog.getByRole('button',{name:'关闭文件操作',exact:true})).toBeInViewport();
    await expect(fileDialog.getByRole('button',{name:'取消',exact:true})).toBeInViewport();await expect(fileDialog).toHaveJSProperty('scrollTop',0);
    assert.equal(await fileDialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await shot(`short-window-long-path-${theme}`);
    await fileDialog.getByRole('button',{name:'取消',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'放弃文件名修改？',exact:true});
    await expect(confirmation.getByRole('button',{name:'取消确认',exact:true})).toBeFocused();assert.ok((await confirmation.boundingBox()).width<=480.1);await shot(`short-window-nested-confirm-${theme}`);
    await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);await expect(nameInput).toHaveValue('仅为未执行的长文件名草稿_'.repeat(12));
    assert.equal(await nameInput.evaluate(el=>!el.closest('[inert]')),true);
    await fileDialog.getByRole('button',{name:'取消',exact:true}).click();await confirmation.getByRole('button',{name:'放弃修改',exact:true}).click();
    await expect(fileDialog).toHaveCount(0);await expect(trigger).toBeFocused();
  }
  await page.unroute('**/api/media?**',layoutMedia);await page.unroute('**/api/media/*/file-actions',layoutActions);
  // Read-only display fixtures for recent -> full record navigation; never restore/delete.
  const recentItems=Array.from({length:6},(_,index)=>({id:(index+1).toString(16).padStart(32,'0'),name:`${layoutTitle} ${index}.mp4`,source:layoutPath,size:1000,created_at:1,status:'restored',error:''}));
  const recentRead=route=>route.fulfill({json:{items:recentItems,total:6,page:1,pages:1}});
  await page.route('**/api/recycle-records?**',recentRead);
  for(const theme of ['light','dark']){
    if(theme==='dark')await page.getByRole('button',{name:'切换至深色模式',exact:true}).click();
    const recentTrigger=page.getByRole('button',{name:'最近回收',exact:true});await recentTrigger.click();const recent=page.getByRole('dialog',{name:'最近回收',exact:true});
    await expect(recent.locator('li')).toHaveCount(6);await recent.locator('.recent-recycle-content').evaluate(el=>el.scrollTop=el.scrollHeight);
    await expect(recent.getByRole('heading',{name:'最近回收',exact:true})).toBeInViewport();await expect(recent.getByRole('button',{name:'关闭最近回收',exact:true})).toBeInViewport();
    await expect(recent.getByRole('button',{name:'查看全部回收记录',exact:true})).toBeInViewport();await expect(recent).toHaveJSProperty('scrollTop',0);
    await expect(recent.locator('li').first().getByRole('button')).toHaveCSS('height','28px');await shot(`recent-records-short-${theme}`);
    await recent.getByRole('button',{name:'查看全部回收记录',exact:true}).click();const allRecords=page.getByRole('dialog',{name:'回收记录',exact:true});
    await expect(allRecords).toBeVisible();assert.equal(await allRecords.evaluate(el=>!el.closest('[inert]')),true);
    await allRecords.getByRole('button',{name:'关闭回收记录',exact:true}).click();await expect(recentTrigger).toBeFocused();
  }
  await page.unroute('**/api/recycle-records?**',recentRead);
  assert.deepEqual(await api('/api/file-operations'),operationsBefore);
  assert.deepEqual(fingerprint(),originals);assert.deepEqual(errors,[]);
  console.log('Real Electron second-round refinement passed: wide/compact filters, settings grouping, task pause/resume, atomic batch join, duplicate skip, removal/undo, concurrent-order protection, dark/light layouts and unchanged synthetic sources. Artifacts:',folder);
}finally{if(desktop){const stopped=desktop.waitForEvent('close',{timeout:20000});await desktop.evaluate(({app})=>setTimeout(()=>app.quit(),0));await stopped;}}
