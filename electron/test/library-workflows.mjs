import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
mkdirSync(path.join(root,'build'),{recursive:true});const folder=mkdtempSync(path.join(root,'build','electron-library-workflows-'));
const data=path.join(folder,'profile'),media=path.join(folder,'media'),exports=path.join(folder,'exports');mkdirSync(media);mkdirSync(exports);
const video=path.join(media,'Workflow sample.mp4');
const encoded=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',video],{windowsHide:true,timeout:30000});assert.equal(encoded.status,0,encoded.stderr?.toString());
const hash=()=>createHash('sha256').update(readFileSync(video)).digest('hex'),originalHash=hash(),originalTime=statSync(video).mtimeMs;
let desktop;const errors=[];
try{
desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
const page=await desktop.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const result=await r.json();if(!r.ok)throw new Error(JSON.stringify(result));return result;},{url,method,body});
const settings=async tab=>{await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:tab,exact:true}).click();};
await expect(page.getByText('添加文件夹，建立本地视频库',{exact:true})).toBeVisible();
await settings('媒体目录');await page.getByRole('textbox',{name:'目录路径',exact:true}).fill(media);await page.getByRole('button',{name:'添加目录',exact:true}).click();await page.getByRole('button',{name:'现在扫描此目录',exact:true}).click();
await expect.poll(async()=> (await api('/api/scan')).state,{timeout:30000}).toBe('completed');await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
const item=(await api('/api/media?page=1')).items[0];let playbackRequests=0;page.on('request',request=>{if(request.url().includes('/playback'))playbackRequests++;});
await page.locator('.media-more').click();await page.getByRole('menuitem',{name:'编辑信息与封面',exact:true}).click();await expect(page.getByRole('dialog',{name:'编辑媒体信息与封面'})).toBeVisible();
await page.getByRole('textbox',{name:'显示标题',exact:true}).fill('Edited without playback');
await page.screenshot({path:path.join(folder,'standalone-editor-dark.png')});
page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'关闭媒体编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'显示标题',exact:true})).toHaveValue('Edited without playback');
await page.getByRole('button',{name:'保存信息',exact:true}).click();await expect(page.getByText('媒体信息已保存',{exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'完成',exact:true}).click();assert.equal(playbackRequests,0);assert.equal((await api(`/api/media/${item.id}`)).title,'Edited without playback');
await page.getByRole('button',{name:'切换至浅色模式',exact:true}).click();await page.locator('.media-more').click();await page.getByRole('menuitem',{name:'编辑信息与封面',exact:true}).click();await page.screenshot({path:path.join(folder,'standalone-editor-light.png')});await page.getByRole('button',{name:'完成',exact:true}).click();await page.getByRole('button',{name:'切换至深色模式',exact:true}).click();
await settings('播放偏好');const directory=page.getByRole('textbox',{name:'默认保存目录',exact:true});const previous=await directory.inputValue();const draft=path.join(exports,'draft');await directory.fill(draft);
await page.getByRole('tab',{name:'媒体目录',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await expect(directory).toHaveValue(draft);
page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(directory).toHaveValue(draft);await page.getByRole('button',{name:'放弃修改',exact:true}).click();await expect(directory).toHaveValue(previous);await page.getByRole('button',{name:'关闭设置',exact:true}).click();
const origin=new URL(page.url()).origin;await page.goto(origin+'/?q=missing&format=mkv');await expect(page.getByRole('button',{name:'清除全部条件',exact:true})).toBeVisible();await page.getByRole('button',{name:'清除全部条件',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
await page.route(`**/api/roots/status?ids=${item.root_id}`,route=>route.fulfill({json:[{id:item.root_id,path:media,available:false}]}));await page.goto(origin+`/?root=${item.root_id}&q=missing`);await expect(page.getByText('当前媒体目录离线',{exact:true})).toBeVisible();await page.unroute(`**/api/roots/status?ids=${item.root_id}`);await page.getByRole('button',{name:'查看全部视频',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
await api(`/api/media/${item.id}`,'PATCH',{title:'Episode',kind:'episode',series_title:'Workflow series',season:1,episode:1});await page.goto(origin+'/?view=series&grouped=true');await expect(page.locator('.pagination')).toContainText('共 1 部剧集');await page.locator('.series-group-cover').click();await expect(page.locator('.pagination')).toContainText('共 1 集');await page.goto(origin+'/');
// Stub the native chooser, retaining real IPC validation, API, stream writes and
// file-sync/rename. Every destination is within this owned test directory.
await desktop.evaluate(({dialog,shell})=>{globalThis.__saveChoices=[];globalThis.__revealed=[];dialog.showSaveDialog=async()=>{const filePath=globalThis.__saveChoices.shift();return filePath?{canceled:false,filePath}:{canceled:true};};shell.showItemInFolder=filename=>globalThis.__revealed.push(filename);});
const choose=filename=>desktop.evaluate((_,filename)=>globalThis.__saveChoices.push(filename),filename);
const zip=path.join(exports,'complete.zip');await choose(zip);await settings('数据管理');await page.getByRole('button',{name:'保存完整备份',exact:true}).click();await expect(page.getByText(/备份已保存/)).toBeVisible({timeout:30000});assert.equal(readFileSync(zip).subarray(0,2).toString(),'PK');await page.getByRole('button',{name:'在文件夹中显示备份',exact:true}).click();assert.deepEqual(await desktop.evaluate(()=>globalThis.__revealed),[zip]);
await choose(null);await page.getByRole('button',{name:'保存媒体库备份',exact:true}).click();await expect(page.getByText('已取消保存备份，媒体库未改变。',{exact:true})).toBeVisible();
await choose(video);await page.getByRole('button',{name:'保存媒体库备份',exact:true}).click();await expect(page.getByRole('alert')).toContainText('扩展名');assert.equal(hash(),originalHash);
await choose(path.join(data,'library.db'));await page.getByRole('button',{name:'保存媒体库备份',exact:true}).click();await expect(page.getByRole('alert')).toContainText('应用数据目录之外');assert.equal((await api('/api/media?page=1')).total,1);
await choose(path.join(exports,'database.db'));await page.getByRole('button',{name:'保存媒体库备份',exact:true}).click();await expect(page.getByText(/备份已保存/)).toBeVisible();assert.equal(readFileSync(path.join(exports,'database.db')).subarray(0,16).toString(),'SQLite format 3\0');
// More than eight consecutive exports must retire staging instead of filling
// the backend's bounded data-job pool.
for(let index=0;index<9;index++){await choose(path.join(exports,`repeat-${index}.db`));await page.getByRole('button',{name:'保存媒体库备份',exact:true}).click();await expect(page.getByText(/备份已保存/)).toBeVisible();await expect(page.getByRole('button',{name:'保存媒体库备份',exact:true})).toBeEnabled();assert.equal(readFileSync(path.join(exports,`repeat-${index}.db`)).subarray(0,16).toString(),'SQLite format 3\0');}
await page.getByRole('tab',{name:'运行诊断',exact:true}).click();await page.locator('.runtime-diagnostics>summary').click();await expect(page.getByRole('button',{name:'导出诊断',exact:true})).toBeEnabled();const json=path.join(exports,'diagnostics.json');await choose(json);await page.getByRole('button',{name:'导出诊断',exact:true}).click();await expect(page.getByText('诊断已保存。',{exact:true})).toBeVisible();assert.ok(JSON.parse(readFileSync(json,'utf8')).build.build_id);
await page.getByRole('button',{name:'关闭设置',exact:true}).click();await settings('媒体目录');page.once('dialog',dialog=>{assert.match(dialog.message(),/原视频不会被删除/);dialog.dismiss();});await page.getByRole('button',{name:'移除',exact:true}).click();await expect(page.locator('.root-list>div')).toHaveCount(1);await page.getByRole('button',{name:'关闭设置',exact:true}).click();
for(const request of [{kind:'backup',jobId:'../library.db'},{kind:'diagnostics',url:'https://invalid.example'},{kind:'diagnostics',path:video}])assert.equal(await page.evaluate(async request=>{try{await window.avhubDesktop.saveExport(request);return false;}catch{return true;}},request),true);
assert.equal(await page.evaluate(async()=>{try{await window.avhubDesktop.revealExport('arbitrary-path');return false;}catch{return true;}}),true);
// Cancellation and a truncated stream must preserve an existing destination.
const atomic=path.join(exports,'atomic.db');writeFileSync(atomic,'existing export');
const streamResults=await desktop.evaluate(async({BrowserWindow},args)=>{
  const load=process.getBuiltinModule('module').createRequire(args.module);
  const {LocalExports}=load(args.module);const {readFile,readdir}=load('node:fs/promises');
  const owner=BrowserWindow.getAllWindows()[0];
  const truncated=new LocalExports(()=>args.data,async()=>({filename:'atomic.db',maximum:100,response:new Response('short',{headers:{'Content-Length':'20'}})}));
  globalThis.__saveChoices.push(args.target);let rejected=false;try{await truncated.save(owner,{kind:'diagnostics'});}catch{rejected=true;}
  const cancelled=new LocalExports(()=>args.data,async(_request,signal)=>({filename:'atomic.db',maximum:1048576,response:new Response(new ReadableStream({async pull(controller){await new Promise(resolve=>setTimeout(resolve,15));if(signal.aborted){controller.error(new Error('cancelled'));return;}controller.enqueue(new Uint8Array(4096));}}))}));
  globalThis.__saveChoices.push(args.target);const pending=cancelled.save(owner,{kind:'diagnostics'});await new Promise(resolve=>setTimeout(resolve,100));cancelled.cancel();const result=await pending;
  return {rejected,cancelled:result.cancelled,content:await readFile(args.target,'utf8'),partials:(await readdir(args.exports)).filter(name=>name.endsWith('.partial'))};
},{module:path.join(root,'electron/dist/localExports.js'),data,target:atomic,exports});
assert.equal(streamResults.rejected,true);assert.equal(streamResults.cancelled,true);assert.equal(streamResults.content,'existing export');assert.deepEqual(streamResults.partials,[]);
assert.equal(hash(),originalHash);assert.equal(statSync(video).mtimeMs,originalTime);assert.deepEqual(errors,[]);
await page.screenshot({path:path.join(folder,'library-workflows.png')});console.log('Real Electron library workflows passed: native exports/cancel/failure/atomic write, standalone editing, draft guard, empty-state reset, episode units, root-remove cancel, IPC validation and unchanged synthetic source. Artifacts:',folder);
}finally{if(desktop){const stopped=desktop.waitForEvent('close',{timeout:20000});await desktop.evaluate(({app})=>setTimeout(()=>app.quit(),0));await stopped;}}
