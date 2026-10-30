// Real Electron + native MPV, generated media only. IPC drives theme changes;
// this does not claim physical pointer, HDR or playback-performance acceptance.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build','native-theme-')),media=path.join(data,'media');mkdirSync(media);
const source=path.join(media,'Theme.mp4'),{nativeThemeColors}=createRequire(import.meta.url)('../dist/nativeTheme.js');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','30','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true,timeout:30000}).status,0);
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();let app;
console.log('Native theme fixture:',data);
try{
 const env={...process.env,AVHUB_APP_HOME:data,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 app=await _electron.launch({args:[root],cwd:data,env,timeout:60000});const page=await app.firstWindow();
 await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await app.evaluate((_,root)=>{const require=process.getBuiltinModule('module').createRequire(root+'/package.json'),{MpvClient}=require(root+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start;globalThis.loads=0;MpvClient.prototype.start=function(...args){globalThis.client=this;globalThis.loads++;return start.apply(this,args);};},root);
 const api=(route,body)=>page.evaluate(async({route,body})=>{const r=await fetch(route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assertOk(r);return r.json();function assertOk(r){if(!r.ok)throw new Error('API '+r.status);}}, {route,body});
 const appearance={theme:'light',coverSize:'standard',palette:'teal',accent:'#178c7a',background:'cool',emphasis:'soft'};
 await page.evaluate(async appearance=>{const r=await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{appearance,playerEngine:'mpv',mpvWindowMode:'independent',autoNext:false,resumeBehavior:'restart',audio:{volume:0,muted:true}}})});if(!r.ok)throw new Error('Preferences '+r.status);},appearance);
 await api('/api/roots',{path:media});await api('/api/scan',{});await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 await page.reload();await page.getByRole('button',{name:'播放 Theme',exact:true}).click();
 await expect(page.getByText('MPV · 独立窗口播放原文件',{exact:true})).toBeVisible({timeout:30000});
 const snapshot=()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
 const command=c=>app.evaluate(async(_,c)=>globalThis.client.command(c),c);
 await expect.poll(async()=>{const s=await snapshot();return s.phase==='ready'&&s.properties['time-pos']>.05;},{timeout:30000}).toBe(true);
 const first=await snapshot();assert.deepEqual((await command(['get_property','user-data/avhub-ui/theme'])).colors,nativeThemeColors(appearance));
 const apply=next=>page.evaluate(({session,appearance})=>window.avhubDesktop.nativePlayer('appearance',{session,appearance}),{session:first.session,appearance:next});
 for(const palette of ['violet','blue','teal','amber','graphite','custom']){
  const next={palette,accent:'#b24d7a',background:'warm',emphasis:'standard'};await apply(next);
  await expect.poll(async()=>(await command(['get_property','user-data/avhub-ui/theme'])).colors).toEqual(nativeThemeColors(next));
 }
 await command(['set_property','pause',true]);await expect.poll(async()=>(await snapshot()).properties.pause).toBe(true);
 const paused=await snapshot(),restored={palette:appearance.palette,accent:appearance.accent,background:appearance.background,emphasis:appearance.emphasis};await apply(restored);
 assert.deepEqual((await command(['get_property','user-data/avhub-ui/theme'])).colors,nativeThemeColors(appearance));
 await assert.rejects(()=>apply({...restored,accent:'url(x)'}));
 await command(['script-message-to','avhub_ui','theme','{"accent":"red"}']);
 assert.deepEqual((await command(['get_property','user-data/avhub-ui/theme'])).colors,nativeThemeColors(appearance));
 const after=await snapshot();assert.equal(after.seeks,first.seeks);assert.equal(after.restarts,first.restarts);assert.equal(after.properties['time-pos'],paused.properties['time-pos']);assert.equal(after.properties['video-params'].w,640);assert.equal(await app.evaluate(()=>globalThis.loads),1);
 await command(['script-message-to','avhub_ui','theme',JSON.stringify(nativeThemeColors({...restored,palette:'custom',accent:'#b24d7a'}))]);
 await command(['mouse',20,20]);await command(['screenshot-to-file',path.join(data,'native-controls.png'),'window']);
 await app.close();app=null;assert.equal(hash(),before);
 writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({completed:true,realElectron:true,nativeMpv:true,palettes:6,pausedRestore:true,rejectedInvalidColors:true,sourceLoads:1,noSeekOrRestart:true,originalResolution:'640x360',sourceUnchanged:true,cleanExit:true,limitations:'Generated SDR clip; IPC-driven themes, no physical input or performance claim.'},null,2));console.log('Native theme acceptance passed:',data);
}finally{if(app)await app.close().catch(()=>{});}
