// Real Electron UI with injected transport failures and generated owned media.
// Not a real OS/network outage or a benchmark of the deferred video.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-route-recovery-'),media=path.join(workspace,'media');mkdirSync(media);
const artifact=path.join(root,'build','route-recovery-'+path.basename(workspace));mkdirSync(artifact,{recursive:true});
const source=path.join(media,'Owned route.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','60','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',source],{windowsHide:true,timeout:30000}).status,0);
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();let desktop,page;const errors=[];
const acceptance={passed:false,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),sourceUnchanged:false,reloads:null,errors,diagnosticSchema:null,limitations:['Injected read failures in real Electron; generated SDR MP4 only. Not an actual network outage or all-media performance acceptance.']};
const started=performance.now();
try{
 desktop=await _electron.launch({args:[root],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:path.join(workspace,'profile'),AVHUB_APP_HOME:workspace,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 // The desktop's existing backend startup deadline is 45s; do not let the
 // firstWindow helper's implicit 30s deadline terminate that earlier. Record
 // actual startup time rather than treating this bound as a speed target.
 page=await desktop.firstWindow({timeout:50000});page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 acceptance.startupMs=Math.round(performance.now()-started);
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value;},{url,method,body});
 await api('/api/preferences','PATCH',{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 const item=(await api('/api/media?page=1')).items[0];let fail=true,reads=0;
 await page.route(`**/api/media/${item.id}`,route=>{reads++;return fail?route.fulfill({status:503,json:{detail:'隔离测试：本地服务暂忙'}}):route.continue();});
 await page.goto(new URL('/?video='+item.id,page.url()).href);
 const recovery=page.getByRole('region',{name:'播放页恢复失败'});
 await expect(recovery).toContainText('本地服务暂忙');assert.equal(reads,3);await expect(page).toHaveURL(new RegExp('video='+item.id));
 await recovery.screenshot({path:path.join(artifact,'recovery-dark.png')});
 fail=false;await recovery.getByRole('button',{name:'重试打开视频'}).click();
 const video=page.locator('.player-shell video');await expect.poll(()=>video.evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames),{timeout:30000}).toBeGreaterThan(0);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();fail=true;
 await page.getByRole('button',{name:'播放 '+item.title,exact:true}).click();
 await expect(recovery).toHaveClass(/is-inline/);await expect.poll(()=>video.evaluate(v=>v.readyState>=2),{timeout:30000}).toBe(true);
 const retained=await video.evaluate(v=>{v.dataset.recoveryIdentity='retained';window.__recoveryReloads=0;v.addEventListener('emptied',()=>window.__recoveryReloads++);return v.currentSrc;});
 fail=false;await recovery.getByRole('button',{name:'重试打开视频'}).click();await expect(recovery).toHaveCount(0);
 await expect(video).toHaveAttribute('data-recovery-identity','retained');assert.equal(await video.evaluate(v=>v.currentSrc),retained);
 assert.equal(await page.evaluate(()=>window.__recoveryReloads),0);
 const saved=path.join(workspace,'playback-diagnostic.json');
 await desktop.evaluate(({dialog},saved)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});},saved);
 await page.locator('.playback-diagnostics summary').click();await page.getByRole('button',{name:'采集并导出播放诊断（8 秒）',exact:true}).click();
 await expect(page.getByText('播放诊断已保存',{exact:true})).toBeVisible({timeout:20000});
 const report=JSON.parse(readFileSync(saved,'utf8'));assert.equal(report.schema,2);assert.equal(report.delivery.status,'observed');assert.ok(report.summary.observations.length>=4);
 assert.ok(!JSON.stringify(report).includes(source));assert.equal(await video.evaluate(v=>v.currentSrc),retained);assert.equal(hash(),before);assert.deepEqual(errors,[]);
 await desktop.close();desktop=null;
 Object.assign(acceptance,{passed:true,reloads:0,diagnosticSchema:report.schema});
 console.log('Real Electron route recovery and diagnostic export passed:',artifact);
}catch(error){errors.push(String(error));await page?.screenshot({path:path.join(artifact,'failure.png')}).catch(()=>{});throw error;}
finally{acceptance.sourceUnchanged=hash()===before;if(desktop)await desktop.close().catch(error=>{acceptance.passed=false;errors.push(String(error));});writeFileSync(path.join(artifact,'acceptance.json'),JSON.stringify(acceptance,null,2));}
