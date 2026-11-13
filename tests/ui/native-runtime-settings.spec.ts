// Renderer settings harness; actual binary verification is tested in Electron.
import {test,expect} from '@playwright/test';
test('runtime failure can be rechecked in place without overwriting playback preference',async({page,request})=>{
 await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{playerEngine:'chromium'}}});
 await page.addInitScript(()=>{
  Object.assign(window,{__runtimeAvailable:false,__runtimeChecks:0});
  const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};
  window.avhubDesktop={onWindowStateChanged:()=>()=>{},getWindowState:async()=>state,setWindowMode:async()=>state,nativePlayer:async action=>{if(action==='status'){(window as any).__runtimeChecks++;return {available:(window as any).__runtimeAvailable,packaged:true,reason:'MPV 运行库校验失败'};}return {};},onNativeState:()=>()=>{},onNativeClosed:()=>()=>{}} as any;
 });
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'MPV 运行库校验失败'})).toBeVisible();
 await expect(page.getByLabel('默认播放引擎',{exact:true}).locator('option[value="mpv"]')).toHaveJSProperty('disabled',true);
 await page.evaluate(()=>{(window as any).__runtimeAvailable=true;});await page.getByRole('button',{name:'重新检测',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'MPV 运行库已验证'})).toBeVisible();
 await expect(page.getByLabel('默认播放引擎',{exact:true}).locator('option[value="mpv"]')).toHaveJSProperty('disabled',false);
 expect((await(await request.get('/api/preferences')).json()).values.playerEngine).toBe('chromium');
 await page.getByLabel('默认播放引擎',{exact:true}).selectOption('mpv');
 await expect(page.getByLabel('MPV 播放窗口',{exact:true})).toHaveValue('independent');
 expect((await(await request.get('/api/preferences')).json()).values.mpvWindowMode).toBe('independent');
 await expect(page.getByLabel('MPV 播放窗口',{exact:true}).locator('option[value="independent"]')).toHaveText('独立窗口（推荐）');
 await page.getByLabel('MPV 播放窗口',{exact:true}).selectOption('embedded');
 await page.getByLabel('默认播放引擎',{exact:true}).selectOption('chromium');
 await page.getByLabel('默认播放引擎',{exact:true}).selectOption('mpv');
 await expect(page.getByLabel('MPV 播放窗口',{exact:true})).toHaveValue('embedded');
 expect((await(await request.get('/api/preferences')).json()).values.mpvWindowMode).toBe('embedded');
});

test('display choices save together, preserve legacy preference and roll back failed saves',async({page,request})=>{
 await request.post('/test/reset');
 await request.patch('/api/preferences',{data:{values:{playerEngine:'mpv',mpvWindowMode:'embedded',nativeRenderEnabled:false}}});
 await page.addInitScript(()=>{
  const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};
  Reflect.set(window,'avhubDesktop',{nativePlayer:async()=>({available:true,packaged:true}),renderPlayer:async()=>({available:true,runtime:'libmpv · D3D11'}),onNativeState:()=>()=>{},onNativeClosed:()=>()=>{},onWindowStateChanged:()=>()=>{},getWindowState:async()=>state,setWindowMode:async()=>state});
 });
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 const select=page.getByLabel('MPV 播放窗口',{exact:true});await expect(select).toHaveValue('embedded');
 await select.selectOption('d3d11');await expect(select).toHaveValue('d3d11');
 let saved=(await(await request.get('/api/preferences')).json()).values;
 expect(saved.nativeRenderEnabled).toBe(true);expect(saved.mpvWindowMode).toBe('embedded');
 await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 await expect(select).toHaveValue('d3d11');
 await page.route('**/api/preferences',async route=>{
  if(route.request().method()==='PATCH')await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({detail:'display save failed'})});else await route.continue();
 });
 await select.selectOption('independent');await expect(page.getByRole('alert').filter({hasText:'display save failed'})).toBeVisible();
 await expect(select).toHaveValue('d3d11');saved=(await(await request.get('/api/preferences')).json()).values;
 expect(saved.nativeRenderEnabled).toBe(true);expect(saved.mpvWindowMode).toBe('embedded');
 await page.unroute('**/api/preferences');await select.selectOption('independent');await expect(select).toHaveValue('independent');
 saved=(await(await request.get('/api/preferences')).json()).values;expect(saved.nativeRenderEnabled).toBe(false);expect(saved.mpvWindowMode).toBe('independent');
});
