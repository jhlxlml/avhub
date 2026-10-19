// Desktop acceptance: embedded video HWND plus transparent owned controls.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {nativeVisualEvidence} from './native-visual-evidence.mjs';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','native-embedded-')),media=path.join(data,'media');mkdirSync(media);
const index=process.argv[2],mediaId=Number(process.argv[3]);let source=path.join(media,'Embedded sample.mkv');
if(index){
  assert.ok(path.isAbsolute(index)&&Number.isSafeInteger(mediaId)&&mediaId>0,'Explicit authorized index and media ID required');
  const cloned=spawnSync('python',['-c',`import os,sqlite3,json
from pathlib import Path
source=sqlite3.connect(Path(os.environ['EMBED_INDEX']).resolve().as_uri()+'?mode=ro',uri=True)
target=sqlite3.connect(str(Path(os.environ['EMBED_DATA'])/'library.db'));source.backup(target);source.close()
id=int(os.environ['EMBED_ID']);row=target.execute('select path from media where id=?',(id,)).fetchone();assert row
target.execute('DELETE FROM media WHERE id<>?',(id,))
for table in ('preferences','root_file_permissions'):target.execute('DELETE FROM '+table)
target.execute('UPDATE media SET custom_cover=NULL,progress=0,watched=0');target.commit();target.close()
print(json.dumps(row[0],ensure_ascii=True))`],{env:{...process.env,EMBED_INDEX:index,EMBED_DATA:data,EMBED_ID:String(mediaId)},encoding:'utf8',windowsHide:true});
  assert.equal(cloned.status,0,cloned.stderr);source=JSON.parse(cloned.stdout);
}else{
const generated=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','90','-c:v','libx264','-g','50','-pix_fmt','yuv420p',source],{windowsHide:true,timeout:30000});assert.equal(generated.status,0,String(generated.stderr));
}
const identity=()=>({hash:createHash('sha256').update(readFileSync(source)).digest('hex'),mtime:statSync(source).mtimeMs}),before=identity();
let desktop;const errors=[];
try{
  desktop=await _electron.launch({args:[root,'--no-sandbox'],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1'},timeout:60000});
  const page=await desktop.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows()[0];main.show();main.focus();});
  await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error(await response.text());return response.json();},{url,method,body});
  if(!index){await api('/api/roots','POST',{path:media});await api('/api/scan','POST');}
  else await api('/api/thumbnails/pause','POST');
  await expect.poll(async()=>(await api('/api/media?page=1')).total,{timeout:30000}).toBe(1);
  const item=(await api('/api/media?page=1')).items[0];
  await api('/api/preferences','PATCH',{values:{playerEngine:'mpv',resumeBehavior:'restart',audio:{volume:0,muted:true}}});
  await page.goto(new URL(`/?video=${item.id}`,page.url()).href);
  await expect(page.getByText('MPV · 原文件直接播放',{exact:true})).toBeVisible({timeout:30000});
  const overlay=desktop.windows().find(w=>w.url().includes('nativePlayer='));assert.ok(overlay);overlay.on('pageerror',error=>errors.push(error.message));
  const state=()=>overlay.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
  await expect.poll(async()=>(await state()).phase,{timeout:20000}).toBe('ready');assert.equal((await state()).embedded,true);
  const session=(await state()).session;
  await assert.rejects(()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('layout',{session:'stale',viewport:{}})));
  await assert.rejects(()=>page.evaluate(session=>window.avhubDesktop.nativePlayer('shortcut',{session,code:'KeyA',shiftKey:false,repeat:false}),session));
  assert.equal(await page.evaluate(async()=> (await fetch('/api/native-read/00000000000000000000000000000000/embed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parent:1,host:2,overlay:3,pid:4,rect:{}})})).status),403,'renderer cannot reparent OS windows');
  const call=(action,value)=>overlay.evaluate(({action,value,session})=>window.avhubDesktop.nativePlayer(action,{session,value}),{action,value,session});
  const handles=await desktop.evaluate(({BaseWindow,BrowserWindow})=>{
    const all=BaseWindow.getAllWindows(),host=all.find(w=>w.getTitle()==='AVHub · 原生播放');
    const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer='));
    const controls=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('nativePlayer='));
    const value=w=>{const b=w.getNativeWindowHandle();return (b.length===8?b.readBigUInt64LE():BigInt(b.readUInt32LE())).toString();};return {host:value(host),main:value(main),controls:value(controls)};
  });
  const inspect=()=>{const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'electron/test/native-window-evidence.ps1'),'-HostHandle',handles.main,'-ControlHandle',handles.controls],{windowsHide:true,encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
  const windows=inspect();writeFileSync(path.join(data,'embedded-windows.json'),JSON.stringify(windows,null,2));
  const host=windows.children.find(w=>w.handle===handles.host);assert.equal(host?.parent,handles.main);assert.ok((host.style&0x40000000)!==0,'host is a real WS_CHILD, not an owned popup');
  const controls=windows.controlsWindow;assert.equal(controls.owner,handles.main);assert.equal(controls.style&0x40000000,0,'transparent controls retain a supported owned-window compositor');assert.equal(host.dpi,windows.hostWindow.dpi);
  const initial=await page.getByLabel('MPV 原生播放区域').boundingBox();assert.ok(initial);
  await expect.poll(()=>overlay.evaluate(width=>Math.abs(innerWidth-width),initial.width)).toBeLessThan(2);
  await expect.poll(()=>overlay.evaluate(height=>Math.abs(innerHeight-height),initial.height)).toBeLessThan(2);
  await expect(overlay.locator('.native-top')).toHaveCount(0);
  await page.getByRole('button',{name:'收藏',exact:true}).click();await page.keyboard.press('Space');
  await expect.poll(async()=>(await state()).properties.pause).toBe(true);
  await page.keyboard.press('ArrowRight');await expect.poll(async()=>(await state()).pendingSeek,{timeout:10000}).toBe(null);assert.equal((await state()).sourceLoads,1);
  const capture=await call('screenshot');assert.equal(capture.width,index?item.width:640);assert.equal(capture.height,index?item.height:360);
  const visuals={};
  const visibleEvidence=async name=>{
    await call('pause',true);
    await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer='));main.setAlwaysOnTop(true);main.focus();});
    const size=await overlay.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await overlay.mouse.move(size.width/2,size.height-30);
    // Hold controls through actual keyboard focus. Synthetic mouse coordinates
    // do not move the OS pointer, which can otherwise immediately leave them.
    await overlay.keyboard.press('Tab');
    await overlay.getByRole('button',{name:'播放',exact:true}).focus();
    await expect(overlay.locator('.native-stage')).toHaveClass(/controls-visible/);
    await overlay.waitForTimeout(200);
    if(process.env.AVHUB_NATIVE_LAYER_DIAGNOSTIC==='1'){
      await overlay.screenshot({path:path.join(data,`${name}-renderer.png`)});
      writeFileSync(path.join(data,`${name}-windows.json`),JSON.stringify(inspect(),null,2));
    }
    const evidence=await nativeVisualEvidence(desktop,path.join(data,`${name}.png`),'main');
    if(process.env.AVHUB_REQUIRE_VISIBLE_NATIVE==='1'){
      assert.equal(evidence.status,'pattern-visible',JSON.stringify(evidence));
      const button=await overlay.getByRole('button',{name:'播放',exact:true}).boundingBox();
      const white=await desktop.evaluate(({nativeImage,BrowserWindow},{file,evidence,button})=>{
        const controls=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('nativePlayer=')),b=controls.getBounds(),scale=evidence.displayScale;
        const x=Math.round((b.x+button.x+button.width/2-evidence.bounds.x)*scale)-5,y=Math.round((b.y+button.y+button.height/2-evidence.bounds.y)*scale)-5;
        const pixels=nativeImage.createFromPath(file).crop({x,y,width:10,height:10}).toBitmap();let count=0;
        for(let at=0;at<pixels.length;at+=4)if(pixels[at]>180&&pixels[at+1]>180&&pixels[at+2]>180)count++;
        return count;
      },{file:path.join(data,`${name}.png`),evidence,button});
      assert.ok(white>3,`actual desktop must show the white play icon, not only video: ${white}`);evidence.controlsWhitePixels=white;
    }
    visuals[name]=evidence;
  };
  await visibleEvidence('normal-controls');
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer=')).minimize());
  await expect.poll(()=>inspect().controlsWindow.visible).toBe(false);
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer=')).restore());
  await expect.poll(()=>inspect().controlsWindow.visible).toBe(true);
  // A real main-page modal must occlude both native child layers.
  await page.evaluate(()=>{const node=document.createElement('div');node.className='modal-backdrop';node.id='test-embedded-modal';document.body.append(node);});
  await expect.poll(()=>inspect().children.find(w=>w.handle===handles.host)?.visible).toBe(false);
  await expect.poll(()=>inspect().controlsWindow.visible).toBe(false);
  await page.keyboard.press('Space');assert.equal((await state()).properties.pause,true,'modal owns keyboard');
  await page.evaluate(()=>document.getElementById('test-embedded-modal').remove());
  await expect.poll(()=>inspect().children.find(w=>w.handle===handles.host)?.visible).toBe(true);
  await expect.poll(()=>inspect().controlsWindow.visible).toBe(true);
  // Scroll the actual app container: top clipping must follow the sticky header.
  await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='test-scroll-space';spacer.style.height='1500px';document.querySelector('.player-shell').append(spacer);document.getElementById('app-scroll-area').scrollTop=220;});
  await expect.poll(()=>inspect().children.find(w=>w.handle===handles.host)?.y).toBeLessThan(host.y);
  await expect.poll(()=>inspect().children.find(w=>w.handle===handles.host)?.clipTop).toBeGreaterThan(0);
  await page.evaluate(()=>{document.getElementById('app-scroll-area').scrollTop=0;document.getElementById('test-scroll-space').remove();});
  await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer='));main.setContentSize(1000,600);main.setPosition(150,90);});
  await call('window','pure');await expect.poll(async()=>(await state()).pure).toBe(true);
  await expect.poll(()=>page.locator('.native-embedded-page').getAttribute('class')).toContain('is-pure-playback');
  await expect.poll(async()=>Math.abs((await page.getByLabel('MPV 原生播放区域').boundingBox()).y)).toBeLessThan(2);
  const assertPureViewport=async()=>{
    await expect.poll(async()=>page.getByLabel('MPV 原生播放区域').evaluate(element=>{const b=element.getBoundingClientRect();return Math.max(Math.abs(b.x),Math.abs(b.y),Math.abs(b.width-innerWidth),Math.abs(b.height-innerHeight));})).toBeLessThan(2);
    await expect.poll(()=>{const windows=inspect(),host=windows.children.find(w=>w.handle===handles.host),video=windows.children.find(w=>w.className==='mpv');return Math.max(Math.abs(video.x-host.x),Math.abs(video.y-host.y),Math.abs(video.width-host.width),Math.abs(video.height-host.height));}).toBeLessThan(3);
  };
  await assertPureViewport();
  const dimensions=await overlay.evaluate(()=>({width:innerWidth,height:innerHeight}));
  await overlay.mouse.move(dimensions.width*.7,dimensions.height*.35);await overlay.mouse.wheel(0,-100);
  await expect.poll(async()=>(await state()).properties['video-zoom']).toBeGreaterThan(0);
  await overlay.mouse.move(dimensions.width*.3,dimensions.height*.35);await overlay.mouse.wheel(0,100);
  for(const key of ['video-zoom','video-pan-x','video-pan-y'])await expect.poll(async()=>Math.abs(Number((await state()).properties[key]))).toBe(0);
  await visibleEvidence('pure-controls');
  if(index&&item.duration>60){await call('seek',57);await expect.poll(async()=>(await state()).pendingSeek,{timeout:30000}).toBe(null);await visibleEvidence('pure-original-57s');}
  // The DOM rect stays identical during a window move. Hold a completed native
  // layout reply in flight, move again, and require the final placement to win.
  await desktop.evaluate((_,root)=>{
    const load=process.getBuiltinModule('module').createRequire(root+'/package.json');
    const {NativePlayer}=load(root+'/electron/dist/nativePlayer.js'),original=NativePlayer.prototype.api;
    globalThis.__layoutHeld=false;globalThis.__layoutReleased=false;globalThis.__holdLayout=true;globalThis.__embedCalls=0;
    NativePlayer.prototype.api=async function(route,...args){if(route.endsWith('/embed'))globalThis.__embedCalls++;const result=await original.call(this,route,...args);if(globalThis.__holdLayout&&route.endsWith('/embed')){globalThis.__holdLayout=false;globalThis.__layoutHeld=true;await new Promise(resolve=>setTimeout(resolve,300));globalThis.__layoutReleased=true;}return result;};
  },root);
  await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer='));const [x,y]=main.getPosition();main.setPosition(x+5,y+5);});
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__layoutHeld)).toBe(true);
  await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer='));const [x,y]=main.getPosition();main.setPosition(x+25,y+15);});
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__layoutReleased)).toBe(true);
  await expect.poll(()=>desktop.evaluate(()=>globalThis.__embedCalls)).toBeGreaterThanOrEqual(2);
  await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer=')),overlay=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('nativePlayer='));const a=main.getContentBounds(),b=overlay.getBounds();return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));})).toBeLessThan(3);
  await assertPureViewport();
  await call('rotate',90);
  await expect.poll(async()=>{const v=(await state()).properties['video-params'];return v?.rotate;}).toBe(90);
  await expect.poll(()=>page.evaluate(()=>Math.abs(innerWidth/innerHeight-9/16))).toBeLessThan(.005);
  await assertPureViewport();
  await visibleEvidence('pure-rotated-controls');
  await call('rotate',0);
  await expect.poll(()=>page.evaluate(()=>Math.abs(innerWidth/innerHeight-16/9))).toBeLessThan(.005);
  await assertPureViewport();
  await call('window','maximize');assert.equal((await state()).maximized,true);
  const expanded=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer=')).getContentBounds());assert.ok(Math.abs(expanded.width/expanded.height-16/9)<.02,'pure expand keeps video aspect');
  await call('window','maximize');assert.equal((await state()).maximized,false);
  const position=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer=')).getPosition());
  await call('window-drag',{phase:'start',x:100,y:100});await call('window-drag',{phase:'move',x:125,y:118});await call('window-drag',{phase:'end',x:125,y:118});
  const dragged=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer=')).getPosition());assert.deepEqual(dragged,[position[0]+25,position[1]+18]);
  await call('window','pure');await expect.poll(async()=>(await state()).pure).toBe(false);
  await call('window','fullscreen');await expect.poll(async()=>(await state()).fullscreen).toBe(true);
  await expect(page.locator('.native-embedded-page')).toHaveClass(/native-embedded-fullscreen/);
  await expect(page.locator('.desktop-titlebar')).toBeHidden();
  await expect.poll(async()=>page.getByLabel('MPV 原生播放区域').evaluate(element=>{const b=element.getBoundingClientRect();return Math.max(Math.abs(b.x),Math.abs(b.y),Math.abs(b.width-innerWidth),Math.abs(b.height-innerHeight));})).toBeLessThan(2);
  await visibleEvidence('fullscreen-controls');
  await call('window','fullscreen');await expect.poll(async()=>(await state()).fullscreen).toBe(false);
  await expect(page.locator('.native-embedded-page')).not.toHaveClass(/native-embedded-fullscreen/);
  await expect(page.locator('.desktop-titlebar')).toBeVisible();
  assert.equal((await state()).sourceLoads,1,'layout, dialogs, scrolling and window modes must not reopen the source');
  // Read-only inventory of actual attached displays. A single monitor run is
  // explicitly not a mixed-DPI desktop certification.
  const displays=await desktop.evaluate(({screen})=>screen.getAllDisplays().map(d=>({bounds:d.bounds,workArea:d.workArea,scale:d.scaleFactor})));
  const displayValidation={displays,physicalMixedDpi:displays.length>1&&new Set(displays.map(d=>d.scale)).size>1,checked:[]};
  for(const display of displays){
    await desktop.evaluate(({BrowserWindow},work)=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer='));main.setBounds({x:work.x+20,y:work.y+20,width:Math.min(900,work.width-40),height:Math.min(600,work.height-40)});},display.workArea);
    await expect.poll(()=>inspect().hostWindow.dpi).toBe(Math.round(display.scale*96));
    await expect.poll(()=>{const windows=inspect(),host=windows.children.find(w=>w.handle===handles.host);return host?.dpi===windows.hostWindow.dpi&&windows.controlsWindow.dpi===host.dpi;}).toBe(true);
    displayValidation.checked.push(display.scale);
  }
  for(let move=0;move<20;move++){
    await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer='));const [x,y]=main.getPosition();main.setPosition(x+1,y);});
    await overlay.waitForTimeout(35);
  }
  const diagnostics=await call('diagnostics');
  assert.ok(diagnostics.processMemory.processes.some(row=>row.role==='library-renderer'&&row.workingSetKiB>0));
  assert.ok(diagnostics.processMemory.processes.some(row=>row.role==='controls-renderer'&&row.workingSetKiB>0));
  assert.ok(diagnostics.recentLayouts.length>0&&diagnostics.recentLayouts.length<=16);
  assert.equal(diagnostics.displays.length,displays.length);
  assert.ok(!JSON.stringify(diagnostics).includes(source),'layout history excludes source paths');
  assert.equal((await state()).sourceLoads,1,'display moves and bounded diagnostics must retain the same decoder source');
  await desktop.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer='));main.show();main.setAlwaysOnTop(true);main.focus();});
  await overlay.waitForTimeout(200);
  const visual=await nativeVisualEvidence(desktop,path.join(data,'embedded-display.png'),'main');
  if(process.env.AVHUB_NATIVE_LAYER_DIAGNOSTIC==='1'){
    await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('nativePlayer=')).hide());
    await page.waitForTimeout(200);
    const noControls=await nativeVisualEvidence(desktop,path.join(data,'without-controls.png'),'main');
    console.log('Native layer isolation:',JSON.stringify({visual,noControls}));
    await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('nativePlayer=')).showInactive());
  }
  if(process.env.AVHUB_REQUIRE_VISIBLE_NATIVE==='1')assert.equal(visual.status,'pattern-visible',JSON.stringify(visual));
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.avhubDesktop.nativePlayer('status')).then(value=>value.active)).toBe(false);
  assert.deepEqual(identity(),before);assert.deepEqual(errors,[]);
  writeFileSync(path.join(data,'acceptance.json'),JSON.stringify({embedded:true,sample:index?'explicit read-only real media':'generated H.264 MKV',mediaId:index?mediaId:undefined,initial,visual,visuals,displayValidation,diagnostics,sourceUnchanged:true,errors},null,2));
  console.log('Embedded native acceptance passed:',data);
}catch(error){if(desktop)writeFileSync(path.join(data,'failure.txt'),String(error)+'\n'+await Promise.all(desktop.windows().map(w=>w.locator('body').innerText().catch(()=>''))));throw error;}
finally{if(desktop)await desktop.close().catch(()=>{});}
