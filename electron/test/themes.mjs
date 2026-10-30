// Actual Electron desktop acceptance. Synthetic media only, normal GPU/security.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {themePresets,colorContrast} from '../src/themePalette.ts';
const root=path.resolve(import.meta.dirname,'../..'),folder=mkdtempSync(path.join(root,'build','theme-desktop-')),profile=path.join(folder,'profile'),media=path.join(folder,'media');mkdirSync(media);
const source=path.join(media,'Theme demo 01.mp4');
const generated=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=12','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',source],{windowsHide:true,timeout:30000});assert.equal(generated.status,0,generated.stderr?.toString());
const sources=[source];for(let n=2;n<=8;n++){const file=path.join(media,`Theme demo ${String(n).padStart(2,'0')}.mp4`);copyFileSync(source,file);sources.push(file);}
const identity=()=>sources.map(file=>({bytes:statSync(file).size,mtime:statSync(file).mtimeMs,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')})),before=identity();
const report={build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),completed:false,cleanExit:false,sourceUnchanged:false,engine:'real-electron',generatedMedia:true,errors:[],screenshots:[],palettes:[],layouts:[],limitations:['Playwright drives actual desktop UI, not physical input or display calibration.','Synthetic SDR 640x360 media only; no playback performance, HDR or native MPV ASS-theme claim.']};
let desktop,page,queryCount=0,playbacks=[];
const save=()=>writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify(report,null,2));save();console.log('Theme desktop artifacts:',folder);
async function launch(){
 const env={...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:folder,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 desktop=await _electron.launch({args:[root],cwd:folder,env,timeout:60000});page=await desktop.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1440,900);w.show();w.focus();});
}
async function stop(){const gone=desktop.waitForEvent('close',{timeout:30000});await desktop.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await gone;desktop=null;}
const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
const open=async()=>{await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'外观',exact:true}).click();};
const screenshot=async name=>{const file=path.join(folder,name+'.png');await page.getByRole('dialog',{name:'媒体库设置',exact:true}).screenshot({path:file,animations:'disabled'});report.screenshots.push(file);};
try{
 await launch();await api('/api/preferences','PATCH',{values:{appearance:{theme:'light',coverSize:'comfortable'},hoverPreview:false,resumeBehavior:'restart',audio:{volume:0,muted:true}}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await expect.poll(async()=>(await api('/api/thumbnails')).pending,{timeout:30000}).toBe(0);
 await page.reload();await expect(page.locator('.card')).toHaveCount(8);await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.locator('html')).toHaveAttribute('data-cover-size','comfortable');
 await page.locator('.card').first().evaluate(e=>e.dataset.themeDesktopIdentity='retained');
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media')queryCount++;if(r.method()==='POST'&&/\/api\/media\/\d+\/playback$/.test(new URL(r.url()).pathname))playbacks.push(r.postDataJSON());});
 await open();
 for(const preset of themePresets){
  await page.getByRole('radio',{name:preset.label+'主题',exact:true}).check();
  const colors=await page.locator('html').evaluate(e=>{const s=getComputedStyle(e);return {accent:s.getPropertyValue('--ui-accent').trim(),background:s.getPropertyValue('--ui-surface').trim(),selection:s.getPropertyValue('--ui-selection-bg').trim(),selectionText:s.getPropertyValue('--ui-selection-fg').trim()};});
  assert.ok(colorContrast(colors.accent,colors.background)>=4.5);assert.ok(colorContrast(colors.selectionText,colors.selection)>=4.5);report.palettes.push({id:preset.id,...colors});
 }
 await page.getByRole('textbox',{name:'主题色 HEX',exact:true}).fill('#178C7A');await page.getByRole('combobox',{name:'背景风格',exact:true}).selectOption('cool');await screenshot('appearance-light');
 assert.deepEqual((await api('/api/preferences')).values.appearance,{theme:'light',coverSize:'comfortable'},'Preview never writes or destroys legacy settings');
 await page.getByRole('button',{name:'深色',exact:true}).click();await screenshot('appearance-dark');
 for(const width of [1000,800]){
  await desktop.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);
  await expect.poll(()=>page.locator('.settings-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await screenshot('appearance-dark-'+width);report.layouts.push({width,noHorizontalOverflow:true});
 }
 assert.equal(queryCount,0,'Theme preview must not refetch the library');await expect(page.locator('.card').first()).toHaveAttribute('data-theme-desktop-identity','retained');
 await page.getByRole('button',{name:'取消修改',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByRole('textbox',{name:'主题色 HEX',exact:true}).fill('#178C7A');await page.getByRole('button',{name:'跟随系统',exact:true}).click();await page.getByRole('combobox',{name:'背景风格',exact:true}).selectOption('warm');
 await page.getByRole('button',{name:'保存外观',exact:true}).click();await expect(page.getByText('外观已保存',{exact:true})).toBeVisible();report.saved=(await api('/api/preferences')).values.appearance;
 assert.equal(report.saved.theme,'system');assert.equal(report.saved.accent,'#178c7a');assert.equal(report.saved.coverSize,'comfortable');
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('button',{name:'播放 Theme demo 01',exact:true}).click();
 await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState>=2&&!v.paused&&v.currentTime>.1&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:30000}).toBe(true);
 await page.locator('video').evaluate(v=>{v.pause();v.dataset.themeDesktopVideo='retained';});const sourceBefore=await page.locator('video').evaluate(v=>v.currentSrc);
 const mode=await page.locator('html').getAttribute('data-theme');await page.getByRole('button',{name:mode==='dark'?'切换至浅色模式':'切换至深色模式',exact:true}).click();
 await expect(page.locator('video')).toHaveAttribute('data-theme-desktop-video','retained');assert.equal(await page.locator('video').evaluate(v=>v.currentSrc),sourceBefore);assert.equal(playbacks.length,1);assert.ok(playbacks[0].prefer_original&&!playbacks[0].force_transcode&&!playbacks[0].allow_video_transcode&&!playbacks[0].allow_audio_transcode);
 report.playback={sourceUnchanged:true,requests:playbacks.length,width:await page.locator('video').evaluate(v=>v.videoWidth),height:await page.locator('video').evaluate(v=>v.videoHeight)};
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await open();await page.getByRole('button',{name:'跟随系统',exact:true}).click();await page.getByRole('button',{name:'保存外观',exact:true}).click();await expect(page.getByText('外观已保存',{exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await stop();await launch();await expect(page.locator('.card')).toHaveCount(8);await expect(page.locator('html')).toHaveAttribute('data-theme-mode','system');
 const current=await api('/api/preferences');assert.deepEqual(current.values.appearance,report.saved);await open();await expect(page.getByRole('textbox',{name:'主题色 HEX',exact:true})).toHaveValue('#178c7a');await screenshot('appearance-restored');
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await stop();report.cleanExit=true;report.sourceUnchanged=JSON.stringify(before)===JSON.stringify(identity());assert.equal(report.sourceUnchanged,true);assert.deepEqual(report.errors,[]);report.completed=true;save();console.log('Real Electron theme acceptance passed:',folder);
}catch(error){report.errors.push(String(error.stack??error));save();throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});}
