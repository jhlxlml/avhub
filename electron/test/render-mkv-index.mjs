// Real Electron pixel targets; only independent owned header-mutation copies.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {generateTestMedia,sharedMedia,mediaHash} from './media-pool.mjs';
const root=path.resolve(import.meta.dirname,'../..'),data=fs.mkdtempSync(path.join(root,'build/render-mkv-index-')),media=path.join(data,'media');fs.mkdirSync(media);
const normal=path.join(media,'Indexed.mkv');
const made=generateTestMedia(['-v','error','-i',path.join(root,'build/libmpv-render-spike/samples/Framecode-v2-640x360.mp4'),'-map','0:v:0','-c','copy','-n',normal]);
const pool=sharedMedia(),poolBefore=mediaHash(made.fixture),header=fs.readFileSync(normal).subarray(0,16384),at=header.indexOf(Buffer.from('53ab841c53bb6b','hex'));assert.ok(at>=0);
assert.equal(header.subarray(at+7,at+9).toString('hex'),'53ac');const positionBytes=header[at+9]&127;assert.ok(positionBytes>=1&&positionBytes<=6);const identities={};
for(const name of ['Reversed','InvalidTarget']){
 const file=path.join(media,name+'.mkv');pool.place(made.fixture,file,{mutable:true});const fd=fs.openSync(file,'r+');fs.writeSync(fd,Buffer.from('6bbb531c','hex'),0,4,at+3);
 if(name==='InvalidTarget')fs.writeSync(fd,Buffer.alloc(positionBytes),0,positionBytes,at+10);fs.closeSync(fd);
}
for(const name of ['Indexed','Reversed','InvalidTarget'])identities[name]=mediaHash(path.join(media,name+'.mkv'));
const report={kind:'real-Electron-MKV-Cues-compatibility-pixels',candidate:process.env.AVHUB_RENDER_RUNTIME_CANDIDATE,build:JSON.parse(fs.readFileSync(path.join(root,'app/build-info.json'),'utf8')),rows:[],passed:false};let desktop,page;
try{
 desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await api('/api/thumbnails/pause','POST');await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,mpvSeekPolicy:'exact',resumeBehavior:'restart',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__mkvIndex=s));
 for(const name of ['Indexed','Reversed','InvalidTarget']){
  const row={name,seeks:[]};report.rows.push(row);await page.evaluate(()=>window.__mkvIndex=null);await page.getByRole('button',{name:'播放 '+name,exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__mkvIndex?.phase),{timeout:30000}).toBe('ready');await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__mkvIndex.properties.pause)).toBe(true);
  for(const target of [1.72,4.68,2.28]){
   const previous=await page.evaluate(()=>window.__mkvIndex.seekDiagnostics?.seekId??0);
   await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((slider,target)=>{slider.value=String(target);slider.dispatchEvent(new Event('input',{bubbles:true}));},target);
   await expect.poll(()=>page.evaluate(previous=>{const s=window.__mkvIndex;return s.pendingSeek===null&&s.seekDiagnostics?.seekId>previous;},previous),{timeout:15000}).toBe(true);
   const png=await page.locator('.native-render-canvas').screenshot(),pixel=await desktop.evaluate(({nativeImage},bytes)=>{const im=nativeImage.createFromBuffer(Buffer.from(bytes,'base64')),s=im.getSize(),p=im.toBitmap();let frame=0;for(let bit=0;bit<16;bit++){const i=(Math.floor(32/360*s.height)*s.width+Math.floor((bit+.5)*s.width/16))*4,r=p[i+2],g=p[i+1],b=p[i];if(Math.abs(r-g)>12||Math.abs(r-b)>12||r>=60&&r<=180)throw Error('Ambiguous pixel');if(r>180)frame+=2**bit;}return frame;},png.toString('base64'));
   assert.ok(Math.abs(pixel-target*25)<=1);const s=await page.evaluate(()=>window.__mkvIndex);assert.equal(s.sourceLoads,1);assert.equal(s.properties.pause,true);assert.equal(s.properties['current-demuxer'],'mkv');row.seeks.push({target,pixel,...s.seekDiagnostics});
  }
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect.poll(async()=>(await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active).toBe(false);assert.equal(mediaHash(path.join(media,name+'.mkv')),identities[name]);row.passed=true;
 }
 assert.equal(mediaHash(made.fixture),poolBefore);await desktop.close();desktop=null;
 report.closes=fs.readFileSync(path.join(data,'desktop.log'),'utf8').split('\n').filter(line=>line.includes(' render-player-closed ')).map(line=>JSON.parse(line.split(' render-player-closed ')[1]));assert.equal(report.closes.length,3);
 for(const row of report.closes){assert.equal(row.helperAlive,false);assert.equal(row.sourceLeaseReleased,true);assert.equal(row.transport.imports,row.transport.released);assert.equal(row.transport.leases,row.transport.closedLeases);}report.passed=true;
}catch(error){report.error=String(error.stack??error);throw error;}
finally{await desktop?.close();fs.writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(path.join(data,'report.json'));}
