// Explicit renderer/native-bridge harness. Native restore uses owned Electron samples.
import {test,expect} from '@playwright/test';
const recordId='a'.repeat(32);
const fixture=Array.from({length:8},(_,i)=>({id:(i+10).toString(16).padStart(32,'0'),name:`最近视频 ${i}.mp4`,source:`D:\\owned\\${i}.mp4`,size:1000,created_at:1,status:i===1?'review':'available',error:''}));
test.beforeEach(async({request,page})=>{
 await request.post('/test/reset');
 await page.addInitScript(id=>{const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};(window as any).recoveryCalls=[];window.avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,fileOperation:async value=>{(window as any).recoveryCalls.push(value);if(value.action==='recycle')return {ok:true,operation_id:id};if(value.action==='preview-records')return {ok:true,preview_token:'f'.repeat(32),records:value.recordIds!.map(id=>({id,action:'restore',eligible:true,reason:''}))};return {ok:true};}} as any;},recordId);
 await page.route('**/api/recycle-records?**',route=>route.fulfill({json:{items:fixture,total:8,page:1,pages:1}}));
 await page.route('**/api/media/*/file-actions',route=>route.fulfill({json:{rename:true,recycle:true,reason:''}}));
});
test('single recycle exposes exact-record restore with preflight, no pathname IPC',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'更多操作 视频 002',exact:true}).click();await page.getByRole('menuitem',{name:'移入系统回收站',exact:true}).click();await page.getByRole('button',{name:'确认移入回收站',exact:true}).click();
 await expect(page.getByRole('button',{name:'恢复视频',exact:true})).toBeVisible();await expect(page.locator('.toast')).toHaveCount(1);await page.getByRole('button',{name:'恢复视频',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).recoveryCalls.filter((v:any)=>v.action==='restore-record'))).toEqual([{action:'restore-record',id:recordId,confirmed:false,previewToken:'f'.repeat(32)}]);
 await expect.poll(()=>page.evaluate(()=>(window as any).recoveryCalls.filter((v:any)=>v.action==='release-record-preview').length)).toBe(1);
});
for(const theme of ['dark','light'])test(`${theme}: compact recent panel limits to six records, keeps safe actions and fits narrow windows`,async({page,request})=>{
 await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});await page.goto('/');await page.getByRole('button',{name:'最近回收',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'最近回收',exact:true});await expect(panel.locator('li')).toHaveCount(6);await expect(panel).toContainText('最近 6 条');await expect(panel.getByRole('button',{name:'永久删除',exact:true})).toHaveCount(0);
 await page.setViewportSize({width:390,height:700});expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:`build/recent-recycle-${theme}.png`});
 await panel.locator('li').first().getByRole('button',{name:'恢复',exact:true}).click();await expect(panel).toContainText('已恢复 最近视频 0.mp4');
 await panel.getByRole('button',{name:'查看全部回收记录',exact:true}).click();await expect(panel).toHaveCount(0);await expect(page.getByRole('dialog',{name:'回收记录',exact:true})).toBeVisible();
});
test('permission/identity preflight refusal releases token and never starts restore',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'最近回收',exact:true}).click();
 await page.evaluate(()=>{const original=window.avhubDesktop!.fileOperation!;window.avhubDesktop!.fileOperation=async value=>value.action==='preview-records'?{ok:true,preview_token:'e'.repeat(32),records:[{id:value.recordIds![0],action:'restore',eligible:false,reason:'原位置已有同名文件，不会覆盖'}]}:original(value);});
 const panel=page.getByRole('dialog',{name:'最近回收',exact:true});await panel.locator('li').first().getByRole('button',{name:'恢复',exact:true}).click();await expect(panel).toContainText('原位置已有同名文件');
 expect(await page.evaluate(()=>(window as any).recoveryCalls.filter((v:any)=>v.action==='restore-record'))).toEqual([]);expect(await page.evaluate(()=>(window as any).recoveryCalls.filter((v:any)=>v.action==='release-record-preview').length)).toBe(1);
});
test('uncertain restore keeps an error and record entry, no automatic retry',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'最近回收',exact:true}).waitFor();await page.evaluate(id=>window.dispatchEvent(new CustomEvent('avhub-recycled',{detail:{records:[{id,title:'测试视频'}]}})),recordId);
 await page.evaluate(()=>{const original=window.avhubDesktop!.fileOperation!;window.avhubDesktop!.fileOperation=async value=>{if(value.action==='restore-record'){(window as any).recoveryCalls.push(value);throw new Error('结果未确认，请先核对');}return original(value);};});
 await page.getByRole('button',{name:'恢复视频',exact:true}).click();await expect(page.locator('.toast')).toContainText('结果未确认');await expect(page.getByRole('button',{name:'恢复视频',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'查看回收记录',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).recoveryCalls.filter((v:any)=>v.action==='restore-record').length)).toBe(1);
});
test('batch success offers records, never one-click bulk restore',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'最近回收',exact:true}).waitFor();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avhub-recycled',{detail:{records:[{id:'a'.repeat(32),title:'A'},{id:'b'.repeat(32),title:'B'}]}})));
 await expect(page.locator('.toast')).toContainText('2 个视频');await expect(page.getByRole('button',{name:'恢复视频',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'查看回收记录',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).recoveryCalls)).toEqual([]);
});
test('long-name recovery toast fits 320px and does not expire while focused',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'最近回收',exact:true}).waitFor();await page.setViewportSize({width:320,height:700});await page.clock.install();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avhub-recycled',{detail:{records:[{id:'a'.repeat(32),title:'一个很长的视频文件名'.repeat(12)+'.mkv'}]}})));
 const toast=page.locator('.toast');await expect(toast).toBeVisible();expect(await toast.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.getByRole('button',{name:'恢复视频',exact:true}).focus();await page.clock.runFor(11000);await expect(toast).toBeVisible();await page.getByRole('button',{name:'最近回收',exact:true}).focus();await page.mouse.move(0,0);await page.clock.runFor(11000);await expect(toast).toHaveCount(0);
});
