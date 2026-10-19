// Real Electron application flow. Playback intents come from library/overlay UI,
// never from privileged native open/seek calls. Synthetic media by default;
// optional arguments: read-only-index absolute path, media ID. Always isolated data.
// Renderer input automation does not establish OS keyboard focus or mixed-DPI acceptance.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const index=process.argv[2],id=Number(process.argv[3]);
if(index)assert.ok(path.isAbsolute(index)&&Number.isSafeInteger(id)&&id>0);
mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','native-app-flow-')),media=path.join(data,'media');mkdirSync(media);
let sources=[];
if(index){
 const clone=spawnSync('python',['-c',`import os,sqlite3,json
from pathlib import Path
s=sqlite3.connect(Path(os.environ['FLOW_INDEX']).resolve().as_uri()+'?mode=ro',uri=True)
t=sqlite3.connect(str(Path(os.environ['FLOW_DATA'])/'library.db'));s.backup(t);s.close()
t.execute('DELETE FROM media WHERE id<>?',(int(os.environ['FLOW_ID']),))
for name in ('preferences','root_file_permissions'):t.execute('DELETE FROM '+name)
t.execute('UPDATE media SET custom_cover=NULL,progress=0,watched=0')
print(json.dumps([r[0] for r in t.execute('SELECT path FROM media')]))
t.commit();t.close()`],{env:{...process.env,FLOW_INDEX:index,FLOW_DATA:data,FLOW_ID:String(id)},encoding:'utf8',windowsHide:true});
 assert.equal(clone.status,0,clone.stderr);sources=JSON.parse(clone.stdout);assert.equal(sources.length,1);
}else{
 sources=['A.mp4','B.mp4'].map(name=>path.join(media,name));
 for(const file of sources)assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','16','-c:v','libx264','-g','50','-pix_fmt','yuv420p',file],{windowsHide:true,timeout:30000}).status,0);
}
const identities=()=>sources.map(file=>({hash:createHash('sha256').update(readFileSync(file)).digest('hex'),mtime:statSync(file).mtimeMs}));
const before=identities();let desktop;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 if(!index){await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');}
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',resumeBehavior:'restart',autoNext:true,queueScope:'directory',queueMode:'sequential',audio:{volume:0,muted:true}}});
 await page.reload();await (index?page.locator('.open-video').first():page.getByRole('button',{name:'播放 A',exact:true})).click();
 await expect(page.getByText('MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:30000});
 let overlay=desktop.windows().find(w=>w.url().includes('nativePlayer='));assert.ok(overlay);
 const snapshot=()=>overlay.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
 await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:20000}).toBeGreaterThan(.1);
 const first=await snapshot();
 const length=Number(first.properties.duration);assert.ok(length>14);
 const reveal=async()=>{await overlay.bringToFront();await overlay.mouse.move(200,100);await overlay.mouse.move(100,(await overlay.evaluate(()=>innerHeight))-30);};
 await reveal();await overlay.getByRole('button',{name:'暂停',exact:true}).click();
 await expect.poll(async()=>(await snapshot()).properties.pause).toBe(true);
 const paused=Number((await snapshot()).properties['time-pos']);
 await overlay.keyboard.press('ArrowRight');await overlay.keyboard.press('ArrowRight');
 await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:20000}).toBe(null);
 await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:20000}).toBeGreaterThan(paused+9.4);
 const relative=await snapshot();assert.equal(relative.sourceLoads,1);
 // The library renderer forwards playback keys too; do not require focus to
 // remain forever in the separate transparent controls WebContents.
 await page.locator('.player-top>span').click();await page.keyboard.press('ArrowLeft');
 await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:20000}).toBe(null);
 await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:20000}).toBeLessThan(Number(relative.properties['time-pos'])-4.4);
 const slider=overlay.getByRole('slider',{name:'播放进度',exact:true});
 await slider.evaluate(element=>element.addEventListener('input',()=>{window.__selectedNativeTime=Number(element.value);}));
 const clickFraction=async fraction=>{await reveal();const box=await slider.boundingBox();assert.ok(box);await slider.click({position:{x:Math.max(1,Math.min(box.width-1,box.width*fraction)),y:box.height/2}});return overlay.evaluate(()=>window.__selectedNativeTime);};
 // Paused near-end navigation must not start the next media item.
 await clickFraction(.9999);await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:20000}).toBe(null);
 assert.equal((await snapshot()).session,first.session);assert.equal((await snapshot()).properties.pause,true);
 const selected=await clickFraction(.25);await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:20000}).toBe(null);
 // Browser range thumbs have an inset; compare the actual UI input target,
 // not the fraction of the outer CSS box (inaccurate for long media).
 const target=Number((await snapshot()).properties['time-pos']);assert.ok(Math.abs(target-selected)<.5,JSON.stringify({selected,target,length}));
 await reveal();await overlay.getByRole('button',{name:'播放',exact:true}).click();
 await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:10000}).toBeGreaterThan(target+.6);
 assert.equal((await snapshot()).sourceLoads,1);
 // Natural EOF, reached through real playback, advances via the application queue.
 if(!index){await clickFraction(.86);await expect.poll(async()=>(await snapshot()).pendingSeek,{timeout:20000}).toBe(null);
 await expect.poll(()=>desktop.windows().some(w=>w.url().includes('nativePlayer=')&&w!==overlay),{timeout:20000}).toBe(true);
 overlay=desktop.windows().find(w=>w.url().includes('nativePlayer='));
 await expect.poll(async()=>(await snapshot()).title,{timeout:20000}).toMatch(/^B(?:\.mp4)?$/);}
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(index?1:2);
 assert.equal((await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active,false);
 assert.deepEqual(identities(),before);
 writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({sample:index?'real-read-only':'synthetic',libraryEntry:true,uiRelativeSeek:true,relativeTarget:Number(relative.properties['time-pos']),pausedEndNoAutoplay:true,clockAdvancesAfterSeek:true,naturalEndAutoplay:index?'not-tested':true,sourceLoads:1,sourceUnchanged:true},null,2));
 console.log('Application native playback flow passed:',data);
}catch(error){
 if(desktop){writeFileSync(path.join(data,'failure.json'),JSON.stringify(await Promise.all(desktop.windows().map(async p=>({url:p.url(),body:await p.locator('body').innerText().catch(()=>'<closed>')}))),null,2));await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});}
 throw error;
}finally{if(desktop)await desktop.close().catch(()=>{});}
