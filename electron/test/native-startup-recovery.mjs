// Real Electron IPC/read-fence regression. Startup/cleanup fault is injected;
// successful retry uses the real MPV runtime and a generated TEMP video.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),folder=ownedTemporaryWorkspace('avhub-native-recovery-'),media=path.join(folder,'media');mkdirSync(media);
const file=path.join(media,'Recovery.mp4');assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=12','-t','10','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true,timeout:30000}).status,0);
const identity=()=>({sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),mtime:statSync(file).mtimeMs}),before=identity();let desktop;
console.log('Owned recovery fixture:',folder);
try{
 desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:path.join(folder,'profile'),AVHUB_APP_HOME:folder,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});const page=await desktop.firstWindow();try{await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();}catch(error){console.error(await page.locator('body').innerText());throw error;}
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 const dir=await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await expect.poll(async()=>(await api('/api/thumbnails')).pending).toBe(0);
 const item=(await api('/api/media?page=1')).items[0];await page.evaluate(id=>window.avhubDesktop.fileOperation({action:'permissions',id,rename:true,recycle:false,permanentDelete:false}),dir.id);
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});
 await desktop.evaluate((_,root)=>{const load=process.getBuiltinModule('module').createRequire(root+'/package.json');const {MpvClient}=load(root+'/electron/dist/mpvClient.js');globalThis.recoveryOriginal={start:MpvClient.prototype.start,stop:MpvClient.prototype.stop};MpvClient.prototype.start=async function(){this.startupStage='ipc';throw new Error('测试连接失败：原始原因');};MpvClient.prototype.stop=async function(){throw new Error('测试退出仍未确认');};},root);
 await page.reload();await page.locator('.open-video').first().click();await expect(page.getByRole('alert')).toContainText('测试连接失败：原始原因');await expect(page.getByRole('alert')).toContainText('文件保护已保留');await expect(page.getByRole('alert')).not.toContainText('Error invoking');await expect(page.locator('.native-embedded-caption')).toContainText('原生播放启动失败');
 assert.equal((await api(`/api/media/${item.id}/file-actions`)).rename,false);
 await page.getByRole('button',{name:'重新播放',exact:true}).click();await expect(page.getByRole('alert')).toContainText('测试连接失败：原始原因');await expect(page.getByRole('alert')).toContainText('文件保护已保留');assert.equal((await api(`/api/media/${item.id}/file-actions`)).rename,false);
 // Navigation/fallback cannot bypass the retained native reader fence either.
 for(const label of ['返回媒体库','切换现有播放器']){
  await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('alert')).toContainText('测试连接失败：原始原因');await expect(page.getByRole('alert')).not.toContainText('Error invoking');await expect(page.getByLabel('MPV 原生播放区域')).toBeVisible();await expect(page.locator('video')).toHaveCount(0);assert.equal((await api(`/api/media/${item.id}/file-actions`)).rename,false);
 }
 await desktop.evaluate((_,root)=>{const load=process.getBuiltinModule('module').createRequire(root+'/package.json');const {MpvClient}=load(root+'/electron/dist/mpvClient.js');Object.assign(MpvClient.prototype,globalThis.recoveryOriginal);},root);
 await page.getByRole('button',{name:'重新播放',exact:true}).click();await expect(page.getByText('MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:30000});
 await expect.poll(()=>page.evaluate(async()=>(await window.avhubDesktop.nativePlayer('snapshot')).phase),{timeout:30000}).toBe('ready');
 await assert.rejects(()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('recover')),/正常关闭/);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);await expect.poll(async()=>(await api(`/api/media/${item.id}/file-actions`)).rename).toBe(true);
 // Controls can fail while the decoder branch is still initializing. Cleanup
 // must await that branch, stop its real process, and allow a clean UI retry.
 await desktop.evaluate(({BrowserWindow},root)=>{
  const load=process.getBuiltinModule('module').createRequire(root+'/package.json'),{MpvClient}=load(root+'/electron/dist/mpvClient.js');
  globalThis.parallelOriginal={loadURL:BrowserWindow.prototype.loadURL,start:MpvClient.prototype.start};globalThis.parallelStarted=false;
  BrowserWindow.prototype.loadURL=function(url,...args){return url.includes('nativePlayer=')?Promise.reject(new Error('测试控制层加载失败')):globalThis.parallelOriginal.loadURL.call(this,url,...args);};
  MpvClient.prototype.start=async function(...args){await new Promise(r=>setTimeout(r,150));const result=await globalThis.parallelOriginal.start.apply(this,args);globalThis.parallelStarted=true;return result;};
 },root);
 await page.locator('.open-video').first().click();await expect(page.getByRole('alert')).toContainText('测试控制层加载失败');
 assert.equal(await desktop.evaluate(()=>globalThis.parallelStarted),true,'decoder branch settled before the failed open returned');
 assert.equal((await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active,false);
 assert.equal((await api(`/api/media/${item.id}/file-actions`)).rename,true,'failed controls release fence only after decoder exit');
 await desktop.evaluate(({BrowserWindow},root)=>{const load=process.getBuiltinModule('module').createRequire(root+'/package.json'),{MpvClient}=load(root+'/electron/dist/mpvClient.js');BrowserWindow.prototype.loadURL=globalThis.parallelOriginal.loadURL;MpvClient.prototype.start=globalThis.parallelOriginal.start;},root);
 await page.getByRole('button',{name:'重新播放',exact:true}).click();await expect(page.getByText('MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:30000});
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
 await desktop.evaluate(({BrowserWindow},root)=>{
  const load=process.getBuiltinModule('module').createRequire(root+'/package.json'),{MpvClient}=load(root+'/electron/dist/mpvClient.js');
  BrowserWindow.prototype.loadURL=function(url,...args){return url.includes('nativePlayer=')?Promise.reject(new Error('测试导航次要失败')):globalThis.parallelOriginal.loadURL.call(this,url,...args);};
  MpvClient.prototype.start=async function(){throw new Error('测试解码初始化主要失败');};
 },root);
 await page.locator('.open-video').first().click();await expect(page.getByRole('alert')).toContainText('测试解码初始化主要失败');await expect(page.getByRole('alert')).not.toContainText('测试导航次要失败');
 assert.equal((await api(`/api/media/${item.id}/file-actions`)).rename,true);
 await desktop.evaluate(({BrowserWindow},root)=>{const load=process.getBuiltinModule('module').createRequire(root+'/package.json'),{MpvClient}=load(root+'/electron/dist/mpvClient.js');BrowserWindow.prototype.loadURL=globalThis.parallelOriginal.loadURL;MpvClient.prototype.start=globalThis.parallelOriginal.start;},root);
 await page.getByRole('button',{name:'重新播放',exact:true}).click();await expect(page.getByText('MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:30000});
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
 assert.deepEqual(identity(),before);await desktop.close();desktop=null;writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify({startupFaultInjected:true,readFenceRetained:true,realMpvRetry:true,parallelControlsFailure:true,primaryDecoderFailurePreserved:true,sourceUnchanged:true,cleanExit:true},null,2));console.log('Native startup recovery passed. Artifacts:',folder);
}finally{if(desktop)await desktop.close();}
