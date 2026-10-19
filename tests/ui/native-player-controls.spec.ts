// Explicit renderer-only harness. No native decoding or performance claims.
import {test,expect} from '@playwright/test';
test.beforeEach(async({page,request})=>{
  await request.post('/test/reset');
  await page.addInitScript(()=>{
    let listener:((state:any)=>void)|undefined;
    const state={session:'fixture',title:'原生控制栏样本',phase:'ready',pure:false,pinned:false,fullscreen:false,maximized:false,pendingSeek:null,restarts:1,seeks:0,firstFrameMs:10,lastSeekMs:null,properties:{'time-pos':10,duration:100,pause:false,volume:80,mute:false,speed:1,'video-params':{w:640,h:360,dw:640,dh:360},'track-list':[]}};
    (window as any).__nativeCommands=[];
    (window as any).__failNativePlayback=()=>listener?.({...structuredClone(state),phase:'error',error:'音频输出设备初始化失败，请重试',failureCode:'audio-output'});
    (window as any).__emitNativeRevision=(revision:number,time:number,session='fixture')=>listener?.({...structuredClone(state),session,revision,properties:{...state.properties,'time-pos':time}});
    (window as any).__advanceNativeTime=(value:number)=>{state.properties['time-pos']=value;listener?.(structuredClone(state));};
    (window as any).__setNativeRotation=(angle:number)=>{(state.properties as any)['video-rotate']=angle;(state.properties['video-params'] as any).rotate=angle;listener?.(structuredClone(state));};
    window.avhubDesktop={
      nativePlayer:async(action:string,input:any)=>{
        if(action==='snapshot')return structuredClone(state);
        (window as any).__nativeCommands.push({action,input});
        if(action==='screenshot'){
          if((window as any).__blockCapture)await new Promise<void>(resolve=>{(window as any).__finishCapture=resolve;});
          if((window as any).__captureFailure)throw new Error('测试截图目录不可写');
          return {filename:'AVHub_native-fixture.png'};
        }
        if(action==='pause')state.properties.pause=input.value;
        if(action==='seek')state.properties['time-pos']=input.value;
        if(action==='seek-relative')state.properties['time-pos']=Math.max(0,Math.min(99.99,state.properties['time-pos']+input.value));
        if(action==='transform')Object.assign(state.properties,{'video-zoom':input.value.zoom,'video-pan-x':input.value.x,'video-pan-y':input.value.y});
        listener?.(structuredClone(state));return {ok:true};
      },onNativeState:callback=>{listener=callback;return()=>{listener=undefined;};},onMouseSeek:()=>()=>{},
    } as any;
  });
  await page.goto('/?nativePlayer=fixture');
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeAttached();
});

test('fatal native error has an accessible retry action on the video overlay',async({page})=>{
 await page.evaluate(()=>(window as any).__failNativePlayback());
 const retry=page.getByRole('button',{name:'重试原生播放',exact:true});await expect(retry).toBeVisible();
 await retry.hover();await page.waitForTimeout(500);await expect(page.locator('.native-stage')).not.toHaveClass(/cursor-hidden/);
 await retry.click();expect(await page.evaluate(()=>(window as any).__nativeCommands.some((c:any)=>c.action==='navigate'&&c.input.value==='retry'))).toBe(true);
});

test('hover keeps controls visible; keyboard does not reveal hidden controls',async({page})=>{
  await page.mouse.move(150,page.viewportSize()!.height-30);await expect(page.locator('.native-controls')).toHaveCSS('opacity','1');
  await page.waitForTimeout(700);await expect(page.locator('.native-controls')).toHaveCSS('opacity','1');
  await page.mouse.move(400,200);await expect(page.locator('.native-controls')).toHaveCSS('opacity','0');
  await page.keyboard.press('Space');await expect(page.getByRole('button',{name:'播放',exact:true})).toBeAttached();
  await expect(page.locator('.native-controls')).toHaveCSS('opacity','0');
  await expect(page.locator('.native-stage')).toHaveClass(/cursor-hidden/);
  await page.mouse.move(420,200);await expect(page.locator('.native-stage')).not.toHaveClass(/cursor-hidden/);
});

test('mouse slider focus preserves shortcuts; only C captures; wheel zoom never scrolls',async({page})=>{
  await page.mouse.move(200,page.viewportSize()!.height-30);
  const slider=page.getByRole('slider',{name:'播放进度',exact:true});await slider.click({position:{x:100,y:8}});
  await page.keyboard.press('Space');await expect(page.getByRole('button',{name:'播放',exact:true})).toBeAttached();
  await expect(slider).toHaveCSS('outline-style','none');
  await page.mouse.move(400,200);await page.mouse.wheel(0,-100);
  await expect.poll(()=>page.evaluate(()=>(window as any).__nativeCommands.some((c:any)=>c.action==='transform'&&c.input.value.zoom>0))).toBe(true);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  await page.keyboard.press('Shift+C');await page.keyboard.press('c');
  await expect.poll(()=>page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='screenshot').length)).toBe(1);
});

