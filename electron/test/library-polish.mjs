// Desktop acceptance: normal app, isolated generated media, no user library.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,copyFileSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const folder=ownedTemporaryWorkspace('avhub-library-polish-'),media=path.join(folder,'media');mkdirSync(media);
const source=path.join(media,'Demo 01.mp4');
const encoded=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=12','-t','4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',source],{windowsHide:true,timeout:30000});
assert.equal(encoded.status,0,encoded.stderr?.toString());
const sources=[source];for(let n=2;n<=12;n++){const file=path.join(media,`Demo ${String(n).padStart(2,'0')}.mp4`);copyFileSync(source,file);sources.push(file);}
const identity=()=>sources.map(file=>({sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),mtime:statSync(file).mtimeMs}));const before=identity();
const errors=[],screenshots=[];let desktop,playbackRequests=0;
try{
 desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:path.join(folder,'profile'),AVHUB_APP_HOME:folder,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/playback'))playbackRequests++;});
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1440,900);w.showInactive();});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
 await api('/api/preferences','PATCH',{values:{hoverPreview:false}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 const items=(await api('/api/media?page=1&page_size=48&sort=name')).items;assert.equal(items.length,12);
 for(let i=0;i<items.length;i++)await api(`/api/media/${items[i].id}`,'PATCH',{title:`界面验收 · 示例视频 ${String(i+1).padStart(2,'0')}${i===0?' · 长标题用于核查截断与菜单布局':''}`,kind:'movie'});
 await expect.poll(async()=>(await api('/api/thumbnails')).pending,{timeout:30000}).toBe(0);
 await page.reload();await expect(page.locator('.card')).toHaveCount(12);
 const refresh=page.getByRole('button',{name:'刷新媒体库',exact:true}),settings=page.getByRole('button',{name:'媒体库设置',exact:true});
 assert.equal(await refresh.textContent(),'');
 const refreshBox=await refresh.boundingBox(),settingsBox=await settings.boundingBox();assert.equal(refreshBox.width,settingsBox.width);assert.equal(refreshBox.height,settingsBox.height);
 const headerBoxes=await page.locator('.header-search>.search-toggle,.header-actions>.ui-icon-button,.header-actions>.scan-recovery').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
 for(let i=0;i<headerBoxes.length;i++){const b=headerBoxes[i];assert.equal(b.width,32);assert.equal(b.height,32);assert.equal(b.y,headerBoxes[0].y);if(i)assert.ok(Math.abs(b.x-headerBoxes[i-1].x-38)<.1);}
 const resolutions=page.getByRole('group',{name:'分辨率筛选',exact:true}),allResolutions=resolutions.getByRole('button',{name:'全部分辨率',exact:true});
 await expect(allResolutions.locator('svg')).toHaveCount(1);assert.equal(await allResolutions.textContent(),'');
 await resolutions.getByRole('button',{name:'筛选 4K',exact:true}).click();await expect(page.locator('.card')).toHaveCount(0);
 await allResolutions.click();await expect(allResolutions).toHaveAttribute('aria-pressed','true');await expect(page.locator('.card')).toHaveCount(12);
 await expect(page.locator('.thumbnail-ready').first()).toBeVisible();
 await page.getByRole('button',{name:'收起扫描结果',exact:true}).click();
 const token='polish-retained';await page.locator('.card').first().evaluate((e,t)=>e.dataset.identity=t,token);
 const screenshot=async name=>{await page.mouse.move(0,0);await page.waitForTimeout(200);const file=path.join(folder,`${name}.png`);await page.screenshot({path:file,animations:'disabled'});screenshots.push(file);};
 // Exercise the desktop scroll container, not just documentElement. Search stays
 // expanded while resizing across the header's wrapping breakpoint.
 await page.getByRole('button',{name:'搜索视频',exact:true}).click();
 for(const tree of [false,true]){
   if(tree)await page.getByRole('button',{name:'显示目录树',exact:true}).click();
   for(const width of [1600,1280,1152,1024,1001,1000,960,800]){
     await desktop.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);
     await expect.poll(()=>page.locator('#app-scroll-area').evaluate(e=>e.scrollWidth-e.clientWidth),{message:`Expanded search, tree=${tree}, width=${width}: page must not overflow`}).toBeLessThanOrEqual(1);
     const outside=await page.locator('main>header .header-actions button,main>header .header-actions input,.media-grid .card').evaluateAll(nodes=>{
       const edge=document.getElementById('app-scroll-area').getBoundingClientRect();
       return nodes.filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&(r.left<edge.left-1||r.right>edge.left+document.getElementById('app-scroll-area').clientWidth+1);}).map(n=>n.getAttribute('aria-label')||n.className);
     });
     assert.deepEqual(outside,[],`Unreachable content at ${width}, tree=${tree}`);
     if(width<=1440){
       const categoriesFit=await page.locator('.primary-nav').evaluate(nav=>{const edge=nav.getBoundingClientRect();return [...nav.children].every(n=>{const r=n.getBoundingClientRect();return r.left>=edge.left-1&&r.right<=edge.right+1;});});
       assert.equal(categoriesFit,true,`Categories should reflow rather than be squeezed at ${width}`);
     }
     await expect(page.locator('.card')).toHaveCount(12);
     if(width===1024||width===800)await screenshot(`responsive-search-tree-${tree}-${width}`);
   }
 }
 await page.getByRole('button',{name:'隐藏目录树',exact:true}).click();
 await page.getByRole('button',{name:'收起搜索',exact:true}).click();
 for(const theme of ['dark','light']){
   if(theme==='light')await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
   for(const width of [1440,1024,800]){
     await desktop.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);
     await expect.poll(()=>page.locator('.toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
     assert.equal(await page.locator('#app-scroll-area').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
     await expect(page.locator('.card').first()).toHaveAttribute('data-identity',token);
     await expect(page.getByRole('group',{name:'浏览与筛选',exact:true})).toBeVisible();
     await expect(page.getByRole('group',{name:'媒体整理',exact:true})).toBeVisible();
     await screenshot(`library-${theme}-${width}`);
   }
 }
 await page.getByRole('button',{name:'更多筛选',exact:true}).click();
 await page.getByRole('combobox',{name:'视频格式',exact:true}).selectOption('mp4');
 await expect(page.getByRole('region',{name:'当前筛选条件'})).toContainText('MP4');await screenshot('filters-light-800');
 await page.getByRole('button',{name:'更多筛选 · 已启用',exact:true}).click();
 await page.getByRole('button',{name:'列表',exact:true}).click();await expect(page.locator('.media-list .card')).toHaveCount(12);await screenshot('list-light-800');
 await page.getByRole('button',{name:'封面墙',exact:true}).click();
 await page.getByRole('button',{name:/^更多操作/}).first().click();
 const menu=page.getByRole('menu');await expect(menu).toBeVisible();const box=await menu.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=800);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCSS('background-color','rgb(255, 255, 255)');await screenshot('settings-light-800');await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 const list=await api('/api/playlists','POST',{name:'设计验收 · 午后片单',media_id:items[0].id});
 for(const item of items.slice(1,5))await api(`/api/playlists/${list.id}/items/${item.id}`,'POST');
 for(const theme of ['light','dark']){
   if(theme==='dark')await page.getByRole('button',{name:'切换至深色模式',exact:true}).click();
   await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
   await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
   await expect(page.getByRole('tablist',{name:'设置分类'})).toHaveAttribute('aria-orientation','vertical');
   await screenshot(`settings-${theme}-1440`);
   await page.getByRole('tab',{name:'媒体目录',exact:true}).focus();await page.keyboard.press('ArrowDown');await expect(page.getByRole('tab',{name:'播放偏好',exact:true})).toBeFocused();await screenshot(`playback-preferences-${theme}-1440`);
   await page.getByRole('button',{name:'关闭设置',exact:true}).click();
   await page.getByRole('button',{name:'播放列表',exact:true}).click();await expect(page.locator('.playlist-video-items>li')).toHaveCount(5);await screenshot(`playlist-${theme}-1440`);await page.getByRole('button',{name:'完成',exact:true}).click();
 }
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(800,900));
 const target=items[0];await page.evaluate(async id=>{const permissions=await fetch(`/api/file-permissions?ids=${id}`).then(r=>r.json());if(!permissions[0]?.supported)throw new Error('Generated TEMP fixture needs local NTFS');await window.avhubDesktop.fileOperation({action:'permissions',id,rename:true,recycle:false,permanentDelete:false});},(await api('/api/roots'))[0].id);
 await expect.poll(async()=>(await api(`/api/media/${target.id}/file-actions`)).rename,{timeout:15000}).toBe(true);
 const title=(await api(`/api/media/${target.id}`)).title;
 await page.getByRole('button',{name:`更多操作 ${title}`,exact:true}).click();await page.getByRole('menuitem',{name:'重命名文件',exact:true}).click();await page.getByRole('textbox',{name:'新文件名',exact:true}).fill('仅预览，不执行重命名');await expect(page.getByLabel('重命名预览')).toContainText('仅预览，不执行重命名.mp4');await screenshot('rename-preview-dark-800');
 await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();
 await page.getByRole('button',{name:'窗口置顶',exact:true}).click();await expect(page.getByRole('button',{name:'取消窗口置顶',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'取消窗口置顶',exact:true}).click();
 assert.deepEqual(identity(),before);assert.equal(playbackRequests,0);assert.deepEqual(errors,[]);
 await desktop.close();desktop=null;
 writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify({build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),engine:'real-electron',generatedMedia:true,sourceUnchanged:true,cleanExit:true,playbackRequests,errors,screenshots,limitations:['Synthetic SDR artwork; not a playback, HDR or physical mixed-DPI performance test.','390px renderer layout is covered by a separate explicitly marked harness; desktop minimum window width is preserved.']},null,2));
 console.log('Real Electron library polish passed. Artifacts:',folder);
}finally{if(desktop)await desktop.close();}
