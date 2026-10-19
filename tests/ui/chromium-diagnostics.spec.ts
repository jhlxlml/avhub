// Renderer-only harness: native collection/export is accepted in real Electron.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function install(page:any,outcome:'saved'|'pending'|'error'){
 await page.addInitScript(({outcome}:any)=>{
  const w=window as any;const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};
  w.__exports=[];w.__cancelled=0;
  w.avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>state,
   saveExport:async(value:any)=>{w.__exports.push(value);if(outcome==='error')throw new Error('诊断采集未完成，请重试');if(outcome==='pending')return new Promise(resolve=>{w.__cancelCapture=()=>resolve({cancelled:true});});return{id:'owned-export',path:'owned-diagnostic.json',bytes:123};},
   cancelExport:async()=>{w.__cancelled++;w.__cancelCapture?.();return{ok:true};},revealExport:async()=>({ok:true})};
 },{outcome});
}
for(const theme of ['dark','light'])test(`manual export uses desktop contract without changing source or speed (${theme})`,async({page},testInfo)=>{
 await install(page,'saved');await page.goto('/?q=003');
 await page.getByRole('button',{name:'播放 视频 003',exact:true}).click();
 if(theme==='light')await page.locator('.player-top').getByRole('button',{name:'切换至浅色模式',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2)).toBe(true);
 const before=await page.locator('video').evaluate((v:HTMLVideoElement)=>({src:v.currentSrc,rate:v.playbackRate}));
 await page.locator('.playback-diagnostics summary').click();
 await page.getByRole('button',{name:'采集并导出播放诊断（8 秒）',exact:true}).click();
 await expect(page.getByText('播放诊断已保存',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__exports)).toEqual([{kind:'playback-diagnostics'}]);
 expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>({src:v.currentSrc,rate:v.playbackRate}))).toEqual(before);
 await expect(page.locator('.playback-capture-toast')).toHaveCount(0);
 await page.locator('.playback-diagnostics').screenshot({path:testInfo.outputPath(`playback-diagnostics-${theme}.png`)});
});
test('capture can be cancelled in the video overlay and cancelled on leaving',async({page})=>{
 await install(page,'pending');await page.goto('/?q=003');await page.getByRole('button',{name:'播放 视频 003',exact:true}).click();
 await page.locator('.playback-diagnostics summary').click();await page.getByRole('button',{name:'采集并导出播放诊断（8 秒）',exact:true}).click();
 await page.locator('.playback-capture-toast').getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByText('已取消播放诊断',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'采集并导出播放诊断（8 秒）',exact:true}).click();
 await expect(page.locator('.playback-capture-toast')).toBeVisible();await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__cancelled)).toBe(2);
});
test('export failure keeps the player and permits retry',async({page})=>{
 await install(page,'error');await page.goto('/?q=003');await page.getByRole('button',{name:'播放 视频 003',exact:true}).click();
 await page.locator('.playback-diagnostics summary').click();await page.getByRole('button',{name:'采集并导出播放诊断（8 秒）',exact:true}).click();
 await expect(page.getByText('诊断采集未完成，请重试',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'采集并导出播放诊断（8 秒）',exact:true})).toBeEnabled();
 await expect(page.locator('video')).toHaveCount(1);
});
