// Renderer-only lifecycle race harness; not native decoding/performance acceptance.
import {test,expect} from '@playwright/test';
import {revealPlayerControls} from './player-pointer';
test.beforeEach(async({page,request})=>{
 await request.post('/test/reset');
 await request.patch('/api/preferences',{data:{values:{playerEngine:'mpv',resumeBehavior:'restart',autoNext:true,queueMode:'repeat-one'}}});
 await page.addInitScript(()=>{
  let events:(event:any)=>void=()=>{},closed:(event:any)=>void=()=>{},opens=0;
  const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};
  (window as any).__launchCommands=[];
  window.avhubDesktop={
   onWindowStateChanged:()=>()=>{},getWindowState:async()=>state,setWindowMode:async()=>state,
   onNativeClosed:callback=>{closed=callback;return()=>{};},onNativeEvent:callback=>{events=callback;(window as any).__emitNativeEvent=callback;return()=>{};},
   onNativeState:callback=>{(window as any).__emitNativeState=callback;return()=>{};},
   nativePlayer:async(action:string,input:any)=>{
    (window as any).__launchCommands.push({action,input});
     const closeDelay=Number(Reflect.get(window,'__closeDelay')??0);
     if(action==='close'&&closeDelay){Reflect.set(window,'__closeStarted',true);await new Promise(resolve=>setTimeout(resolve,closeDelay));}
    if(action==='status')return {available:!(window as any).__nativeUnavailable};
    if(action==='snapshot'&&(window as any).__snapshotPosition!==undefined)return {session:'launch-fixture',properties:{'time-pos':(window as any).__snapshotPosition}};
    if(action==='open'){
     const delay=(window as any).__nextOpenDelay;if(delay){(window as any).__nextOpenDelay=0;await new Promise(resolve=>setTimeout(resolve,delay));}
     await new Promise(resolve=>setTimeout(resolve,50));
     const value={session:(window as any).__uniqueOpen&&opens++>0?'launch-fixture-'+opens:'launch-fixture',mediaId:3,kind:'ended'};
     if((window as any).__earlyClose)closed(value);else if(!(window as any).__independent&&!(window as any).__suppressEarlyEvents)events(value);
     await new Promise(resolve=>setTimeout(resolve,50));
     return {session:value.session,presentation:(window as any).__independent?'independent':undefined};
    }
    if((action==='close'||action==='discard-close')&&(window as any).__recovery)closed({session:input,mediaId:3});
    return {ok:true};
   },
  } as any;
 });
});

test('quit during native Back waits for the same close task instead of flushing a closing session',async({page})=>{
 await page.addInitScript(()=>Object.assign(window,{__independent:true,__suppressEarlyEvents:true,__closeDelay:300}));
 await page.goto('/?video=3');await expect(page.locator('.native-embedded-caption')).toContainText('MPV');
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__closeStarted'))).toBe(true);
 const result=await page.evaluate(async()=>{
  const tasks:Promise<boolean>[]=[];window.dispatchEvent(new CustomEvent('avhub-before-quit',{detail:tasks}));
  const saved=await Promise.all(tasks);
  return {saved,commands:(Reflect.get(window,'__launchCommands') as {action:string}[]).map(command=>command.action)};
 });
 expect(result.saved.every(value=>value!==false)).toBe(true);
 expect(result.commands.filter(action=>action==='close')).toHaveLength(1);
 expect(result.commands).not.toContain('flush');
});

for(const mode of ['embedded','independent'])test(`${mode} retry resumes the most recent native position instead of the initial start`,async({page})=>{
 await page.addInitScript(mode=>Object.assign(window,{__independent:mode==='independent',__recovery:true,__uniqueOpen:true,__suppressEarlyEvents:true}),mode);
 await page.goto('/?video=3');await expect(page.locator('.native-embedded-caption')).toContainText('MPV');
 await page.evaluate(mode=>{
  (window as any).__emitNativeState({session:'launch-fixture',presentation:mode,revision:1,phase:'error',error:'测试解码异常',properties:{'time-pos':12}});
  (window as any).__snapshotPosition=17;
 },mode);
 await page.getByRole('button',{name:'重试原生播放',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__launchCommands.filter((v:any)=>v.action==='open').length)).toBe(2);
 expect(await page.evaluate(()=>(window as any).__launchCommands.filter((v:any)=>v.action==='open')[1].input.start)).toBe(17);
});