test('held pause shortcut toggles once and an open settings panel blocks shortcuts',async({page})=>{
  await page.keyboard.down('Space');await page.keyboard.down('Space');await page.keyboard.up('Space');
  expect(await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='pause').length)).toBe(1);
  await page.mouse.move(200,page.viewportSize()!.height-30);
  await page.getByRole('button',{name:'播放设置与信息',exact:true}).click();
  await page.keyboard.press('k');
  expect(await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='pause').length)).toBe(1);
  await page.keyboard.press('Escape');await expect(page.locator('.native-panel')).toHaveCount(0);
});

test('composition, text editing and menu focus never leak player shortcuts',async({page})=>{
  await page.evaluate(()=>{
    document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',isComposing:true,bubbles:true}));
    const menu=document.createElement('div');menu.setAttribute('role','menu');menu.tabIndex=0;document.body.append(menu);menu.focus();
  });
  await page.keyboard.press('k');await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>(window as any).__nativeCommands)).toHaveLength(0);
  await page.evaluate(()=>{document.querySelector('[role=menu]')?.remove();const input=document.createElement('input');document.body.append(input);input.focus();});
  await page.keyboard.press('Space');await page.keyboard.press('c');
  expect(await page.evaluate(()=>(window as any).__nativeCommands)).toHaveLength(0);
});

test('Tab restores native slider arrows; mouse-focused arrows remain player seek',async({page})=>{
  await page.mouse.move(200,page.viewportSize()!.height-30);
  const slider=page.getByRole('slider',{name:'播放进度',exact:true});await slider.click({position:{x:100,y:8}});
  await page.keyboard.press('ArrowRight');
  await expect.poll(()=>page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>['seek','seek-relative'].includes(c.action)).length)).toBe(2);
  const before=Number(await slider.inputValue());
  await page.keyboard.press('Tab');await slider.focus();await page.keyboard.press('ArrowRight');
  const after=await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='seek').at(-1).input.value);
  expect(after-before).toBeCloseTo(.01,3);
});

test('rapid keys submit relative intent instead of duplicate stale absolute targets',async({page})=>{
 await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 const commands=await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action.startsWith('seek')));
 expect(commands.map((c:any)=>({action:c.action,value:c.input.value}))).toEqual([{action:'seek-relative',value:5},{action:'seek-relative',value:5}]);
});

test('native subtitle tools and queue use restricted intents and existing visual controls',async({page})=>{
  await page.mouse.move(200,page.viewportSize()!.height-30);
  await page.getByRole('button',{name:'待播队列',exact:true}).click();
  await page.getByRole('button',{name:'播放设置与信息',exact:true}).click();
  await page.getByRole('combobox',{name:'字幕字号',exact:true}).selectOption('34');
  await page.getByRole('button',{name:'加载外挂字幕',exact:true}).click();
  const commands=await page.evaluate(()=>(window as any).__nativeCommands);
  expect(commands.some((c:any)=>c.action==='navigate'&&c.input.value==='queue')).toBe(true);
  expect(commands.some((c:any)=>c.action==='subtitle-style'&&c.input.value.size===34)).toBe(true);
  expect(commands.some((c:any)=>c.action==='subtitle-import'&&c.input.value===undefined)).toBe(true);
  await page.keyboard.press('Escape');await page.mouse.move(400,200);await page.keyboard.press('p');
  await expect(page.getByText('原生播放暂不支持画中画，可在媒体页切回现有播放器')).toBeVisible();
});

test('short-window settings scroll independently without zooming the video',async({page})=>{
  await page.setViewportSize({width:800,height:500});await page.mouse.move(250,470);
  await page.getByRole('button',{name:'播放设置与信息',exact:true}).click();
  const panel=page.locator('.native-panel');await expect(panel).toBeVisible();
  const box=await panel.boundingBox();await page.mouse.move(box!.x+100,box!.y+100);await page.mouse.wheel(0,500);
  await expect.poll(()=>panel.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='transform'))).toHaveLength(0);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
});

test('zoom origin uses effective rotation once, not source plus user twice',async({page})=>{
  await page.evaluate(()=>(window as any).__setNativeRotation(90));
  await page.mouse.move(650,300);await page.mouse.wheel(0,-100);
  const expected=(300-425)/850*(1/1.1-1);
  await expect.poll(()=>page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='transform').at(-1)?.input.value.y)).toBeCloseTo(expected,4);
  // Portrait image remains narrower than this landscape viewport: keep that
  // axis centred rather than adding an asymmetric letterbox through panning.
  expect(await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='transform').at(-1)?.input.value.x)).toBe(0);
});

