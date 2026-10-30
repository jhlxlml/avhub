// Actual Electron: absent color tags stay on mpv, with resume and seek.
// Owned untagged sample; no mocked native/API responses or color override.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import path from 'node:path';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),data=mkdtempSync(path.join(root,'build/render-unverified-color-'));
const media=path.join(data,'media');mkdirSync(media);
const mode=process.argv[2]??'untagged',tenBit=mode==='partial-ten-bit',sd=mode==='untagged-sd';
assert.ok(['untagged','untagged-sd','partial-ten-bit','tagged','sdr-601','sdr-444-12','anamorphic','rotated','8k','hdr-pq','hdr-hlg','long-timeline','dynamic-resize'].includes(mode));
const width=mode==='8k'?7680:sd?352:640,height=mode==='8k'?4320:sd?288:360;
const hdr=mode.startsWith('hdr-'),longTimeline=mode==='long-timeline',seekTarget=longTimeline?604810:8;
const twelve=mode==='sdr-444-12',lossless=twelve||mode==='8k'||longTimeline;
const dynamic=mode==='dynamic-resize';
const source=path.join(media,dynamic?'Unverified.ts':tenBit||lossless||hdr?'Unverified.mkv':'Unverified.mp4');
const raw=dynamic?path.join(data,'first.ts'):mode==='rotated'?path.join(data,'raw.mp4'):source;
const encode=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i',`testsrc2=s=${width}x${height}:r=${mode==='8k'?2:25}`,
 ...(dynamic?['-t','6','-muxdelay','0']:longTimeline?['-frames:v','301','-vf','setpts=N/(25*TB)+floor(N/300)*604798/TB','-enc_time_base','1/1000','-fps_mode','passthrough']:['-t','12']),...(lossless?['-c:v','ffv1','-threads','2','-pix_fmt',twelve?'yuv444p12le':hdr?'yuv420p10le':'yuv420p']:tenBit||hdr?['-c:v','libx265','-preset','ultrafast','-x265-params','pools=2:frame-threads=1:log-level=error'+(hdr?`:colorprim=bt2020:transfer=${mode==='hdr-pq'?'smpte2084':'arib-std-b67'}:colormatrix=bt2020nc:range=limited`:''),'-pix_fmt','yuv420p10le','-color_primaries','bt709']:['-c:v','libx264','-pix_fmt','yuv420p']),
 ...(hdr?['-color_primaries','bt2020','-color_trc',mode==='hdr-pq'?'smpte2084':'arib-std-b67','-colorspace','bt2020nc','-color_range','tv']:[]),
 ...(mode==='tagged'?['-x264-params','colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv']:[]),
 ...(mode==='sdr-601'?['-color_primaries','smpte170m','-color_trc','smpte170m','-colorspace','smpte170m','-color_range','tv']:[]),
 ...(mode==='anamorphic'?['-vf','setsar=2']:[]),'-g','25','-n',raw],{windowsHide:true,timeout:120000});
