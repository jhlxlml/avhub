// Real AVHub Electron/native cases. Generated fixtures may be constructed here;
// user media is read only and copied once into an owned fixture cohort. Actual
// decoded/GPU frames are measured; no physical HDR or cold OS cache claim.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,statSync,statfsSync,createReadStream,lstatSync,realpathSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {benchmarkResources,seekPercentiles} from './benchmark-resources.mjs';

const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/render-compatibility-seek-')),reuse=process.env.AVHUB_BENCH_REUSE_COMPAT;
assert.ok(!reuse||/^render-compatibility-seek-[A-Za-z0-9]{6}$/.test(reuse),'Only an owned fixture cohort can be reused');
const fixtures=reuse?path.join(root,'build',reuse):data,coordinated=process.env.AVHUB_TEST_SESSION_COORDINATOR==='1',original=path.join(root,'build/libmpv-render-spike/samples/Framecode-v2-640x360.mp4');
const digest=async file=>{const hash=createHash('sha256');await pipeline(createReadStream(file),hash);return hash.digest('hex');};
const identity=async file=>{const stat=statSync(file,{bigint:true});return {sha256:await digest(file),size:Number(stat.size),mtimeNs:String(stat.mtimeNs),inode:String(stat.ino)};};
let cases;
if(reuse){assert.ok(!lstatSync(fixtures).isSymbolicLink());assert.equal(realpathSync(fixtures).toLowerCase(),path.resolve(fixtures).toLowerCase());cases=JSON.parse(readFileSync(path.join(fixtures,'cases.json'),'utf8'));}
else{
 cases=[{kind:'missing-color',ext:'.mp4',barcode:true},{kind:'external-ass',ext:'.mp4',barcode:true},{kind:'damaged',ext:'.mp4',damaged:true}];
 for(const item of cases){const directory=path.join(fixtures,'cases',item.kind);mkdirSync(directory,{recursive:true});const file=path.join(directory,'Sample'+item.ext);
  if(item.kind==='missing-color'){const result=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-i',original,'-map','0:v:0','-c','copy','-bsf:v','h264_metadata=colour_primaries=2:transfer_characteristics=2:matrix_coefficients=2','-n',file],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,result.stderr);}
  else if(item.damaged){const bytes=Buffer.from(readFileSync(original));let offset=0,damaged=false;while(offset+8<=bytes.length){let size=bytes.readUInt32BE(offset),header=8;if(size===1){size=Number(bytes.readBigUInt64BE(offset+8));header=16;}if(size===0)size=bytes.length-offset;assert.ok(size>=header&&offset+size<=bytes.length);if(bytes.toString('ascii',offset+4,offset+8)==='mdat'){bytes.fill(0,offset+header,offset+size);damaged=true;}offset+=size;}assert.ok(damaged);writeFileSync(file,bytes);}
  else {copyFileSync(original,file);writeFileSync(path.join(directory,'Sample.ass'),'[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,32,&H00FF00FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:06.00,Default,,0,0,0,,{\\pos(320,240)}ASS FRAME CHECK\n');}
 }
 const discoveryFile=path.join(root,'build/codex-optimization/real-sample-discovery.json');
 const selected=JSON.parse(readFileSync(discoveryFile,'utf8')).selected;
 if(selected){const source=path.resolve(selected.file),relative=path.relative('E:/downloads',source);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Only authorized E downloads input');assert.ok(!lstatSync(source).isSymbolicLink());const before=await identity(source);assert.ok(statfsSync(data).bavail*statfsSync(data).bsize>before.size+512*1024**2,'Owned fixture capacity');const directory=path.join(fixtures,'cases/natural-media');mkdirSync(directory,{recursive:true});copyFileSync(source,path.join(directory,'Sample.mkv'));assert.deepEqual(await identity(source),before,'Original user video is never modified');cases.push({kind:'natural-media',ext:'.mkv',barcode:false,original:before,large:before.size>=512*1024**2});}
 writeFileSync(path.join(fixtures,'cases.json'),JSON.stringify(cases,null,2));
}
assert.ok(cases.every(item=>['missing-color','external-ass','damaged','natural-media'].includes(item.kind)&&['.mp4','.mkv'].includes(item.ext)));
const frames=[43,119,77,121,12,102,87,29,136,106,58,139,82,45,110,98,128,63,14,133];
const fractions=[.07,.63,.21,.88,.34,.72,.11,.94,.48,.57,.26,.81,.16,.67,.39,.76,.04,.52,.91,.43];
const report={kind:'real-electron-readonly-compatibility-seek',build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),sessionCoordinator:coordinated,fixtureCohort:reuse??path.basename(data),rawRangePassed:false,cacheMethodology:'Fresh application profile/cache, same physical fixtures and two target passes; OS/driver caches uncontrolled',rows:[],completed:false};
let desktop,page;
try{
 for(const item of cases){
  const media=path.join(fixtures,'cases',item.kind),file=path.join(media,'Sample'+item.ext),before=await identity(file),profile=path.join(data,'profile-'+item.kind);mkdirSync(profile);
  const probe=spawnSync(path.join(root,'bin/ffprobe.exe'),['-v','error','-select_streams','v:0','-show_entries','format=duration:stream=codec_name,width,height,pix_fmt,color_range,color_primaries,color_transfer,color_space','-of','json',file],{encoding:'utf8',windowsHide:true,timeout:20000});
  if(item.original)assert.equal(before.sha256,item.original.sha256,'Owned real fixture must equal the original read-only source bytes');
  const row={kind:item.kind,source:before,probeExit:probe.status,probe:probe.status===0?JSON.parse(probe.stdout):null,seeks:[],resources:[]};report.rows.push(row);
  if(item.kind==='missing-color'){const stream=row.probe.streams[0];assert.ok(['color_primaries','color_transfer','color_space'].some(key=>!stream[key]||stream[key]==='unknown'));}
  desktop=await _electron.launch({args:[root],cwd:profile,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error(await response.text());return response.json();},{url,method,body});
  await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');await api('/api/thumbnails/pause','POST');
  const indexed=(await api('/api/media?page=1&page_size=48')).items;assert.equal(indexed.length,1);const memory=await api(`/api/media/${indexed[0].id}/playback-state`);row.sourceIdentity=memory.source;
  if(item.kind==='external-ass'){const subtitle=path.join(media,'Sample.ass');const details=await api(`/api/media/${indexed[0].id}`);assert.ok(details.external_subtitles.some(track=>track.path.toLowerCase()===subtitle.toLowerCase()));await api(`/api/media/${indexed[0].id}/playback-state`,'PATCH',{source:memory.source,changes:{subtitle,delay:0}});}
  await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,playbackSessionCoordinatorEnabled:coordinated,resumeBehavior:'restart',autoNext:false,hoverPreview:false,audio:{volume:0,muted:true}}});await page.reload();await page.evaluate(()=>window.avhubDesktop.onRenderState(state=>window.__compatState=state));await page.getByRole('button',{name:'播放 '+indexed[0].title,exact:true}).click();
  if(item.damaged){await expect.poll(async()=>/原生播放(?:启动)?失败/.test(await page.locator('body').innerText()),{timeout:35000}).toBe(true);assert.equal(await page.locator('video').count(),0);row.expectedFailure=true;row.performanceStatus='SKIP';row.performanceReason='Intentionally damaged source has no decodable target; 20 successful seeks would be fabricated';row.errorText=await page.locator('body').innerText();}
  else{
   await expect.poll(()=>page.evaluate(()=>window.__compatState?.phase),{timeout:30000}).toBe('ready');if(coordinated)await expect(page.getByLabel('MPV 原生播放区域',{exact:true})).toHaveAttribute('data-playback-session-phase','ready');
   await expect.poll(()=>page.evaluate(()=>window.__compatState.properties.pause)).toBe(false);await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>window.__compatState.properties.pause)).toBe(true);
   const canvas=page.locator('.native-render-canvas'),height=row.probe.streams[0].height;
   const picture=async()=>{const png=await canvas.screenshot();const code=item.barcode?await desktop.evaluate(({nativeImage},{png,height})=>{const image=nativeImage.createFromBuffer(Buffer.from(png,'base64')),size=image.getSize(),bytes=image.toBitmap();let result=0;for(let bit=0;bit<16;bit++){const at=(Math.floor(32/height*size.height)*size.width+Math.floor((bit+.5)*size.width/16))*4;if(bytes[at+2]>180)result+=2**bit;}return result;},{png:png.toString('base64'),height}):null;return {png,code,sha256:createHash('sha256').update(png).digest('hex')};};
   if(item.kind==='external-ass'){
    await expect.poll(()=>page.evaluate(()=>window.__compatState.tracks.some(track=>track.type==='subtitle'&&track.external&&track.selected)),{timeout:10000}).toBe(true);
    await page.mouse.move(1,1);await expect(page.getByRole('region',{name:'原生视频播放器',exact:true})).not.toHaveClass(/controls-visible/);
    const initial=await picture(),selected=await page.evaluate(()=>window.__compatState.tracks.find(track=>track.type==='subtitle'&&track.selected).id);
    const toggle=async id=>{const serial=await page.evaluate(()=>window.__compatState.presented.serial);await page.evaluate(async id=>{const s=window.__compatState;await window.avhubDesktop.renderPlayer('command',{session:s.session,generation:s.generation,action:'track',value:{type:'subtitle',id}});},id);await expect.poll(()=>page.evaluate(()=>window.__compatState.presented.serial),{timeout:10000}).toBeGreaterThan(serial);};
    await toggle(null);const disabled=await picture();assert.equal(disabled.code,initial.code,'Subtitle refresh must not change the decoded video frame');assert.notEqual(disabled.sha256,initial.sha256,'ASS text must actually affect the compositor');await toggle(selected);row.assRendered={selectedExternalTrack:true,compositorChangesWhenDisabled:true,decodedFrameUnchanged:true};
   }
   const targets=item.barcode?frames.map(frame=>frame/25):fractions.map(factor=>Math.max(.1,Math.min(Number(row.probe.format.duration)-.1,Number(row.probe.format.duration)*factor)));
   for(const {cachePass,target} of ['initial-cache','repeated-targets'].flatMap(cachePass=>targets.map(target=>({cachePass,target})))){
    if(target===targets[0])row.resources.push({cachePass,when:'before',...await benchmarkResources(desktop)});
    const result=await page.evaluate(target=>new Promise((resolve,reject)=>{const state=window.__compatState,old=state.presented,began=performance.now(),slider=document.querySelector('input[aria-label="播放进度"]');let off;const timer=setTimeout(()=>{off?.();reject(new Error('No actual compatibility target frame '+target));},15000);off=window.avhubDesktop.onRenderState(next=>{if(next.session===state.session&&next.phase==='ready'&&next.pendingSeek===null&&next.presented?.serial>old.serial&&next.presented.seekId>old.seekId&&Math.abs(next.presented.positionSec-target)<.12){clearTimeout(timer);off();resolve({target,actual:next.presented.positionSec,serial:next.presented.serial,ms:performance.now()-began});}});slider.value=String(target);slider.dispatchEvent(new Event('input',{bubbles:true}));}),target);
    const image=await picture();if(item.barcode)assert.ok(Math.abs(image.code-Math.round(target*25))<=1);row.seeks.push({cachePass,...result,pixel:image.code,compositorSha256:image.sha256});if(target===targets.at(-1))row.resources.push({cachePass,when:'after',...await benchmarkResources(desktop)});
   }
   Object.assign(row,seekPercentiles(row.seeks));row.cachePasses=Object.fromEntries(['initial-cache','repeated-targets'].map(pass=>[pass,seekPercentiles(row.seeks.filter(seek=>seek.cachePass===pass))]));const state=await page.evaluate(()=>window.__compatState);row.firstFrameMs=state.firstFrameMs;row.sourceLoads=state.sourceLoads;row.videoSize=state.videoSize;row.properties=state.properties;row.distinctCompositorFrames=new Set(row.seeks.map(seek=>seek.compositorSha256)).size;assert.equal(state.sourceLoads,1);assert.deepEqual(state.videoSize,{width:row.probe.streams[0].width,height});
  }
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.card')).toHaveCount(1);assert.equal((await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).active,false);assert.deepEqual(await identity(file),before);assert.equal((await api('/api/preferences')).values.playerEngine,'mpv');
  await desktop.close();desktop=null;row.cleanup=readFileSync(path.join(profile,'desktop.log'),'utf8').split('\n').filter(line=>line.includes('render-player-closed ')).map(line=>JSON.parse(line.slice(line.indexOf('render-player-closed ')+21)));for(const close of row.cleanup){assert.equal(close.helperAlive,false);assert.equal(close.sourceLeaseReleased,true);if(close.transport){assert.equal(close.transport.imports,close.transport.released);assert.equal(close.transport.leases,close.transport.closedLeases);}}row.passed=true;
 }
 report.completed=true;
}catch(error){report.error=String(error.stack||error);if(page)report.state=await page.evaluate(()=>window.__compatState).catch(()=>null);throw error;}
finally{const verified=report.completed;report.completed=false;try{if(desktop)await desktop.close();report.cleanupCompleted=true;report.completed=verified;}finally{writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({completed:report.completed,report:path.join(data,'report.json'),rows:report.rows.map(row=>({kind:row.kind,p95:row.p95,seeks:row.seeks.length,expectedFailure:row.expectedFailure}))}));}}
