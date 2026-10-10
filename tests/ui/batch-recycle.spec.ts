// Renderer-only bridge harness; native TEMP acceptance validates real recycling.
import {test,expect} from '@playwright/test';
test.beforeEach(async({page,request})=>{
  await request.post('/test/reset');await page.addInitScript(()=>{
    const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};const w=window as any;
    w.batchCalls=[];w.batchMode='mixed';w.batchActive=0;w.batchMaxActive=0;
    window.avhubDesktop={getWindowState:async()=>state,onWindowStateChanged:()=>()=>{},setWindowMode:async()=>state,windowAction:async()=>null,fileOperation:async(value:any)=>{
      w.batchCalls.push(value);
      if(value.action==='preview')return {preview_token:'a'.repeat(32),items:value.ids.map((id:number)=>({id,title:`视频 ${String(id).padStart(3,'0')}`,path:`D:\\owned\\video-${id}.mp4`,size:1024,eligible:!(w.batchMode==='mixed'&&id===3),reason:id===3?'目录未授权':''}))};
      if(value.action==='recycle'){
        w.batchActive++;w.batchMaxActive=Math.max(w.batchMaxActive,w.batchActive);await new Promise(resolve=>setTimeout(resolve,w.batchMode==='slow'?800:60));w.batchActive--;
        if(w.batchMode==='mixed'&&value.id===2)throw new Error('模拟系统回收失败，不永久删除');
      }
      return {ok:true};
    }} as any;
  });
});
async function open(page:any){await page.goto('/');await page.getByRole('button',{name:'批量整理',exact:true}).click();for(const id of [1,2,3])await page.getByRole('checkbox',{name:`选择 视频 ${String(id).padStart(3,'0')}`,exact:true}).check();await page.getByRole('button',{name:'所选移入回收站',exact:true}).click();}
for(const theme of ['dark','light'])test(`${theme}: explicit preview, cancel, serial partial results and retained failures`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});await open(page);const dialog=page.getByRole('dialog',{name:'批量移入系统回收站',exact:true});await expect(dialog).toContainText('可回收 2 个');await expect(dialog).toContainText('目录未授权');
  await dialog.getByRole('button',{name:'回收 2 个视频',exact:true}).click();const confirm=page.getByRole('dialog',{name:'确认回收 2 个视频？',exact:true});await confirm.getByRole('button',{name:'取消',exact:true}).click();expect(await page.evaluate(()=>(window as any).batchCalls.filter((value:any)=>value.action==='recycle'))).toEqual([]);
  await dialog.getByRole('button',{name:'回收 2 个视频',exact:true}).click();await confirm.getByRole('button',{name:'确认回收',exact:true}).click();await expect(dialog).toContainText('已回收 1 · 失败 1 · 跳过 1');expect(await page.evaluate(()=>(window as any).batchMaxActive)).toBe(1);
  expect(await page.evaluate(()=>(window as any).batchCalls.filter((value:any)=>value.action==='recycle'))).toEqual([{action:'recycle',id:1,previewToken:'a'.repeat(32)},{action:'recycle',id:2,previewToken:'a'.repeat(32)}]);
  await page.setViewportSize({width:390,height:820});expect(await dialog.evaluate((el:HTMLElement)=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:`build/batch-recycle-${theme}.png`});await dialog.getByRole('button',{name:'完成',exact:true}).click();await expect(page.getByLabel('批量选择')).toContainText('已选 2 / 500');await expect.poll(()=>page.evaluate(()=>(window as any).batchCalls.some((value:any)=>value.action==='release-preview'))).toBe(true);
});
test('stop finishes the current item and never invokes later items',async({page})=>{
  await page.goto('/');await page.evaluate(()=>(window as any).batchMode='slow');await page.getByRole('button',{name:'批量整理',exact:true}).click();for(const id of [1,2,3])await page.getByRole('checkbox',{name:`选择 视频 ${String(id).padStart(3,'0')}`,exact:true}).check();await page.getByRole('button',{name:'所选移入回收站',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'批量移入系统回收站',exact:true});await dialog.getByRole('button',{name:'回收 3 个视频',exact:true}).click();await page.getByRole('button',{name:'确认回收',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).batchActive)).toBe(1);await dialog.getByRole('button',{name:'停止后续任务',exact:true}).click();await expect(dialog).toContainText('已回收 1 · 失败 0 · 跳过 0 · 未执行 2');expect(await page.evaluate(()=>(window as any).batchCalls.filter((value:any)=>value.action==='recycle').map((value:any)=>value.id))).toEqual([1]);
});