if(mode==='rotated'){assert.equal(encode.status,0,String(encode.stderr));const remux=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-display_rotation:v:0','90','-i',raw,'-c','copy','-n',source],{windowsHide:true,timeout:30000});assert.equal(remux.status,0,String(remux.stderr));}
assert.equal(encode.status,0,String(encode.stderr));
if(dynamic){
 const second=path.join(data,'second.ts');
 const result=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=1280x720:r=25','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-g','25','-output_ts_offset','6','-muxdelay','0','-n',second],{windowsHide:true,timeout:30000});assert.equal(result.status,0,String(result.stderr));
 writeFileSync(source,Buffer.concat([readFileSync(raw),readFileSync(second)]));
}
const identity=()=>({sha256:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs});
const before=identity(),packagedExe=process.env.AVHUB_TEST_PACKAGED_EXE,desktopInstalled=process.env.AVHUB_TEST_DESKTOP_RENDER==='1';
const report={kind:'actual-electron-untagged-mpv-playback',mode,packaged:!!packagedExe,passed:false,playbackRequests:[]};
let desktop,page;
try{
 desktop=await _electron.launch({...(packagedExe?{executablePath:packagedExe,args:[]}:{args:[root]}),cwd:data,
  env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_RENDER_LOCAL_ACCEPTANCE:packagedExe&&!desktopInstalled?'1':'',AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
 if(desktopInstalled){report.acceptanceEnvironment=await desktop.evaluate(()=>process.env.AVHUB_RENDER_LOCAL_ACCEPTANCE??'');assert.equal(report.acceptanceEnvironment,'');}
 page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 page.on('request',request=>{if(request.method()==='POST'&&/\/api\/media\/\d+\/playback$/.test(new URL(request.url()).pathname))report.playbackRequests.push(request.postDataJSON());});
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});
 await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');
 const item=(await api('/api/media?page=1&page_size=48')).items.find(value=>value.title==='Unverified');
 await api(`/api/media/${item.id}/progress`,'PUT',{progress:2,watched:false,updated_at:Date.now()});
 await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',nativeRenderEnabled:true,resumeBehavior:'resume',autoNext:false,audio:{volume:0,muted:true}}});await page.reload();
 await page.evaluate(()=>window.avhubDesktop.onRenderState(s=>window.__untaggedState=s));
 await page.getByRole('button',{name:'播放 Unverified',exact:true}).click();
 const state=()=>page.evaluate(()=>window.__untaggedState);
 const canvas=page.locator('.native-render-canvas');await expect(canvas).toBeVisible({timeout:30000});
 await expect.poll(async()=>(await state())?.presented?.serial??0,{timeout:30000}).toBeGreaterThan(0);
 if(longTimeline)await expect.poll(async()=>(await state())?.presented?.serial??0,{timeout:30000}).toBeGreaterThan(0);
 else await expect.poll(async()=>(await state())?.positionSec,{timeout:30000}).toBeGreaterThan(2.3);
 report.first=await state();assert.deepEqual(report.first.videoSize,mode==='rotated'?{width:height,height:width}:mode==='anamorphic'?{width:width*2,height}:{width,height});
 if(hdr){assert.equal(report.first.properties['avhub-output-transfer'],mode==='hdr-pq'?'pq':'hlg');assert.match(report.first.properties['avhub-hdr-status'],/待验证/);assert.ok(['yuv420p10','yuv420p10le','p010','p010le'].includes(report.first.properties['video-params']['hw-pixelformat']??report.first.properties['video-params'].pixelformat));
  report.importedColor=await canvas.evaluate(n=>({transfer:n.dataset.nativeTransfer,primaries:n.dataset.nativePrimaries}));
  assert.deepEqual(report.importedColor,{transfer:mode==='hdr-pq'?'pq':'hlg',primaries:'bt2020'});
 }
 if(twelve)assert.ok(['yuv444p12','yuv444p12le'].includes(report.first.properties['video-params'].pixelformat));
 if(tenBit){const v=report.first.properties['video-params'];assert.ok(['yuv420p10le','p010','p010le'].includes(v['hw-pixelformat']??v.pixelformat),'decoder must retain ten bits');}
 assert.equal(report.first.properties['avhub-source-color'],mode==='tagged'?'源色彩标记完整':'源色彩标记不完整 · MPV 自动解释');
 assert.equal(await page.locator('video').count(),0);assert.equal((await api('/api/preferences')).values.playerEngine,'mpv');
 assert.equal(report.playbackRequests.length,0,'native playback must not request conversion or HTML fallback');
 if(!longTimeline)await expect.poll(async()=>(await state()).presented.serial).toBeGreaterThan(report.first.presented.serial+5);
 const firstPixels=createHash('sha256').update(await canvas.screenshot()).digest('hex');
 await page.keyboard.press('Space');await expect.poll(async()=>(await state()).properties.pause).toBe(true);
 const timeline=page.getByRole('slider',{name:'播放进度',exact:true});await timeline.evaluate((n,target)=>{n.value=String(target);n.dispatchEvent(new Event('input',{bubbles:true}));},seekTarget);
 await expect.poll(async()=>{const s=await state();return s.pendingSeek===null&&Math.abs(s.presented.positionSec-seekTarget)<.1;},{timeout:10000}).toBe(true);
 if(longTimeline)assert.ok(report.first.durationSec>604800);
 report.afterSeek=await state();if(dynamic){assert.deepEqual(report.afterSeek.videoSize,{width:1280,height:720});assert.deepEqual(await canvas.evaluate(n=>({width:n.width,height:n.height})),{width:1280,height:720});assert.ok(report.afterSeek.transport.leases>=2);}
 assert.equal(report.afterSeek.sourceLoads,1);assert.equal(report.afterSeek.restarts,0);
 assert.notEqual(createHash('sha256').update(await canvas.screenshot()).digest('hex'),firstPixels);
 if(dynamic){
  await timeline.evaluate(n=>{n.value='2';n.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect.poll(async()=>{const s=await state();return s.pendingSeek===null&&s.videoSize.width===640&&Math.abs(s.presented.positionSec-2)<.1;},{timeout:10000}).toBe(true);
  report.afterResizeBack=await state();await page.keyboard.press('Space');
  await expect.poll(async()=>{const s=await state();return s.videoSize.width===1280&&s.presented.positionSec>=6.2;},{timeout:15000}).toBe(true);
  report.naturalResize=await state();assert.equal(report.naturalResize.sourceLoads,1);assert.equal(report.naturalResize.restarts,0);assert.ok(report.naturalResize.transport.leases>=4);
 }
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.renderPlayer('status'))).toMatchObject({active:false});
 assert.deepEqual(identity(),before);report.sourceUnchanged=true;report.passed=true;
}catch(error){report.error=String(error.stack||error);if(page)report.body=await page.locator('body').innerText().catch(()=>'<closed>');throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(data,'report.json')}));}
