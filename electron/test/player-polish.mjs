// Real desktop UI acceptance; generated SDR fixtures only, no user library.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,copyFileSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),folder=ownedTemporaryWorkspace('avhub-player-polish-'),media=path.join(folder,'media');mkdirSync(media);
const source=path.join(media,'Player 01.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=12','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',source],{windowsHide:true,timeout:30000}).status,0);
const files=[source];for(let n=2;n<=4;n++){const file=path.join(media,`Player 0${n}.mp4`);copyFileSync(source,file);files.push(file);}
const identity=()=>files.map(file=>({sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),mtime:statSync(file).mtimeMs})),before=identity();
let desktop;const errors=[],screenshots=[];
try{
 desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:path.join(folder,'profile'),AVHUB_APP_HOME:folder,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1440,1000);w.showInactive();});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
 await api('/api/preferences','PATCH',{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true},hoverPreview:false}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await page.reload();await expect(page.locator('.card')).toHaveCount(4);await page.locator('.open-video').first().click();
 const video=page.locator('video');await expect.poll(()=>video.evaluate(v=>v.readyState>=2),{timeout:30000}).toBe(true);
 await video.evaluate(v=>{v.pause();v.dataset.polishIdentity='retained';window.__polishReloads=0;v.addEventListener('emptied',()=>window.__polishReloads++);});
 const src=await video.getAttribute('src');
 const shot=async(name,locator)=>{const file=path.join(folder,name+'.png');await locator.screenshot({path:file,animations:'disabled'});screenshots.push(file);};
 for(const theme of ['dark','light']){
   if(theme==='light')await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();
   await shot(`player-information-${theme}`,page.locator('.player-info'));
   await page.getByText('快捷键帮助',{exact:true}).click();await expect(page.locator('.player-shortcut-grid>div')).toHaveCount(14);
   await expect(page.getByLabel('视频概况')).toContainText('640');
   await page.locator('.shortcut-help').evaluate(e=>e.scrollIntoView({block:'center'}));await shot(`player-shortcuts-${theme}`,page.locator('.shortcut-help'));
   await page.locator('.playback-diagnostics summary').click();await page.locator('.track-information summary').click();
   await page.locator('.playback-diagnostics').evaluate(e=>e.scrollIntoView({block:'center'}));await shot(`player-diagnostics-${theme}`,page.locator('.playback-diagnostics'));
   await page.getByRole('button',{name:'展开待播队列',exact:true}).click();await expect(page.getByRole('list',{name:'待播视频'}).locator('li')).toHaveCount(4);
   await shot(`player-queue-${theme}`,page.getByRole('region',{name:'待播队列'}));
   assert.equal(await page.locator('#app-scroll-area').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
   await expect(video).toHaveAttribute('data-polish-identity','retained');await expect(video).toHaveAttribute('src',src);assert.equal(await video.evaluate(v=>v.paused),true);
   await page.getByRole('button',{name:'收起待播队列',exact:true}).click();await page.getByText('快捷键帮助',{exact:true}).click();await page.locator('.playback-diagnostics summary').click();await page.locator('.track-information summary').click();
 }
 assert.equal(await page.evaluate(()=>window.__polishReloads),0);assert.deepEqual(identity(),before);assert.deepEqual(errors,[]);
 await desktop.close();desktop=null;writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify({build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),sourceUnchanged:true,cleanExit:true,reloads:0,errors,screenshots,limitations:['Generated 640x360 SDR MP4 only; visual/interaction regression, not seek latency or HDR/mixed-DPI acceptance.']},null,2));console.log('Real Electron player polish passed. Artifacts:',folder);
}finally{if(desktop)await desktop.close();}
