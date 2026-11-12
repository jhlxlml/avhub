import {placeTestMedia} from './media-pool.mjs';
// Real Electron settings/reopen acceptance using owned generated media.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/mpv-seek-settings-')),media=path.join(data,'media');
mkdirSync(media);const file=path.join(media,'Framecode.mp4');
placeTestMedia(path.join(root,'build/libmpv-render-spike/samples/Framecode-v2-640x360.mp4'),file,{ownedGenerated:true});
const hash=()=>createHash('sha256').update(readFileSync(file)).digest('hex'),before=hash();
const staging=JSON.parse(readFileSync(path.join(root,'build/replayed-render-staging.json'),'utf8'));
const report={cases:[],completed:false};let desktop,page;
try{
 for(const embedded of [true,false]){
  if(!embedded){const reset=spawnSync('python',['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"DELETE FROM preferences WHERE key='mpvSeekPolicy'\"); c.commit(); c.close()",path.join(data,'library.db')],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(reset.status,0,reset.stderr);}
  desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_RENDER_RUNTIME_CANDIDATE:path.basename(staging.folder),AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{
   const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();
  },{url,method,body});
  if(embedded){await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');}
  await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:embedded,mpvWindowMode:'independent',resumeBehavior:'restart',autoNext:false,playbackSessionCoordinatorEnabled:false}});
  await page.reload();
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  assert.equal((await api('/api/preferences')).values.mpvSeekPolicy,undefined);
  await expect(page.getByLabel('默认跳播模式',{exact:true})).toHaveValue('fast');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await desktop.evaluate(({app})=>{
   const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
   const {MpvClient}=require(app.getAppPath()+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start;
   MpvClient.prototype.start=function(...args){globalThis.__settingsMpv=this;return start.apply(this,args);};
  });
  await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__settingsRender=s));
  const state=()=>embedded?page.evaluate(()=>window.__settingsRender):page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot')).catch(()=>null);
  for(const saved of [undefined,'exact','fast']){
   if(saved)await api('/api/preferences','PATCH',{values:{mpvSeekPolicy:saved}});
   const expected=saved??'fast';
   const previous=embedded?await page.evaluate(()=>window.__settingsRender?.session??null):null;
   await page.getByRole('button',{name:'播放 Framecode',exact:true}).click();
   await expect.poll(async()=>{const s=await state();return s?.session!==previous&&s?.phase==='ready';},{timeout:30000}).toBe(true);
   assert.equal((await state()).seekPolicy,expected);
   await page.getByRole('button',{name:'跳播与播放设置',exact:true}).click();
   if(embedded){
    await expect(page.getByLabel('跳播模式',{exact:true})).toHaveValue(expected);
    const temporary=expected==='exact'?'fast':'exact';
    await page.getByLabel('跳播模式',{exact:true}).selectOption(temporary);
    await expect.poll(async()=>(await state()).seekPolicy).toBe(temporary);
    await page.getByRole('button',{name:'关闭播放设置',exact:true}).click();
   }else{
    await expect.poll(()=>desktop.evaluate(async()=>(await globalThis.__settingsMpv.command(['get_property','user-data/avhub-ui/layout'])).panel)).toBe(true);
    await expect.poll(()=>desktop.evaluate(async()=>{const state=(await globalThis.__settingsMpv.command(['get_property','user-data/avhub-ui/layout']));return state.buttons.some(b=>b.id==='seek-policy');})).toBe(true);
   }
   assert.equal((await api('/api/preferences')).values.mpvSeekPolicy,saved,'session choice cannot rewrite the default');
   await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
   await expect(page.getByRole('button',{name:'播放 Framecode',exact:true})).toBeVisible();
  }
  report.cases.push({embedded,reopens:3,default:'fast',savedExactPreserved:true,passed:true});
  await desktop.close();desktop=null;
 }
 assert.equal(hash(),before);report.completed=true;
}catch(error){report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);throw error;}
finally{try{await desktop?.close();}finally{const output=path.join(data,'report.json');writeFileSync(output,JSON.stringify(report,null,2));console.log(output);}}
