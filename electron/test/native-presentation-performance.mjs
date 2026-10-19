// Matched-command comparison inside real Electron, not standalone mpv.
// UI opens/closes media; test-only main hook issues identical exact property
// seeks in both modes. Not physical controls, cold disk or photon latency.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),index=process.argv[2],ids=process.argv.slice(3).map(Number);
assert.ok(index&&path.isAbsolute(index)&&ids.length&&ids.every(v=>Number.isSafeInteger(v)&&v>0));
mkdirSync(path.join(root,'build'),{recursive:true});const data=mkdtempSync(path.join(root,'build','native-presentation-performance-'));
const cloned=spawnSync('python',['-c',`import os,sqlite3,json
from pathlib import Path
s=sqlite3.connect(Path(os.environ['PERF_INDEX']).resolve().as_uri()+'?mode=ro',uri=True)
t=sqlite3.connect(str(Path(os.environ['PERF_DATA'])/'library.db'));s.backup(t);s.close()
ids=json.loads(os.environ['PERF_IDS']);t.execute('DELETE FROM media WHERE id NOT IN ('+','.join('?' for _ in ids)+')',ids)
for name in ('preferences','root_file_permissions'):t.execute('DELETE FROM '+name)
t.execute('UPDATE media SET custom_cover=NULL,progress=0,watched=0');t.commit();t.close()`],{env:{...process.env,PERF_INDEX:index,PERF_DATA:data,PERF_IDS:JSON.stringify(ids)},encoding:'utf8',windowsHide:true});assert.equal(cloned.status,0,cloned.stderr);
let desktop;const samples=[];console.log('Presentation comparison:',data);
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate((_,{root,data,logs})=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json'),path=require('node:path');
  const {MpvClient}=require(root+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start,message=MpvClient.prototype.message;
  globalThis.__presentationTrace=[];
  MpvClient.prototype.message=function(value){
   if(['start-file','file-loaded','end-file','playback-restart','shutdown'].includes(value.event)||value.event==='property-change'&&['video-params','pause','current-ao'].includes(value.name)){
    const event={session:this.session,stage:this.startupStage,event:value.event,name:value.name,reason:value.reason,fileError:value.file_error,error:value.error,ms:performance.now(),phase:this.snapshot.phase};
    globalThis.__presentationTrace.push(event);if(globalThis.__presentationTrace.length>120)globalThis.__presentationTrace.shift();
   }
   return message.call(this,value);
  };
  MpvClient.prototype.start=function(...args){
   globalThis.__presentationClient=this;
   // Test-owned opt-in diagnostics only; raw decoder logs can contain paths.
   // Never enable this through production preferences or publish these logs.
   if(logs)args[4]=[...(args[4]||[]),`--log-file=${path.join(data,'decoder-'+this.session+'.log')}`];
   return start.apply(this,args);
  };
 },{root,data,logs:process.env.AVHUB_NATIVE_TEST_LOG==='1'});
 const command=c=>desktop.evaluate(async(_,c)=>globalThis.__presentationClient.command(c),c);
 const snapshot=()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await api('/api/thumbnails/pause','POST');await page.reload();
 for(const id of ids){const media=await api(`/api/media/${id}`),before=statSync(media.path);
  // Alternate order to reduce warm-cache/order bias; no cache flushing.
  for(let cycle=0;cycle<3;cycle++)for(const mode of cycle%2?['independent','embedded']:['embedded','independent']){
   await api('/api/preferences','PATCH',{values:{mpvWindowMode:mode}});await page.reload();
   const opened=performance.now();await page.getByRole('button',{name:`播放 ${media.title}`,exact:true}).click();
   await expect(page.getByText(mode==='independent'?'MPV · 独立窗口播放原文件':'MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:30000});
   await expect.poll(async()=>{const s=await snapshot();return s.phase==='ready'&&Number(s.properties['time-pos'])>.05;},{timeout:30000,intervals:[20]}).toBe(true);
   const initial=await snapshot(),openToDecodedMs=performance.now()-opened;
   await command(['set_property','pause',true]);await expect.poll(async()=>(await snapshot()).properties.pause).toBe(true);
   assert.equal(await command(['get_property','hr-seek']),true,'exact seek retained');
   const timings=[];
   for(const fraction of [.35,.6,.2]){
    const prior=await snapshot(),target=Number(prior.properties.duration)*fraction,started=performance.now();
    await command(['set_property','time-pos',target]);
    await expect.poll(async()=>{const s=await snapshot();return s.restarts>prior.restarts&&s.properties.seeking!==true&&Math.abs(Number(s.properties['time-pos'])-target)<.3;},{timeout:30000,intervals:[20]}).toBe(true);
    const s=await snapshot();timings.push({target,actual:s.properties['time-pos'],commandToDecodedMs:performance.now()-started});
   }
   await command(['set_property','pause',false]);const at=Number((await snapshot()).properties['time-pos']);
   await expect.poll(async()=>Number((await snapshot()).properties['time-pos']),{timeout:10000,intervals:[20]}).toBeGreaterThan(at+.3);
   const s=await snapshot();assert.equal(s.sourceLoads,1);assert.equal(s.properties['video-params'].w,media.width);assert.equal(s.properties['video-params'].h,media.height);
   samples.push({id,mode,cycle,openToDecodedMs,firstFrameMs:initial.firstFrameMs,readyMs:initial.readyMs,audioOutput:initial.properties['current-ao'],codec:s.properties['video-codec'],hwdec:s.properties['hwdec-current'],width:media.width,height:media.height,sourceLoads:s.sourceLoads,bufferingEvents:s.bufferingEvents,timings});
   await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(ids.length);
   assert.equal(statSync(media.path).size,before.size);assert.equal(statSync(media.path).mtimeMs,before.mtimeMs);
  }
 }
 writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({scope:'real Electron, identical exact command transport; warm-cache alternating order; decoded-restart/time checked; not native input/compositor latency',samples},null,2));console.log('Matched presentation comparison passed:',data);
}catch(error){
 const state=desktop?await desktop.evaluate(()=>globalThis.__presentationClient?.snapshot).catch(()=>null):null;
 const trace=desktop?await desktop.evaluate(()=>globalThis.__presentationTrace).catch(()=>null):null;
 const windows=desktop?await Promise.all(desktop.windows().map(async p=>({url:p.url(),body:await p.locator('body').innerText().catch(()=>'<closed>')}))):[];
 writeFileSync(path.join(data,'failure.json'),JSON.stringify({error:String(error),state,trace,windows,samples},null,2));if(desktop)await desktop.evaluate(({app})=>app.exit(1)).catch(()=>{});throw error;
}
finally{if(desktop)await desktop.close().catch(()=>{});}
