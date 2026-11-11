import {placeTestMedia} from './media-pool.mjs';
import {playbackFixture} from './playback-fixtures.mjs';
// Real Electron/MPV reopen regression. Owned generated media only; no OS-input timing claim.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/mpv-independent-reopen-')),media=path.join(data,'media');
mkdirSync(media);
const realMedia=process.argv.includes('--real-media'),original=realMedia?'E:/downloads/The World in HDR in 4K (ULTRA HD).mkv':null;
const identity=()=>original?{sha256:createHash('sha256').update(readFileSync(original)).digest('hex'),mtime:statSync(original).mtimeMs}:null;
const originalBefore=identity();
const firstFile=realMedia?'HDR.mkv':'Small.mp4';
placeTestMedia(original??playbackFixture('basic'),path.join(media,firstFile));
placeTestMedia(playbackFixture('hevc4k'),path.join(media,'HEVC4K.mkv'));
placeTestMedia(playbackFixture('transport8'),path.join(media,'Transport.ts'));
const files=[firstFile,'Transport.ts','HEVC4K.mkv'];
const hashes=()=>files.map(file=>createHash('sha256').update(readFileSync(path.join(media,file))).digest('hex')),before=hashes();
const iterations=Number(process.argv[2]??18);assert.ok(Number.isInteger(iterations)&&iterations>=3&&iterations<=90);
const delayedLayout=process.argv.includes('--delayed-layout');
const report={kind:'real-Electron-independent-reopen',iterations,delayedLayout,realMedia,originalBefore,performanceEvidence:!delayedLayout,rows:[],passed:false};
let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 await desktop.evaluate(({app},{data,delayedLayout})=>{
  const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),{MpvClient}=require(app.getAppPath()+'/electron/dist/mpvClient.js'),start=MpvClient.prototype.start;
  const fs=require('node:fs');let count=0;
  MpvClient.prototype.start=function(...args){
   globalThis.__reopenClient=this;args[4]=[...(args[4]??[]),'--log-file='+data+'/mpv-'+(++count)+'.log'];
   if(delayedLayout){
    // Controlled real-source startup delay, not fake clocks or frame receipts.
    const source=fs.readFileSync(args[7],'utf8');
    const gate="local mp=require 'mp'\nlocal original_size=mp.get_osd_size\nlocal layout_after=mp.get_time()+3\nmp.get_osd_size=function() if mp.get_time()<layout_after then return 0,0 end;return original_size() end\nmp.add_hook('on_preloaded',50,function(hook) hook:defer();mp.add_timeout(3,function() hook:cont() end) end)\n";
    fs.writeFileSync(args[7],gate+source);
   }
   return start.apply(this,args);
  };
 },{data,delayedLayout});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
 await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await api('/api/thumbnails/pause','POST');
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',mpvWindowMode:'independent',nativeRenderEnabled:false,resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 const command=args=>desktop.evaluate(async(_,args)=>globalThis.__reopenClient.command(args),args);
 for(let iteration=0;iteration<iterations;iteration++){
  const file=files[iteration%files.length],title=path.parse(file).name,row={iteration,file};report.rows.push(row);
  await page.getByRole('button',{name:'播放 '+title,exact:true}).click();
  await expect.poll(async()=>{
   const body=await page.locator('body').innerText();
   assert.ok(!body.includes('原生播放启动失败'),body);
   return (await page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot')).catch(()=>null))?.phase;
  },{timeout:30000}).toBe('ready');
  row.layout=await command(['get_property','user-data/avhub-ui/layout']);
  assert.equal(await command(['get_property','user-data/avhub-ui/version']),1);
  const s=await page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
  assert.equal(s.sourceLoads,1);row.hardware=s.properties['hwdec-current'];
  await command(['set_property','pause',true]);
  await command(['script-message-to','avhub_ui','seek-relative','1']);
  await expect.poll(async()=>{const s=await page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));return s.pendingSeek===null&&s.seekDiagnostics?.target>=1;},{timeout:15000}).toBe(true);
  row.seek=await page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
  if(file==='Small.mp4'&&iteration===0){
   const before=await page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
   await page.evaluate(session=>window.avhubDesktop.nativePlayer('seek-policy',{session,value:'fast'}),before.session);
   await command(['seek','0','absolute+exact']);
   await expect.poll(async()=>Number(await command(['get_property','time-pos']))).toBeLessThan(.1);
   await expect.poll(()=>command(['get_property','seeking'])).toBe(false);
   await command(['script-message-to','avhub_ui','seek-relative','5']);
   await expect.poll(async()=>{const s=await page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));return s.pendingSeek===null&&s.seekDiagnostics?.target>4.9&&s.seekDiagnostics?.strategy==='exact';},{timeout:15000}).toBe(true);
   const landed=await command(['get_property','time-pos']),duration=await command(['get_property','duration']);
   assert.ok(landed<duration-.01,'fast EOF must return a real indexed frame');
   assert.equal(await command(['get_property','eof-reached']),false);
   const confirmed=await page.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));assert.ok(confirmed.seekDiagnostics.corrections>=1);
   row.fastEnd={landed,duration,strategy:confirmed.seekDiagnostics.strategy};
  }

  if(file==='HEVC4K.mkv'||file==='Small.mp4'){
   const shots=path.join(data,'screenshots'),beforeShots=new Set(existsSync(shots)?readdirSync(shots):[]);await command(['script-message','avhub','screenshot']);
   await expect.poll(()=>existsSync(shots)?readdirSync(shots).filter(name=>name.endsWith('.png')&&!beforeShots.has(name)).length:0,{timeout:30000}).toBeGreaterThan(0);
   const png=readFileSync(path.join(shots,readdirSync(shots).find(name=>name.endsWith('.png')&&!beforeShots.has(name))));
   row.screenshot={width:png.readUInt32BE(16),height:png.readUInt32BE(20),bitDepth:png[24]};assert.equal(row.screenshot.width,file==='HEVC4K.mkv'?3840:640);assert.equal(row.screenshot.height,file==='HEVC4K.mkv'?2160:360);assert.equal(row.screenshot.bitDepth,file==='HEVC4K.mkv'?16:8,'source screenshot must retain its appropriate bit depth');
  }
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(3);
  row.transport=await desktop.evaluate(()=>globalThis.__reopenClient.transport);assert.equal(row.transport.exited,true);assert.equal(row.transport.exitCode,0);
 }
 assert.deepEqual(hashes(),before);assert.deepEqual(identity(),originalBefore);report.passed=true;
}catch(error){report.error=String(error.stack||error);report.body=await page?.locator('body').innerText().catch(()=>null);report.last=await desktop?.evaluate(()=>globalThis.__reopenClient?.snapshot).catch(()=>null);throw error;}
finally{try{await desktop?.close();}finally{writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}}