test('explicit engine round-trip keeps the current position and original quality without changing global defaults',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false}}});
 await page.addInitScript(()=>{Object.assign(window,{__independent:true,__recovery:true,__suppressEarlyEvents:true});});
 const attempts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/media/2/playback'))attempts.push(r.postDataJSON());});
 await page.goto('/?video=2');
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.paused&&v.currentTime>.2)).toBe(true);
 await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.currentTime=2;});
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>!v.seeking&&v.readyState>=2&&v.currentTime>=2)).toBe(true);
 await page.locator('.playback-diagnostics summary').click();
 await page.getByRole('button',{name:'使用 MPV 原画播放',exact:true}).click();
 await expect(page.getByRole('heading',{name:'正在独立窗口播放',exact:true})).toBeVisible();
 const open=await page.evaluate(()=>(window as any).__launchCommands.find((c:any)=>c.action==='open'));
 expect(open.input.mediaId).toBe(2);expect(open.input.start).toBeGreaterThanOrEqual(2);expect(open.input.start).toBeLessThan(5);
 expect((await(await request.get('/api/preferences')).json()).values.playerEngine).toBe('chromium');
 // The stub does not own a real decoder; simulate its durable close position.
 await request.put('/api/media/2/progress',{data:{progress:4,watched:false,updated_at:Date.now()+1000}});
 await page.getByRole('button',{name:'切换现有播放器',exact:true}).click();
 await expect.poll(()=>attempts.length).toBe(2);
 expect(attempts[1]).toMatchObject({start:4,prefer_original:true,force_transcode:false,quality:'auto'});
 expect(attempts[1].allow_video_transcode).not.toBe(true);expect(attempts[1].allow_audio_transcode).not.toBe(true);
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.currentTime>=4)).toBe(true);
 expect((await(await request.get('/api/preferences')).json()).values.resumeBehavior).toBe('restart');
});

test('failed progress save blocks engine hand-off and keeps the current player',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false}}});
 await page.goto('/?video=2');
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.currentTime>.2)).toBe(true);
 await page.route('**/api/media/2/progress',route=>route.fulfill({status:503,json:{detail:'isolated progress failure'}}));
 await page.locator('.playback-diagnostics summary').click();await page.getByRole('button',{name:'使用 MPV 原画播放',exact:true}).click();
 await expect(page.getByText(/进度未保存：/)).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__launchCommands.filter((c:any)=>c.action==='open').length)).toBe(0);
 await expect(page.locator('video')).toHaveCount(1);await expect(page.getByRole('button',{name:'使用 MPV 原画播放',exact:true})).toBeEnabled();
});

test('unsaved speed preference blocks engine hand-off instead of silently reverting playback settings',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false,playbackSpeed:1}}});
 await page.goto('/?video=2');
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.currentTime>.2)).toBe(true);
 await page.route('**/api/preferences',route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{detail:'isolated preference failure'}}):route.continue());
 await revealPlayerControls(page);await page.getByRole('button',{name:'倍速',exact:true}).click();await page.getByRole('combobox',{name:'倍速',exact:true}).selectOption('1.5');
 await page.locator('.playback-diagnostics summary').click();await page.getByRole('button',{name:'使用 MPV 原画播放',exact:true}).click();
 await expect(page.getByText('暂未切换播放器：播放设置尚未保存',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__launchCommands.filter((c:any)=>c.action==='open').length)).toBe(0);
 expect((await(await request.get('/api/preferences')).json()).values.playbackSpeed).toBe(1);
});

test('unavailable native runtime does not offer an unusable original-quality hand-off',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false}}});
 await page.addInitScript(()=>{(window as any).__nativeUnavailable=true;});await page.goto('/?video=2');
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.currentTime>.2)).toBe(true);
 await page.locator('.playback-diagnostics summary').click();await expect(page.getByRole('button',{name:'使用 MPV 原画播放',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__launchCommands.some((c:any)=>c.action==='status'))).toBe(true);
});

