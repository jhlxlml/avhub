// Real packaged app. Settings/UI drive both MPV presentations; no runtime,
// coordinator or playback API implementation is mocked or replaced.
import {desktopTestSubject} from './desktop-test-subject.mjs';
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),exe=process.env.AVHUB_TEST_PACKAGED_EXE;
assert.ok(exe&&path.isAbsolute(exe),'Actual packaged EXE required');
const data=mkdtempSync(path.join(root,'build/mpv-window-coexistence-')),media=path.join(data,'media');mkdirSync(media);
const source=path.join(media,'Modes.mp4');copyFileSync(path.join(root,'build/libmpv-render-spike/samples/Framecode-v2-640x360.mp4'),source);
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();
const packagedRuntime=path.join(path.dirname(exe),'resources/mpv/mpv.exe');
const runtimeHash=createHash('sha256').update(readFileSync(packagedRuntime)).digest('hex');
const report={runtimeExeSha256:runtimeHash,kind:'actual-packaged-independent-render-preference-coexistence',passed:false,phases:[]};
let desktop,page;
const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{
 const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw new Error(await r.text());return r.json();
},{url,method,body});
const launch=async()=>{
 desktop=await _electron.launch({executablePath:exe,args:[],cwd:data,
  env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_RENDER_LOCAL_ACCEPTANCE:'',AVHUB_RENDER_RUNTIME_CANDIDATE:'',AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const subject=await desktopTestSubject(desktop,import.meta.url);if(report.subject)assert.deepEqual(subject,report.subject);else report.subject=subject;
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
};
const settings=async()=>{await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();};
const closeSettings=()=>page.getByRole('button',{name:'关闭设置',exact:true}).click();
const openIndependent=async()=>{
 await page.getByRole('button',{name:'播放 Modes',exact:true}).click();
 await expect(page.getByText('MPV · 独立窗口播放原文件',{exact:true})).toBeVisible({timeout:30000});
 await expect.poll(async()=>Number((await page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'))).properties['time-pos']),{timeout:20000}).toBeGreaterThan(.1);
 const state=await page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));assert.equal(state.presentation,'independent');
 report.phases.push({presentation:state.presentation,sourceLoads:state.sourceLoads});
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
};
try{
 await launch();
 const engines=await page.evaluate(async()=>({window:await window.avhubDesktop.nativePlayer('status'),render:await window.avhubDesktop.renderPlayer('status')}));
 assert.equal(engines.window.available,true);assert.equal(engines.render.available,true);report.engines=engines;
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await api('/api/preferences','PATCH',{values:{resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await settings();await page.getByLabel('默认播放引擎',{exact:true}).selectOption('mpv');
 await page.getByLabel('MPV 播放窗口',{exact:true}).selectOption('independent');
 await expect.poll(async()=>(await api('/api/preferences')).values.mpvWindowMode).toBe('independent');await closeSettings();
 await openIndependent();
 await settings();await page.getByLabel('D3D11 原生嵌入（试验）',{exact:true}).click();
 await expect.poll(async()=>(await api('/api/preferences')).values.nativeRenderEnabled).toBe(true);
 await expect(page.getByLabel('D3D11 原生嵌入（试验）',{exact:true})).toBeChecked();await closeSettings();
 await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__coexistRender=s));
 await page.getByRole('button',{name:'播放 Modes',exact:true}).click();
 await expect(page.locator('.native-render-canvas')).toBeVisible({timeout:30000});
 await expect.poll(()=>page.evaluate(()=>window.__coexistRender?.transport?.gpuCompletions??0),{timeout:20000}).toBeGreaterThan(2);
 report.phases.push({presentation:'render',gpuCompletions:await page.evaluate(()=>window.__coexistRender.transport.gpuCompletions)});
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await settings();await page.getByLabel('D3D11 原生嵌入（试验）',{exact:true}).click();
 await expect(page.getByLabel('MPV 播放窗口',{exact:true})).toHaveValue('independent');
 await expect.poll(async()=>(await api('/api/preferences')).values.nativeRenderEnabled).toBe(false);await closeSettings();
 await desktop.close();desktop=undefined;await launch();
 const prefs=(await api('/api/preferences')).values;
 assert.equal(prefs.playerEngine,'mpv');assert.equal(prefs.mpvWindowMode,'independent');assert.equal(prefs.nativeRenderEnabled,false);
 report.preferencesAfterRestart={engine:prefs.playerEngine,window:prefs.mpvWindowMode,render:prefs.nativeRenderEnabled};
 await openIndependent();assert.equal(hash(),before);report.sourceUnchanged=true;
 // Close immediately after clicking Back to exercise the native close/quit race.
 await desktop.close();desktop=undefined;report.cleanExit=true;report.passed=true;
}catch(error){report.error=String(error.stack||error);if(page)report.body=await page.locator('body').innerText().catch(()=>'<closed>');
 // Failed settings tests can leave an intentional unsaved-changes dialog.
 // Capture the failure before ending only this isolated test application.
 writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));
 if(desktop)await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});throw error;}
finally{if(desktop)await desktop.close();writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(data,'report.json')}));}
