// Renderer-only lifecycle race harness; not native decoding/performance acceptance.
import {test,expect} from '@playwright/test';
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