test('engine hand-off protects unsaved media edits and cancellation leaves the draft intact',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{playerEngine:'chromium',resumeBehavior:'restart',autoNext:false}}});
 await page.goto('/?video=2');
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&v.currentTime>.2)).toBe(true);
 await page.locator('.media-editor summary').click();await page.getByRole('textbox',{name:'显示标题',exact:true}).fill('未保存的本次草稿');
 await page.locator('.playback-diagnostics summary').click();await page.getByRole('button',{name:'使用 MPV 原画播放',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true});await expect(confirmation).toBeVisible();
 await confirmation.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'显示标题',exact:true})).toHaveValue('未保存的本次草稿');
 expect(await page.evaluate(()=>(window as any).__launchCommands.filter((c:any)=>c.action==='open').length)).toBe(0);
 await expect(page.getByRole('button',{name:'使用 MPV 原画播放',exact:true})).toBeEnabled();
});

test('retry hand-off keeps Back disabled until the replacement session attaches, then returns cleanly',async({page})=>{
 await page.addInitScript(()=>{Object.assign(window,{__independent:true,__recovery:true,__uniqueOpen:true,__suppressEarlyEvents:true});});
 await page.goto('/?video=3');await expect(page.getByRole('heading',{name:'正在独立窗口播放',exact:true})).toBeVisible();
 await page.evaluate(()=>{
  (window as any).__emitNativeState({session:'launch-fixture',presentation:'independent',revision:1,phase:'error',error:'音频输出设备初始化失败',properties:{}});
  (window as any).__nextOpenDelay=600;
 });
 await page.getByRole('button',{name:'重试原生播放',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__launchCommands.filter((c:any)=>c.action==='open').length)).toBe(2);
 const back=page.getByRole('button',{name:'返回媒体库',exact:true});await expect(back).toBeDisabled();
 await expect(back).toBeEnabled();
 // The long-lived native event listener must use a fresh attempt generation,
 // even when the first retry came from a normal React button.
 await page.evaluate(()=>{
  (window as any).__emitNativeState({session:'launch-fixture-2',presentation:'independent',revision:1,phase:'error',error:'音频输出设备初始化失败',properties:{}});
  (window as any).__emitNativeEvent({session:'launch-fixture-2',kind:'retry'});
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).__launchCommands.filter((c:any)=>c.action==='open').length)).toBe(3);
 await expect(back).toBeEnabled();await back.click();await expect(page.locator('.player-shell')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__launchCommands.some((c:any)=>c.action==='close'&&c.input==='launch-fixture-3'))).toBe(true);
});

for(const presentation of ['embedded','independent'])test(`${presentation} audio output failure offers explicit original-file retry and ignores the retired session`,async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{mpvWindowMode:presentation}}});
 await page.addInitScript(mode=>{Object.assign(window,{__independent:mode==='independent',__recovery:true,__uniqueOpen:true,__suppressEarlyEvents:true});},presentation);
 await page.goto('/?video=3');
 await expect(page.locator('.native-embedded-caption')).toContainText(presentation==='independent'?'独立窗口播放原文件':'原文件直接播放');
 await page.evaluate(mode=>(window as any).__emitNativeState({session:'launch-fixture',presentation:mode,revision:1,phase:'error',failureCode:'audio-output',firstFrameMs:null,error:'音频输出设备初始化失败，请检查 Windows 声音输出设备后重试；未自动静音或转换音频',properties:{}}),presentation);
 await expect(page.getByRole('alert')).toContainText('音频输出设备初始化失败');
 await expect(page.getByRole('button',{name:'重试原生播放',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__launchCommands.filter((c:any)=>c.action==='open').length)).toBe(1,'no automatic source reload or engine fallback');
 await page.evaluate(mode=>(window as any).__emitNativeState({session:'launch-fixture',presentation:mode,revision:2,phase:'error',failureCode:'audio-output',error:'音频输出设备初始化失败：已检测到声音输出设备，请重试原生播放',properties:{}}),presentation);
 await expect(page.getByRole('alert')).toContainText('已检测到声音输出设备');
 expect(await page.evaluate(()=>(window as any).__launchCommands.filter((c:any)=>c.action==='open').length)).toBe(1,'device arrival updates advice, never auto-reopens');
 await page.getByRole('button',{name:'重试原生播放',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__launchCommands.filter((c:any)=>c.action==='open').length)).toBe(2);
 await expect(page.locator('.native-embedded-caption')).toContainText(presentation==='independent'?'独立窗口播放原文件':'原文件直接播放');
 await page.evaluate(mode=>(window as any).__emitNativeState({session:'launch-fixture',presentation:mode,revision:999,phase:'error',error:'retired failure',properties:{}}),presentation);
 await expect(page.getByRole('alert')).toHaveCount(0);
 const commands=await page.evaluate(()=>(window as any).__launchCommands);
 const closeIndex=commands.findIndex((c:any)=>c.action==='close'&&c.input==='launch-fixture');
 const secondOpen=commands.findIndex((c:any,index:number)=>c.action==='open'&&index>closeIndex);
 expect(closeIndex).toBeGreaterThan(-1);expect(secondOpen).toBeGreaterThan(closeIndex);
 expect(commands.filter((c:any)=>c.action==='open').map((c:any)=>({mediaId:c.input.mediaId,start:c.input.start}))).toEqual([{mediaId:3,start:0},{mediaId:3,start:0}]);
});

