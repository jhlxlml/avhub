// Real Electron normal policy; generated sources, actual API/search/playback.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,copyFileSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-library-search-');
const media=path.join(workspace,'media'),profile=path.join(workspace,'profile');mkdirSync(media);
const artifact=path.join(root,'build','library-search-'+path.basename(workspace));mkdirSync(artifact,{recursive:true});
const template=path.join(workspace,'owned-template.mp4');
const encoded=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',template],{windowsHide:true,timeout:30000});
assert.equal(encoded.status,0,encoded.stderr?.toString());
const files=['Common A.mp4','Common B.mp4','Only %_ Clip.mp4','独特 测试.mp4'].map(name=>path.join(media,name));
for(const file of files)copyFileSync(template,file);
const identity=file=>({sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),mtime:statSync(file).mtimeMs});
const before=files.map(identity);
const report={passed:false,cleanExit:false,sourceUnchanged:false,build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),
    queries:[],errors:[],limitations:['Real Electron generated 320x180 12fps SDR H.264, muted. Four physical fixtures, not a 100000-video UI or real 4K/audio-device acceptance.']};
const persist=()=>writeFileSync(path.join(artifact,'acceptance.json'),JSON.stringify(report,null,2));persist();
let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:workspace,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow({timeout:50000});page.on('pageerror',error=>report.errors.push(error.message));
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 report.policy=await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();return{sandbox:w.webContents.getLastWebPreferences().sandbox,backgroundThrottling:w.webContents.getBackgroundThrottling()};});
 assert.equal(report.policy.sandbox,true);assert.equal(report.policy.backgroundThrottling,true);
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 report.sqlite=(await api('/api/diagnostics')).sqlite_runtime;assert.equal(report.sqlite.verified,true);
 await api('/api/preferences','PATCH',{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,hoverPreview:false,audio:{volume:0,muted:true}}});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await expect.poll(async()=>{const t=await api('/api/thumbnails');return t.pending===0&&t.current===null;},{timeout:30000}).toBe(true);
 await page.reload();await expect(page.locator('.card')).toHaveCount(4);
 await page.getByRole('button',{name:'搜索视频',exact:true}).click();const search=page.getByRole('textbox',{name:'搜索视频',exact:true});
 async function query(text,count){
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/media'&&new URL(r.url()).searchParams.get('q')===text);
  await search.fill(text);const r=await response;assert.ok(r.ok());const body=await r.json();
  assert.equal(body.total,count);await expect(page.locator('.card')).toHaveCount(count);
  report.queries.push({query:text,total:body.total,ids:body.items.map(r=>r.id)});persist();return body;
 }
 await query('not-a-matching-title',0);await query('Common',2);await query('独特',1);
 const result=await query('%_',1);assert.equal(result.items[0].name,'Only %_ Clip.mp4');
 // Rapidly replaced input must settle on the active query, not a stale result.
 await search.fill('Common');await search.fill('no-longer-active');await search.fill('测试');
 await expect(page.getByRole('button',{name:'播放 独特 测试',exact:true})).toBeVisible();await expect(page.locator('.card')).toHaveCount(1);
 const last=await query('Only',1);const item=last.items[0];
 await page.getByRole('button',{name:'播放 '+item.title,exact:true}).click();const video=page.locator('.player-shell video');
 await expect.poll(()=>video.evaluate(v=>v.readyState>=2&&!v.paused&&v.currentTime>0&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:30000}).toBe(true);
 const first=await video.evaluate(v=>{window.__searchReloads=0;v.addEventListener('loadstart',()=>window.__searchReloads++);return {source:v.currentSrc,frames:v.getVideoPlaybackQuality().totalVideoFrames};});
 await expect.poll(()=>video.evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(first.frames+6);
 await video.evaluate(v=>v.pause());
 report.playback=await video.evaluate(v=>({source:v.currentSrc,frames:v.getVideoPlaybackQuality().totalVideoFrames,reloads:window.__searchReloads,dropped:v.getVideoPlaybackQuality().droppedVideoFrames,time:v.currentTime}));
 assert.equal(report.playback.source,first.source);assert.equal(report.playback.reloads,0);
 assert.ok(report.playback.source.endsWith(`/media/${item.id}/file`));
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.player-shell')).toHaveCount(0);
 assert.ok((await api(`/api/media/${item.id}`)).progress>0);await expect(page.locator('.card')).toHaveCount(1);
 assert.deepEqual(report.errors,[]);
 const done=desktop.waitForEvent('close',{timeout:25000});await desktop.evaluate(({app})=>app.quit());await done;desktop=null;
 report.cleanExit=true;assert.deepEqual(files.map(identity),before);report.sourceUnchanged=true;report.passed=true;
}catch(error){report.errors.push(String(error));await page?.screenshot({path:path.join(artifact,'failure.png')}).catch(()=>{});throw error;}
finally{if(desktop)await desktop.close().catch(error=>report.errors.push(String(error)));persist();console.log('Real Electron search evidence:',path.join(artifact,'acceptance.json'));}
