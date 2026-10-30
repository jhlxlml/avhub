// Real Electron development settings regression; not a packaged-app test.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/render-settings-status-'));
const report={kind:'real-electron-render-settings-status-development',passed:false};let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await page.evaluate(async()=>{const r=await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{playerEngine:'mpv',nativeRenderEnabled:true}})});if(!r.ok)throw new Error(await r.text());});
 await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 const section=page.getByRole('region',{name:'播放引擎设置',exact:true});
 await expect(section.getByText('D3D11 验收运行库已检测到',{exact:true})).toBeVisible();
 await expect(section.getByText('MPV 运行库已验证',{exact:true})).toHaveCount(0);
 const toggle=section.getByRole('checkbox',{name:'D3D11 原生嵌入（SDR 试验）',exact:true});
 const offSaved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/preferences'&&r.request().method()==='PATCH');
 await toggle.click();assert.equal((await offSaved).ok(),true);await expect(toggle).not.toBeChecked();
 await expect(section.getByText('D3D11 验收运行库已检测到',{exact:true})).toHaveCount(0);
 const onSaved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/preferences'&&r.request().method()==='PATCH');
 await toggle.click();assert.equal((await onSaved).ok(),true);await expect(toggle).toBeChecked();
 await expect(section.getByText('D3D11 验收运行库已检测到',{exact:true})).toBeVisible();
 const preferences=await page.evaluate(async()=>{const r=await fetch('/api/preferences');return r.json();});
 assert.equal(preferences.values.playerEngine,'mpv');assert.equal(preferences.values.nativeRenderEnabled,true);report.passed=true;
}catch(error){report.error=String(error.stack||error);throw error;}
finally{
 writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));
 if(page&&!page.isClosed()){
  const close=page.getByRole('button',{name:'关闭设置',exact:true});
  if(await close.count()){await close.click();await expect(close).toHaveCount(0);}
 }
 if(desktop)await desktop.close();report.cleanupCompleted=true;
 writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(data,'report.json')}));
}
