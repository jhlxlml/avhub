// Actual packaged Electron policy and missing-resource checks. Only this owned
// acceptance package is changed temporarily, and every file is restored.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,renameSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),exe=path.resolve(process.env.AVHUB_TEST_PACKAGED_EXE||'');
assert.match(path.relative(root,exe),/^build[\\/](?:native-render-acceptance-[A-Za-z0-9]{6}|m5-final-sdr-\d{8}(?:-color|-compatible)?)[\\/]win-unpacked[\\/]AVHub\.exe$/);
const resources=path.join(path.dirname(exe),'resources'),folder=mkdtempSync(path.join(root,'build/render-packaged-policy-'));
const report={kind:'real-packaged-electron-admission-and-missing-resources',passed:false,cases:[]};
try{
 for(const mode of ['default','missing-marker','missing-dll']){
  const data=path.join(folder,mode);mkdirSync(data);
  const changed=mode==='default'?null:path.join(resources,mode==='missing-marker'?'local-render-acceptance.json':'native-render/libmpv-2.dll');
  const parked=changed&&changed+'.acceptance-test-held';if(changed){assert.ok(existsSync(changed));assert.equal(existsSync(parked),false);renameSync(changed,parked);}
  let desktop,page;const result={mode,passed:false};report.cases.push(result);
  try{
   desktop=await _electron.launch({executablePath:exe,args:[],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_RENDER_RUNTIME_CANDIDATE:'render-replayed-candidate-Aa7Otl',AVHUB_RENDER_LOCAL_ACCEPTANCE:mode==='default'?'':'1',AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
   page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
   assert.equal(await desktop.evaluate(({app})=>app.isPackaged),true);
   result.status=await page.evaluate(async()=>{try{return await window.avhubDesktop.renderPlayer('status');}catch(error){return {error:String(error)};}});
   if(mode==='missing-marker')assert.match(result.status.error,/缺少本地原生验收标记/);
   else{assert.equal(result.status.available,false);assert.equal(result.status.packaged,true);}
   if(mode==='default'){
    result.attach=await page.evaluate(async()=>{try{await window.avhubDesktop.renderPlayer('attach','avhub-render-00000000-0000-4000-8000-000000000000');return 'unexpected-success';}catch(error){return String(error);}});
    assert.match(result.attach,/尚未完成发行验收/);
    const media=path.join(data,'media');mkdirSync(media);copyFileSync(path.join(root,'build/libmpv-render-spike/samples/Framecode-v2-640x360.mp4'),path.join(media,'Framecode.mp4'));
    await page.evaluate(async media=>{for(const [url,body] of [['/api/roots',{path:media}],['/api/scan',undefined]]){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());}},media);
    await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/scan')).json()).state),{timeout:30000}).toBe('completed');
    await page.reload();await page.getByRole('button',{name:'播放 Framecode',exact:true}).click();
    await expect.poll(()=>page.locator('video').evaluate(video=>video.getVideoPlaybackQuality().totalVideoFrames),{timeout:20000}).toBeGreaterThan(2);
    result.existingPlayerDecoded=true;await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
   }else{
    await page.evaluate(async()=>{const r=await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{playerEngine:'mpv',nativeRenderEnabled:true}})});if(!r.ok)throw new Error(await r.text());});
    await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
    const section=page.getByRole('region',{name:'播放引擎设置',exact:true});result.settings=await section.innerText();
    await expect(section.getByText('D3D11 验收运行库已检测到',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
   }
   result.passed=true;
  }finally{
   writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));
   if(changed&&existsSync(parked))renameSync(parked,changed);
   if(desktop)await desktop.close();
   result.cleanupCompleted=true;
  }
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);throw error;}
finally{writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(folder,'report.json')}));}