test('zooming out at a different origin recentres at 1x and dragging never exposes empty edges',async({page})=>{
  const transform=()=>page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='transform').at(-1)?.input.value);
  await page.mouse.move(1000,250);await page.mouse.wheel(0,-100);
  await expect.poll(transform).toHaveProperty('zoom');
  await page.mouse.down();await page.mouse.move(1400,700,{steps:4});await page.mouse.up();
  await expect.poll(async()=>Math.abs((await transform()).x)).toBeLessThanOrEqual((1-1/1.1)/2+1e-6);
  await expect.poll(async()=>Math.abs((await transform()).y)).toBeLessThanOrEqual((1-1/1.1)/2+1e-6);
  await page.mouse.move(400,250);await page.mouse.wheel(0,100);
  await expect.poll(transform).toEqual({zoom:0,x:0,y:0});
  await page.mouse.move(850,300);await page.mouse.wheel(0,100);
  await expect.poll(transform).toEqual({zoom:0,x:0,y:0});
});

for(const theme of ['light','dark'])test(`native overlay stays transparent with full-size icons in ${theme} theme`,async({page})=>{
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.mouse.move(250,page.viewportSize()!.height-30);
  for(const selector of ['html','body','#root','.native-stage','.native-top'])await expect(page.locator(selector)).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.locator('.native-top')).toHaveCSS('height','40px');
  await expect(page.locator('.native-top')).toHaveCSS('border-bottom-width','0px');
  const capture=page.getByRole('button',{name:'截图（C）',exact:true});
  await expect(capture).toHaveCSS('padding','0px');await expect(capture.locator('svg')).toHaveCSS('width','18px');
});

test('capture click shows pending, prevents duplicate C requests and reports real success or failure',async({page})=>{
  await page.evaluate(()=>(window as any).__blockCapture=true);
  await page.mouse.move(250,page.viewportSize()!.height-30);
  const capture=page.getByRole('button',{name:'截图（C）',exact:true});await capture.click();
  await expect(capture).toBeDisabled();await expect(capture).toHaveAttribute('aria-busy','true');
  await expect(page.getByText('正在保存原分辨率截图…',{exact:true})).toBeVisible();
  await page.keyboard.press('c');await page.keyboard.press('c');
  expect(await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='screenshot').length)).toBe(1);
  await page.evaluate(()=>{(window as any).__blockCapture=false;(window as any).__finishCapture();});
  await expect(capture).toBeEnabled();await expect(page.getByText('截图已保存：AVHub_native-fixture.png',{exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).__captureFailure=true);await capture.click();
  await expect(page.getByText('测试截图目录不可写',{exact:true})).toBeVisible();await expect(capture).toBeEnabled();
});

test('timeline drag commits one exact target on release; cancellation never seeks',async({page})=>{
 await page.mouse.move(200,page.viewportSize()!.height-30);
 const slider=page.getByRole('slider',{name:'播放进度',exact:true}),box=await slider.boundingBox();expect(box).not.toBeNull();
 await page.mouse.move(box!.x+box!.width*.2,box!.y+box!.height/2);await page.mouse.down();
 for(const part of [.3,.4,.6,.8])await page.mouse.move(box!.x+box!.width*part,box!.y+box!.height/2);
 const target=Number(await slider.inputValue());
 expect(await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='seek'))).toHaveLength(0);
 await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='seek').length)).toBe(1);
 expect(await page.evaluate(()=>(window as any).__nativeCommands.find((c:any)=>c.action==='seek').input.value)).toBe(target);
 await page.mouse.move(box!.x+box!.width*.4,box!.y+box!.height/2);await page.mouse.down();await page.mouse.move(box!.x+box!.width*.5,box!.y+box!.height/2);
 await slider.evaluate(el=>el.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));await page.mouse.up();
 expect(await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='seek'))).toHaveLength(1);
 await page.keyboard.press('Space');await expect(page.getByRole('button',{name:'播放',exact:true})).toBeAttached();
});

test('a missed slider keyup never freezes the displayed playback clock',async({page})=>{
 await page.keyboard.press('Tab');const slider=page.getByRole('slider',{name:'播放进度',exact:true});await slider.focus();
 await page.keyboard.down('ArrowRight');
 await slider.evaluate(el=>(el as HTMLInputElement).blur());await page.keyboard.up('ArrowRight');
 await page.evaluate(()=>(window as any).__advanceNativeTime(12));
 await expect(slider).toHaveValue('12');
 await expect(page.locator('.native-timeline time').first()).toHaveText('00:12');
});

test('late native change after pointer release cannot seek back to the old clock',async({page})=>{
 await page.mouse.move(200,page.viewportSize()!.height-30);
 const slider=page.getByRole('slider',{name:'播放进度',exact:true});await slider.click({position:{x:400,y:8}});
 const before=await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='seek'));
 expect(before).toHaveLength(1);
 await slider.evaluate(el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'10');el.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(await page.evaluate(()=>(window as any).__nativeCommands.filter((c:any)=>c.action==='seek'))).toHaveLength(1);
 await page.evaluate(()=>(window as any).__advanceNativeTime(40));await expect(slider).toHaveValue('40');
});

test('older snapshots and other sessions cannot overwrite newer playback state',async({page})=>{
 await page.evaluate(()=>{(window as any).__emitNativeRevision(2,40);(window as any).__emitNativeRevision(1,10);(window as any).__emitNativeRevision(99,90,'old-session');});
 await expect(page.getByRole('slider',{name:'播放进度',exact:true})).toHaveValue('40');
});
