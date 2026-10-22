// Explicit settings/preload contract harness; does not claim native decoding.
import {test,expect} from '@playwright/test';
for(const packaged of [true,false])test(`MPV unavailable message matches packaged=${packaged}`,async({page,request})=>{
 await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{playerEngine:'mpv'}}});
 await page.addInitScript(packaged=>{const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).avhubDesktop={nativePlayer:async()=>({available:false,packaged}),getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>state};},packaged);
 await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
 await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
 const panel=page.getByRole('region',{name:'播放引擎设置'});
 await expect(panel).toContainText(packaged?'当前桌面包未提供可用':'开发环境尚未准备');
 if(packaged)await expect(panel).not.toContainText('scripts/prepare-mpv.ps1');
 else await expect(panel).toContainText('scripts/prepare-mpv.ps1');
 await panel.getByRole('button',{name:'改用现有播放器'}).click();
 await expect(panel.getByRole('combobox',{name:'默认播放引擎'})).toHaveValue('chromium');
 expect((await(await request.get('/api/preferences')).json()).values.playerEngine).toBe('chromium');
});
