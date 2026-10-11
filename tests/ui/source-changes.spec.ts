// Explicit renderer harness. Filesystem identity acceptance uses real Electron.
import {test,expect} from '@playwright/test';
for(const theme of ['dark','light'])test(`${theme}: source decisions and permanent-delete grants require separate confirmation`,async({page,request})=>{
  await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.addInitScript(()=>{const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).sourceCalls=[];window.avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,fileOperation:async value=>{(window as any).sourceCalls.push(value);return {ok:true};}} as any;});
  await page.route('**/api/file-permissions?**',route=>route.fulfill({json:[{root_id:1,supported:true,rename:false,recycle:true,permanentDelete:false,reason:''},{root_id:2,supported:true,rename:false,recycle:false,permanentDelete:false,reason:''}]}));
  await page.route('**/api/source-changes?**',route=>route.fulfill({json:{items:[{id:'a'.repeat(32),media_id:2,kind:'replacement',title:'旧视频',source:'D:\\media\\same.mp4',signature:'f'.repeat(64),size:1000}],total:1,page:1,pages:1}}));
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();const grant=page.getByRole('checkbox',{name:/^允许永久删除/}).first();await expect(grant).not.toBeChecked();
  await grant.click();const permission=page.getByRole('dialog',{name:'开启永久删除权限？',exact:true});await expect(permission).toContainText('不会直接删除源目录');await page.keyboard.press('Escape');await expect(grant).not.toBeChecked();
  await grant.click();await permission.getByRole('button',{name:'开启权限',exact:true}).click();await expect(grant).toBeChecked();
  await page.getByRole('tab',{name:'数据管理',exact:true}).click();await expect(page.locator('.source-change-panel')).toContainText('文件身份已变化');
  await page.getByRole('button',{name:'作为新视频',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'作为新视频收录？',exact:true});await expect(confirmation).toContainText('不复制旧视频');await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>(window as any).sourceCalls.filter((value:any)=>value.action==='resolve-source').length)).toBe(0);
  await page.getByRole('button',{name:'保留原媒体信息',exact:true}).click();await page.getByRole('dialog',{name:'保留原媒体信息？',exact:true}).getByRole('button',{name:'确认保留',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).sourceCalls.filter((value:any)=>value.action==='resolve-source'))).toEqual([{action:'resolve-source',id:'a'.repeat(32),decision:'keep',signature:'f'.repeat(64)}]);
  await page.screenshot({path:`build/source-changes-${theme}.png`});await page.setViewportSize({width:760,height:700});expect(await page.getByRole('dialog',{name:'媒体库设置'}).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});
