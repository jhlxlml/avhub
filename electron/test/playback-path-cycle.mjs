import {placeTestMedia} from './media-pool.mjs';
// Real Electron three-path integration. Generated fixtures; no physical HDR claim.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {playbackFixture} from './playback-fixtures.mjs';
import {desktopTestSubject} from './desktop-test-subject.mjs';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/playback-path-cycle-')),media=path.join(data,'media'),shots=path.join(data,'shots');
const packagedExe=process.env.AVHUB_TEST_PACKAGED_EXE;
mkdirSync(media);mkdirSync(shots);const source=path.join(media,'Cycle.mp4');placeTestMedia(playbackFixture('basic'),source);
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();
const report={kind:'real-Electron-three-path-cycle',rows:[],passed:false};let desktop,page;
try{
 desktop=await _electron.launch({...(packagedExe?{executablePath:packagedExe,args:[]}:{args:[root]}),cwd:data,env:{...process.env,...(packagedExe?{AVHUB_RENDER_RUNTIME_CANDIDATE:'',AVHUB_RENDER_LOCAL_ACCEPTANCE:''}:{}),AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 report.subject=await desktopTestSubject(desktop,import.meta.url);assert.equal(report.subject.kind,packagedExe?'packaged-desktop':'source-desktop');
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{MpvClient}=require(app.getAppPath()+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start;MpvClient.prototype.start=function(...args){globalThis.__cycleMpv=this;return start.apply(this,args);};});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 for(const mode of ['render','independent','chromium','render','independent','chromium']){
  await api('/api/preferences','PATCH',{values:{playerEngine:mode==='chromium'?'chromium':'mpv',mpvWindowMode:'independent',nativeRenderEnabled:mode==='render',mpvSeekPolicy:'fast',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true},screenshots:{directory:shots,shortcut:'C'}}});
  await page.reload();await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__cycleRender=s));await page.getByRole('button',{name:'播放 Cycle',exact:true}).click();
  const row={mode};
  if(mode==='chromium'){
   const video=page.locator('video').first();await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:30000}).toBeGreaterThan(.1);
   await page.keyboard.press('Space');await expect.poll(()=>video.evaluate(v=>v.paused)).toBe(true);
   const timeline=page.getByRole('slider',{name:'视频完整进度',exact:true}),bounds=await timeline.boundingBox(),maximum=await timeline.evaluate(el=>Number(el.max));assert.ok(bounds);await page.mouse.move(bounds.x+8+(bounds.width-16)*2/maximum,bounds.y+bounds.height/2);await page.waitForTimeout(50);await page.mouse.click(bounds.x+8+(bounds.width-16)*2/maximum,bounds.y+bounds.height/2);
   await expect.poll(()=>video.evaluate(v=>Math.abs(v.currentTime-2)),{timeout:10000}).toBeLessThan(.15);
   await page.keyboard.press('Space');await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(2.1);
   await page.keyboard.press('c');
  }else{
   const state=()=>mode==='render'?page.evaluate(()=>window.__cycleRender):page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
   await expect.poll(async()=>(await state().catch(()=>null))?.phase,{timeout:30000}).toBe('ready');const s=await state();row.sourceLoads=s.sourceLoads;
   const command=async(action,value)=>{
    if(mode!=='render'){
     const args=action==='pause'?['set_property','pause',value]:action==='seek'?['script-message-to','avhub_ui','seek-relative',String(value)]:['script-message','avhub','screenshot'];
     await desktop.evaluate((_,args)=>globalThis.__cycleMpv.command(args),args);
     if(action==='pause')await expect.poll(async()=>(await state()).properties.pause).toBe(value);
     if(action==='screenshot')await expect.poll(()=>readdirSync(shots).filter(n=>n.endsWith('.png')).length,{timeout:30000}).toBe(report.rows.length+1);
     return;
    }
    if(action==='pause'){await page.getByRole('button',{name:value?'暂停':'播放',exact:true}).evaluate(el=>el.click());await expect.poll(async()=>(await state()).properties.pause).toBe(value);}
    else if(action==='seek')await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
    else {await page.getByRole('button',{name:'截图（C）',exact:true}).evaluate(el=>el.click());await expect(page.locator('.native-notice')).toContainText('截图已保存：',{timeout:30000});}
   };
   await command('pause',true);await command('seek',2);await expect.poll(async()=>(await state()).pendingSeek,{timeout:15000}).toBe(null);
   await command('screenshot');await command('pause',false);
   const position=Number((await state()).properties['time-pos']);await expect.poll(async()=>Number((await state()).properties['time-pos'])).toBeGreaterThan(position+.1);
   assert.equal((await state()).sourceLoads,1);row.hwdec=(await state()).properties['hwdec-current'];
  }
  const count=report.rows.length+1;await expect.poll(()=>readdirSync(shots).filter(n=>n.endsWith('.png')).length,{timeout:30000}).toBe(count);
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.getParentWindow())?.minimize());
  await new Promise(resolve=>setTimeout(resolve,700));
  await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.getParentWindow());main?.restore();main?.show();});
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);
  await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active).toBe(false);
  await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active).toBe(false);
  await expect(page.locator('.native-render-canvas')).toHaveCount(0);report.rows.push(row);
 }
 assert.equal(hash(),before);report.passed=true;
}catch(error){report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);throw error;}
finally{await desktop?.close();writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}
