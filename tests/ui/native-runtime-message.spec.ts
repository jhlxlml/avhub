// Explicit settings/preload contract harness; does not claim native decoding.
import {test,expect} from '@playwright/test';
for(const packaged of [true,false])test(`MPV unavailable message matches packaged=${packaged}`,async({page,request})=>{
 const startupErrors:string[]=[];page.on('pageerror',error=>startupErrors.push(error.message));
 await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{playerEngine:'mpv'}}});
 await page.addInitScript(packaged=>{const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).avhubDesktop={onNativeState:()=>()=>{},onNativeClosed:()=>()=>{},nativePlayer:async()=>({available:false,packaged}),getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>state};},packaged);
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
 await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 const panel=page.getByRole('region',{name:'播放引擎设置'});
 await expect(panel).toContainText(packaged?'请使用包含完整 MPV 运行库的桌面包':'开发环境可运行 npm run prepare:mpv');
 if(packaged)await expect(panel).not.toContainText('npm run prepare:mpv');
 else await expect(panel).toContainText('npm run prepare:mpv');
 await expect(panel.locator('option[value="mpv"]')).toHaveJSProperty('disabled',true);
 await panel.getByRole('button',{name:'改用现有播放器'}).click();
 await expect(panel.getByRole('combobox',{name:'默认播放引擎'})).toHaveValue('chromium');
 expect((await(await request.get('/api/preferences')).json()).values.playerEngine).toBe('chromium');
 expect(startupErrors).toEqual([]);
});