test('stopped native player offers explicit save recovery rather than a phantom playing window',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{mpvWindowMode:'independent'}}});
 await page.addInitScript(()=>{(window as any).__independent=true;(window as any).__recovery=true;});await page.goto('/?video=3');
 await expect(page.getByRole('heading',{name:'正在独立窗口播放',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).__emitNativeState({session:'launch-fixture',presentation:'independent',revision:1,phase:'closed',stopped:true,recovery:'save',saveError:'播放进度尚未保存',properties:{'time-pos':12,duration:60,pause:false}}));
 await expect(page.getByRole('heading',{name:'播放窗口已关闭',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'恢复播放窗口',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'放弃未保存进度',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'放弃未保存的播放记录？',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'取消',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__launchCommands.some((c:any)=>c.action==='discard-close'))).toBe(false);
 await page.getByRole('button',{name:'重试保存并关闭',exact:true}).click();
 await expect(page.locator('.native-embedded-caption')).toContainText('原生播放已关闭');
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('successful persistence clears its own error and unknown events never navigate',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{mpvWindowMode:'independent'}}});
 await page.addInitScript(()=>{(window as any).__independent=true;});await page.goto('/?video=3');
 await expect(page.getByRole('heading',{name:'正在独立窗口播放',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).__emitNativeState({session:'launch-fixture',presentation:'independent',revision:1,saveError:'保存失败测试',properties:{}}));
 await expect(page.getByRole('alert')).toContainText('保存失败测试');
 await page.evaluate(()=>{
  (window as any).__emitNativeState({session:'launch-fixture',presentation:'independent',revision:2,saveError:'',properties:{}});
  (window as any).__emitNativeEvent({session:'launch-fixture',kind:'operation-status'});
 });
 await expect(page.getByRole('alert')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__launchCommands.some((c:any)=>c.action==='replay'||c.action==='close'))).toBe(false);
});
test('natural completion before open response is retained for repeat-one',async({page})=>{
 await page.goto('/?video=3');
 await expect.poll(()=>page.evaluate(()=>(window as any).__launchCommands.some((c:any)=>c.action==='replay'&&c.input==='launch-fixture'))).toBe(true);
});
test('close before open response leaves a retryable closed page, not a stale attached surface',async({page})=>{
 await page.addInitScript(()=>{(window as any).__earlyClose=true;});await page.goto('/?video=3');
 await expect(page.locator('.native-embedded-caption')).toContainText('原生播放已关闭');
 await expect(page.getByRole('button',{name:'重新播放',exact:true})).toBeVisible();
});

test('independent presentation skips embedding and rejects stale status revisions',async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{mpvWindowMode:'independent'}}});
 await page.addInitScript(()=>{(window as any).__independent=true;});await page.goto('/?video=3');
 await expect(page.getByRole('heading',{name:'正在独立窗口播放',exact:true})).toBeVisible();
 await page.evaluate(()=>{
  const emit=(window as any).__emitNativeState,session='launch-fixture';
  emit({session,presentation:'independent',revision:3,properties:{'time-pos':12,duration:60,pause:true}});
  emit({session,presentation:'independent',revision:2,properties:{'time-pos':3,duration:60,pause:false}});
 });
 await expect(page.locator('.native-independent-card')).toContainText('已暂停 · 00:12 / 01:00');
 expect(await page.evaluate(()=>(window as any).__launchCommands.some((c:any)=>c.action==='layout'))).toBe(false);
 await page.getByRole('button',{name:'保存截图',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__launchCommands.find((c:any)=>c.action==='screenshot').input)).toEqual({session:'launch-fixture'});
});
