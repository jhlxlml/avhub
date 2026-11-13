// Renderer/preference harness only, NOT native decoding or GPU acceptance.
import {test,expect} from '@playwright/test';

test('Chromium exposes default-off session coordination without changing its engine or old controller preference',async({page,request})=>{
 await request.post('/test/reset');await page.goto('/');
 await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await page.getByText('播放控制高级选项',{exact:true}).click();
 const toggle=page.getByRole('checkbox',{name:'增强会话管理（试验）',exact:true});await expect(toggle).not.toBeChecked();await toggle.click();await expect(toggle).toBeChecked();
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.playbackSessionCoordinatorEnabled).toBe(true);
 await expect(page.getByLabel('默认播放引擎',{exact:true})).toHaveValue('chromium');
 await expect(page.getByRole('checkbox',{name:'统一播放控制（试验）',exact:true})).not.toBeChecked();
});

test('session coordination stays default-off and can be explicitly enabled and rolled back durably',async({page,request})=>{
 await request.post('/test/reset');
 expect((await(await request.get('/api/preferences')).json()).values.playbackSessionCoordinatorEnabled).toBeUndefined();
 await page.addInitScript(()=>{
  const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};
  Reflect.set(window,'avhubDesktop',{nativePlayer:async()=>({available:true,packaged:true}),renderPlayer:async()=>({available:true}),onNativeState:()=>()=>{},onNativeClosed:()=>()=>{},getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state});
 });
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await page.getByText('播放控制高级选项',{exact:true}).click();
 await expect(page.getByLabel('默认播放引擎',{exact:true})).toHaveValue('chromium');
 await page.getByLabel('默认播放引擎',{exact:true}).selectOption('mpv');await page.getByLabel('MPV 播放窗口',{exact:true}).selectOption('d3d11');
 const toggle=page.getByRole('checkbox',{name:'增强会话管理（试验）',exact:true});await expect(toggle).not.toBeChecked();await toggle.click();await expect(toggle).toBeChecked();
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.playbackSessionCoordinatorEnabled).toBe(true);
 await page.reload();await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await page.getByText('播放控制高级选项',{exact:true}).click();await expect(toggle).toBeChecked();await toggle.click();await expect(toggle).not.toBeChecked();
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.playbackSessionCoordinatorEnabled).toBe(false);
 expect((await(await request.get('/api/preferences')).json()).values.playerEngine).toBe('mpv');
});

test('independent MPV exposes the same default-off session opt-in without enabling D3D11',async({page,request})=>{
 await request.post('/test/reset');
 await page.addInitScript(()=>{Reflect.set(window,'avhubDesktop',{nativePlayer:async()=>({available:true,packaged:true}),renderPlayer:async()=>({available:true}),onNativeState:()=>()=>{},onNativeClosed:()=>()=>{},getWindowState:async()=>({purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false}),onWindowStateChanged:()=>()=>{},setWindowMode:async()=>({purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false})});});
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await page.getByText('播放控制高级选项',{exact:true}).click();
 await page.getByLabel('默认播放引擎',{exact:true}).selectOption('mpv');await page.getByLabel('MPV 播放窗口',{exact:true}).selectOption('independent');
 const toggle=page.getByRole('checkbox',{name:'增强会话管理（试验）',exact:true});await expect(toggle).not.toBeChecked();await toggle.click();await expect(toggle).toBeChecked();
 await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.playbackSessionCoordinatorEnabled).toBe(true);
 expect((await(await request.get('/api/preferences')).json()).values.nativeRenderEnabled??false).toBe(false);
 await toggle.click();await expect(toggle).not.toBeChecked();await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.playbackSessionCoordinatorEnabled).toBe(false);
});
