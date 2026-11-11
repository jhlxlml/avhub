// Actual Electron/Lua controls and screenshot pixels; injected pointer, not OS input.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {generateTestMedia,mediaHash} from './media-pool.mjs';
import {playbackFixture} from './playback-fixtures.mjs';
const root=path.resolve(import.meta.dirname,'../..'),data=fs.mkdtempSync(path.join(root,'build/independent-tracks-')),media=path.join(data,'media');fs.mkdirSync(media);
const srt=path.join(data,'embedded.srt');fs.writeFileSync(srt,'1\n00:00:00,000 --> 00:00:06,000\nAVHub subtitle acceptance\n');
const movie=path.join(media,'Tracks.mkv');generateTestMedia(['-v','error','-i',playbackFixture('basic'),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-i',srt,'-map','0:v:0','-map','1:a:0','-map','2:a:0','-map','3:s:0','-c:v','copy','-c:a','aac','-c:s','srt','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=zho','-t','6',movie]);
const before=mediaHash(movie),report={kind:'real-Electron-independent-audio-subtitle-controls',candidate:process.env.AVHUB_MPV_RUNTIME_CANDIDATE,build:JSON.parse(fs.readFileSync(path.join(root,'app/build-info.json'),'utf8')),scope:'Owned video stream-copy fixture; generated AAC sine tracks; Lua pointer injection isolated from physical pointer, not performance evidence',passed:false};let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app})=>{const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{MpvClient}=require(app.getAppPath()+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start;MpvClient.prototype.start=function(...args){globalThis.__trackClient=this;args[4]=[...(args[4]??[]),'--input-cursor=no'];return start.apply(this,args);};});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json();},{url,method,body});
 const command=value=>desktop.evaluate(async(_,value)=>globalThis.__trackClient.command(value),value);
 const snapshot=()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot')).catch(error=>{if(String(error).includes('原生播放窗口已关闭'))return null;throw error;});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await api('/api/thumbnails/pause','POST');await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',mpvWindowMode:'independent',nativeRenderEnabled:false,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.getByRole('button',{name:'播放 Tracks',exact:true}).click();await expect.poll(async()=>(await snapshot())?.phase,{timeout:30000}).toBe('ready');await command(['set_property','pause',true]);
 const tracks=await command(['get_property','track-list']),audio=tracks.filter(t=>t.type==='audio'),subtitle=tracks.find(t=>t.type==='sub');assert.equal(audio.length,2);assert.ok(subtitle);report.tracks=tracks.map(({type,id,lang})=>({type,id,lang}));
 const click=async id=>{const ui=await command(['get_property','user-data/avhub-ui/layout']),b=ui.buttons.find(b=>b.id===id);assert.ok(b,id);const x=Math.round((b.x+b.w/2)*ui.scale),y=Math.round((b.y+b.h/2)*ui.scale);await command(['mouse',x,y]);await command(['mouse',x,y,0,'single']);};
 await command(['script-message-to','avhub_ui','show-settings']);await expect.poll(async()=>(await command(['get_property','user-data/avhub-ui/layout'])).panel).toBe(true);
 if(await command(['get_property','aid'])!==audio[1].id)await click('audio');await expect.poll(()=>command(['get_property','aid'])).toBe(audio[1].id);
 for(let attempt=0;attempt<2&&await command(['get_property','sid'])!==subtitle.id;attempt++){
  const previous=await command(['get_property','sid']);await click('subtitle');
  await expect.poll(()=>command(['get_property','sid'])).not.toBe(previous);
 }
 await expect.poll(()=>command(['get_property','sid'])).toBe(subtitle.id);
 const session=(await snapshot()).session;await page.evaluate(session=>window.avhubDesktop.nativePlayer('seek-policy',{session,value:'exact'}),session);await page.evaluate(session=>window.avhubDesktop.nativePlayer('seek',{session,value:1.72,inputAt:Date.now()}),session);
 await expect.poll(async()=>{const s=await snapshot();return s.pendingSeek===null&&s.seekDiagnostics?.target===1.72;}).toBe(true);await expect.poll(()=>command(['get_property','sub-text'])).toContain('AVHub subtitle acceptance');
 const video=path.join(data,'without-subtitles.png'),withSubs=path.join(data,'with-subtitles.png');await command(['screenshot-to-file',video,'video']);await command(['screenshot-to-file',withSubs,'subtitles']);
 report.subtitlePixels=await desktop.evaluate(({nativeImage},{video,withSubs})=>{const a=nativeImage.createFromPath(video),b=nativeImage.createFromPath(withSubs),left=a.toBitmap(),right=b.toBitmap();let changed=0;for(let i=0;i<left.length;i+=4)if(left[i]!==right[i]||left[i+1]!==right[i+1]||left[i+2]!==right[i+2])changed++;return {video:a.getSize(),subtitles:b.getSize(),changed};},{video,withSubs});assert.deepEqual(report.subtitlePixels.video,report.subtitlePixels.subtitles);assert.ok(report.subtitlePixels.changed>50);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active).toBe(false);
 await page.getByRole('button',{name:'播放 Tracks',exact:true}).click();await expect.poll(async()=>(await snapshot())?.phase,{timeout:30000}).toBe('ready');await expect.poll(()=>command(['get_property','aid'])).toBe(audio[1].id);await expect.poll(()=>command(['get_property','sid'])).toBe(subtitle.id);report.selectionRestored=true;assert.equal((await snapshot()).sourceLoads,1);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'))).active).toBe(false);assert.equal(mediaHash(movie),before);report.sourceUnchanged=true;report.passed=true;
}catch(error){report.error=String(error.stack??error);report.last=await desktop?.evaluate(()=>globalThis.__trackClient?.snapshot).catch(()=>null);throw error;}
finally{await desktop?.close();fs.writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}
