// Real Electron failure injection. No media mutation/OS recycle is dispatched.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});
const owned=mkdtempSync(path.join(root,'build','file-preview-'));
const executableOption=process.argv.find(value=>value.startsWith('--executable='));
const executablePath=executableOption?path.resolve(executableOption.slice('--executable='.length)):undefined;
if(executablePath)assert.ok(realpathSync(executablePath).startsWith(realpathSync(path.join(root,'build'))+path.sep),'Packaged fault acceptance only launches an owned build executable');
const report={build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),passed:false,cases:[],errors:[],limitations:['Synthetic transport faults in real Electron; no media mutation, OS recycle, or performance claim.']};
let desktop,page;
async function start(){
 desktop=await _electron.launch({...(executablePath?{executablePath,args:[]}:{args:[root]}),cwd:owned,env:{...process.env,AVHUB_DATA_DIR:path.join(owned,'profile'),AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor({timeout:30000});
 const health=await page.evaluate(async()=>await(await fetch('/api/health')).json());
 const packaged=await desktop.evaluate(({app})=>app.isPackaged);
 assert.equal(packaged,Boolean(executablePath));assert.equal(health.frozen,Boolean(executablePath));assert.equal(health.build_id,report.build.build_id);
 assert.equal(realpathSync(health.data_dir),realpathSync(path.join(owned,'profile')));
 report.runtime={packaged,frozen:health.frozen,build:health.build_id,isolatedProfile:true};
 await desktop.evaluate(({dialog})=>{
  globalThis.__previewFetch=globalThis.fetch;globalThis.__previewCalls=[];globalThis.__previewDialogs=[];globalThis.__previewMode='headers';
  globalThis.fetch=(input,options)=>{
   const url=String(input);
   if(/\/api\/(?:file-operations\/preview|recycle-records\/preview|roots\/1\/file-permissions)$/.test(url)){
    const call={url,signal:options?.signal,resolve:null};globalThis.__previewCalls.push(call);
    if(globalThis.__previewMode==='body')return Promise.resolve({ok:true,headers:new Headers({'content-type':'application/json'}),json:()=>{call.bodyRequested=true;return new Promise(resolve=>{call.resolve=resolve;});}});
    return new Promise(resolve=>{call.resolve=resolve;});
   }
   return globalThis.__previewFetch(input,options);
  };
  dialog.showMessageBox=async(_parent,options)=>{globalThis.__previewDialogs.push(options.title);return {response:0,checkboxChecked:false};};
 });
}
async function begin(input){
 await page.evaluate(input=>{window.__previewResult=null;window.__previewPending=window.avhubDesktop.fileOperation(input).then(value=>{window.__previewResult={ok:true,value};},error=>{window.__previewResult={ok:false,error:String(error)};});},input);
}
async function settled(){await expect.poll(()=>page.evaluate(()=>window.__previewResult),{timeout:15000}).not.toBeNull();return page.evaluate(()=>window.__previewResult);}
async function reset(){await desktop.evaluate(()=>{globalThis.__previewCalls=[];});}
try{
 await start();
 for(const mode of ['headers','body']){
  await desktop.evaluate((_,mode)=>{globalThis.__previewMode=mode;},mode);await reset();
  await begin({action:mode==='headers'?'preview':'preview-records',ids:[1],recordIds:['a'.repeat(32)],recordAction:'restore',requestId:'1'.repeat(32)});
  const result=await settled();assert.equal(result.ok,false);assert.match(result.error,/预检超时.*未执行文件修改/);
  const calls=await desktop.evaluate(()=>globalThis.__previewCalls.map(call=>({aborted:call.signal?.aborted,url:call.url,bodyRequested:call.bodyRequested===true})));assert.equal(calls.length,1);assert.equal(calls[0].aborted,true);assert.equal(calls[0].bodyRequested,mode==='body');
  report.cases.push({mode,result,calls});
 }
 await desktop.evaluate(()=>{globalThis.__previewMode='headers';});await reset();
 const first='2'.repeat(32),second='3'.repeat(32);
 await begin({action:'preview',ids:[1],requestId:first});await expect.poll(()=>desktop.evaluate(()=>globalThis.__previewCalls.length)).toBe(1);
 await page.evaluate(requestId=>window.avhubDesktop.fileOperation({action:'cancel-preview',requestId}),first);assert.match((await settled()).error,/已取消预检/);
 await begin({action:'preview',ids:[1],requestId:second});await expect.poll(()=>desktop.evaluate(()=>globalThis.__previewCalls.length)).toBe(2);
 const stale=await page.evaluate(requestId=>window.avhubDesktop.fileOperation({action:'cancel-preview',requestId}),first);assert.equal(stale.cancelled,false);assert.equal(await page.evaluate(()=>window.__previewResult),null);
 await page.evaluate(requestId=>window.avhubDesktop.fileOperation({action:'cancel-preview',requestId}),second);assert.match((await settled()).error,/已取消预检/);report.cases.push({mode:'explicit and stale cancel',passed:true});
 // Metadata writes are deliberately not cancellable and still block quitting.
 await reset();await begin({action:'permissions',id:1,rename:false,recycle:false});await expect.poll(()=>desktop.evaluate(()=>globalThis.__previewCalls.length)).toBe(1);
 const noWriteCancel=await page.evaluate(()=>window.avhubDesktop.fileOperation({action:'cancel-preview',requestId:'4'.repeat(32)}));assert.equal(noWriteCancel.cancelled,false);
 await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
 await expect.poll(()=>desktop.evaluate(()=>globalThis.__previewDialogs.slice())).toContain('文件操作正在进行');
 assert.equal(await page.evaluate(()=>window.__previewResult),null);
 await desktop.evaluate(()=>{globalThis.__previewCalls[0].resolve(new Response('{"ok":true}',{headers:{'content-type':'application/json'}}));globalThis.__previewDialogs=[];});
 assert.equal((await settled()).ok,true);report.cases.push({mode:'write remains protected',passed:true});
 // Open the actual batch dialog too: its draft guard must not mistake a
 // cancellable preview for an in-flight system write during close/quit.
 const media=path.join(owned,'media');mkdirSync(media);const sample=path.join(media,'Audit owned.mp4');
 const generated=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=12','-t','2','-c:v','libx264','-pix_fmt','yuv420p',sample],{windowsHide:true,timeout:15000});assert.equal(generated.status,0);
 const identity=()=>({hash:createHash('sha256').update(readFileSync(sample)).digest('hex'),mtime:statSync(sample).mtimeMs});const before=identity();
 await page.evaluate(async directory=>{await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});await fetch('/api/scan',{method:'POST'});},media);
 await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/scan')).json()).state),{timeout:30000}).toBe('completed');
 await page.reload();await expect(page.locator('.card')).toHaveCount(1);
 await page.getByRole('button',{name:'批量整理',exact:true}).click();await page.getByRole('checkbox',{name:'选择 Audit owned',exact:true}).check();
 await page.getByRole('button',{name:'所选移入回收站',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'批量移入系统回收站',exact:true});await expect(panel).toContainText('正在检查所选视频');
 await expect.poll(()=>desktop.evaluate(()=>globalThis.__previewCalls.length)).toBe(2);
 await panel.getByRole('button',{name:'取消',exact:true}).click();await expect(panel).toHaveCount(0);
 await expect.poll(()=>desktop.evaluate(()=>globalThis.__previewCalls[1].signal.aborted)).toBe(true);
 report.cases.push({mode:'actual batch dialog cancel',passed:true});
 await page.getByRole('button',{name:'所选移入回收站',exact:true}).click();await expect(panel).toBeVisible();
 await expect.poll(()=>desktop.evaluate(()=>globalThis.__previewCalls.length)).toBe(3);
 assert.deepEqual(identity(),before);report.sourceUnchanged=true;
 const closed=desktop.waitForEvent('close',{timeout:20000});await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await closed;desktop=null;
 report.cases.push({mode:'quit cancels stalled preview',passed:true});report.passed=true;
}catch(error){report.errors.push(String(error?.stack||error));throw error;}
finally{
 if(desktop){await desktop.evaluate(()=>{if(globalThis.__previewFetch)globalThis.fetch=globalThis.__previewFetch;for(const call of globalThis.__previewCalls||[])call.resolve?.(new Response('{"ok":true}',{headers:{'content-type':'application/json'}}));}).catch(()=>{});await desktop.close().catch(()=>{});}
 writeFileSync(path.join(owned,'acceptance.json'),JSON.stringify(report,null,2));console.log('File preview acceptance:',JSON.stringify({passed:report.passed,report:path.join(owned,'acceptance.json')}));
}
