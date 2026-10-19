// Read-only real Electron benchmark: exact decoded restart, not IPC ACK latency.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,statSync,writeFileSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),index=process.argv[2],ids=process.argv.slice(3).map(Number);
assert.ok(index&&path.isAbsolute(index)&&ids.length&&ids.every(id=>Number.isSafeInteger(id)&&id>0));
mkdirSync(path.join(root,'build'),{recursive:true});const data=mkdtempSync(path.join(root,'build','native-seek-latency-'));
const cloned=spawnSync('python',['-c',`import os,sqlite3,json
from pathlib import Path
s=sqlite3.connect(Path(os.environ['SEEK_INDEX']).resolve().as_uri()+'?mode=ro',uri=True)
t=sqlite3.connect(str(Path(os.environ['SEEK_DATA'])/'library.db'));s.backup(t);s.close()
ids=json.loads(os.environ['SEEK_IDS']);t.execute('DELETE FROM media WHERE id NOT IN ('+','.join('?' for _ in ids)+')',ids)
for name in ('preferences','root_file_permissions'):t.execute('DELETE FROM '+name)
t.execute('UPDATE media SET custom_cover=NULL,progress=0,watched=0');t.commit();t.close()`],{env:{...process.env,SEEK_INDEX:index,SEEK_DATA:data,SEEK_IDS:JSON.stringify(ids)},encoding:'utf8',windowsHide:true});assert.equal(cloned.status,0,cloned.stderr);
let desktop,inspectFailure;const samples=[];
console.log('Read-only seek fixture:',data);
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1'},timeout:60000});const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await page.evaluate(async()=>{await fetch('/api/thumbnails/pause',{method:'POST'});await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{audio:{volume:0,muted:true}}})});});
 for(const id of ids){
  const media=await page.evaluate(async id=>(await(await fetch(`/api/media/${id}`)).json()),id),before=statSync(media.path);
  const {session}=await page.evaluate(id=>window.avhubDesktop.nativePlayer('open',{mediaId:id,start:0}),id),overlay=desktop.windows().find(w=>w.url().includes('nativePlayer='+session));assert.ok(overlay);
  const state=()=>overlay.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
  inspectFailure=async()=>({state:await state(),body:await overlay.locator('body').innerText(),slider:await overlay.getByRole('slider',{name:'播放进度',exact:true}).inputValue(),events:await overlay.evaluate(()=>window.__seekEvents)});
  const call=(action,value)=>overlay.evaluate(({session,action,value})=>window.avhubDesktop.nativePlayer(action,{session,value}),{session,action,value});
  let immediate=null;
  if(process.env.AVHUB_SEEK_IMMEDIATE==='1'){
   const initial=await state();console.log('Immediate seek initial phase:',initial.phase);
   try{await call('seek',90);}catch(error){writeFileSync(path.join(data,'failure.json'),JSON.stringify({kind:'immediate',initial,error:String(error),state:await state()},null,2));throw error;}
   await expect.poll(async()=>{const s=await state();return s.pendingSeek===null&&Number(s.properties['time-pos'])>=89.5&&Number(s.properties['time-pos'])<92;},{timeout:30000}).toBe(true);
   const jumped=await state();
   await expect.poll(async()=>Number((await state()).properties['time-pos']),{timeout:5000}).toBeGreaterThan(Number(jumped.properties['time-pos'])+.5);
   immediate={phaseAtRequest:initial.phase,target:90,actual:jumped.properties['time-pos'],after:(await state()).properties['time-pos'],pause:(await state()).properties.pause,pending:(await state()).pendingSeek};console.log('Immediate seek continued:',JSON.stringify(immediate));
  }
  await expect.poll(async()=>(await state()).phase,{timeout:30000}).toBe('ready');await call('pause',true);
  const results=[];
  const wait=async target=>{await expect.poll(async()=>{const s=await state();return s.pendingSeek===null&&Math.abs(Number(s.properties['time-pos'])-target)<.5;},{timeout:30000,intervals:[10,20,30,50]}).toBe(true);return state();};
  if(process.env.AVHUB_SEEK_STRESS==='1'){
   // Keep diagnostics on failure, including the final MPV position and queue.
   const failReport=async error=>{writeFileSync(path.join(data,'failure.json'),JSON.stringify({id,error:String(error),state:await state(),results},null,2));throw error;};
   try{
    for(const paused of [true,false]){
     await call('pause',paused);
     for(const target of [30,30,90,0,media.duration*.95,media.duration-.02,60,60,120,media.duration*.6,5]){
      await call('seek',target);const s=await wait(target);results.push({kind:'stress',paused,target,actual:s.properties['time-pos'],ms:s.lastSeekTotalMs,sourceLoads:s.sourceLoads});
     }
     await overlay.mouse.move(400,await overlay.evaluate(()=>innerHeight-30));
     const slider=overlay.getByRole('slider',{name:'播放进度',exact:true}),box=await slider.boundingBox();assert.ok(box);
     for(const fraction of [.2,.8,.1,.95,.4]){await overlay.mouse.click(box.x+box.width*fraction,box.y+box.height/2);await expect.poll(async()=>{const s=await state();return s.pendingSeek===null&&s.error===undefined;},{timeout:20000}).toBe(true);const s=await state();results.push({kind:'click',paused,fraction,actual:s.properties['time-pos']});}
    }
   }catch(error){await failReport(error);}
   await call('pause',true);
   await call('pause',false);await call('seek',90);
   await expect.poll(async()=>(await state()).pendingSeek,{timeout:20000}).toBe(null);
   const s=await state();await expect.poll(async()=>Number((await state()).properties['time-pos']),{timeout:5000}).toBeGreaterThan(Number(s.properties['time-pos'])+.5);
   const expected=Number((await state()).properties['time-pos']);
   await expect.poll(async()=>Number(await overlay.getByRole('slider',{name:'播放进度',exact:true}).inputValue()),{timeout:5000}).toBeGreaterThan(expected-.3);
   const timeline=overlay.getByRole('slider',{name:'播放进度',exact:true});
   await overlay.keyboard.press('Tab');await timeline.focus();await overlay.keyboard.down('ArrowRight');await timeline.evaluate(el=>el.blur());await overlay.keyboard.up('ArrowRight');
   await expect.poll(async()=>(await state()).pendingSeek,{timeout:20000}).toBe(null);
   const keyPosition=Number((await state()).properties['time-pos']);await expect.poll(async()=>Number((await state()).properties['time-pos']),{timeout:5000}).toBeGreaterThan(keyPosition+.5);
   const keyActual=Number((await state()).properties['time-pos']);await expect.poll(async()=>Number(await timeline.inputValue()),{timeout:5000}).toBeGreaterThan(keyActual-.3);
   results.push({kind:'progress-after-lost-keyup',actual:keyActual,slider:Number(await timeline.inputValue())});
   await call('pause',true);
  }
  for(let round=0;round<(process.env.AVHUB_SEEK_DRAG_ONLY==='1'?0:2);round++){
   for(const target of [5,10,5,Math.min(media.duration*.7,400),Math.min(media.duration*.7,400)-10]){
    await call('seek',target);const s=await wait(target);results.push({round,kind:'single',target,actual:s.properties['time-pos'],ms:s.lastSeekTotalMs,sourceLoads:s.sourceLoads});
   }
   const first=Math.min(media.duration*.5,300),targets=[first,first+5,first+10,first+15];
   await overlay.evaluate(async({session,targets})=>{for(const value of targets){await window.avhubDesktop.nativePlayer('seek',{session,value});await new Promise(r=>setTimeout(r,20));}},{session,targets});
   const s=await wait(targets.at(-1));results.push({round,kind:'burst',target:targets.at(-1),actual:s.properties['time-pos'],ms:s.lastSeekTotalMs,sourceLoads:s.sourceLoads});
  }
  await overlay.mouse.move(400,await overlay.evaluate(()=>innerHeight-30));
  await expect(overlay.locator('.native-controls')).toHaveCSS('opacity','1');
  await overlay.evaluate(()=>{window.__seekEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','gotpointercapture','input','change'])document.addEventListener(type,e=>{if(e.target instanceof HTMLInputElement&&e.target.getAttribute('aria-label')==='播放进度')window.__seekEvents.push({type,value:e.target.value,id:e.pointerId});},true);});
  const timeline=overlay.getByRole('slider',{name:'播放进度',exact:true}),box=await timeline.boundingBox();assert.ok(box);
  const seeksBefore=(await state()).seeks;
  await timeline.hover({position:{x:box.width*.15,y:box.height/2}});await overlay.mouse.down();
  for(const part of [.25,.45,.6,.75]){await overlay.mouse.move(box.x+box.width*part,box.y+box.height/2);await overlay.waitForTimeout(25);}
  const target=Number(await timeline.inputValue());await overlay.mouse.up();const sDrag=await wait(target);
  assert.equal(sDrag.seeks-seeksBefore,1,'pointer drag must decode only the committed final target');
  results.push({kind:'drag',target,actual:sDrag.properties['time-pos'],ms:sDrag.lastSeekTotalMs,dispatches:sDrag.seeks-seeksBefore,sourceLoads:sDrag.sourceLoads});
  const s=await state();assert.equal(s.sourceLoads,1);const shot=await call('screenshot');assert.equal(shot.width,media.width);assert.equal(shot.height,media.height);
  await page.evaluate(session=>window.avhubDesktop.nativePlayer('close',session),session);const after=statSync(media.path);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);
  samples.push({id,codec:media.video_codec,width:media.width,height:media.height,hwdec:s.properties['hwdec-current'],bufferingEvents:s.bufferingEvents,corrections:s.seekCorrections,immediate,results});console.log(JSON.stringify(samples.at(-1)));
 }
 await desktop.close();desktop=null;writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')).build_id,samples,limitations:['Warm filesystem/cache; not cold disk, HDR or display scanout latency.','MPV playback-restart plus queried actual timestamp; screenshots verify decoded full resolution.']},null,2));
}catch(error){writeFileSync(path.join(data,'failure-final.json'),JSON.stringify({error:String(error),diagnostics:await inspectFailure?.().catch(()=>null)},null,2));throw error;}finally{if(desktop)await desktop.close();}
