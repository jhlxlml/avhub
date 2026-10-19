// Real BrowserWindow regression; no media, source writes or pointer simulation.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','window-placement-'));let desktop;const rows=[];
try{
  desktop=await _electron.launch({args:[root,'--no-sandbox'],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1'}});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  const bounds=()=>desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {outer:w.getBounds(),content:w.getContentBounds(),maximized:w.isMaximized()};});
  const original=await bounds();
  for(const ratio of [16/9,9/16,4/3,2.4]){
    await page.evaluate(ratio=>window.avhubDesktop.setWindowMode({purePlayback:true,videoAspectRatio:ratio}),ratio);
    const fitted=await bounds();rows.push({ratio,...fitted});
    const gap=Math.max(fitted.content.width-fitted.content.height*ratio,fitted.content.height-fitted.content.width/ratio,0)/2;
    assert.ok(gap<=1,JSON.stringify({ratio,gap,fitted}));
    for(let i=0;i<3;i++){
      await page.evaluate(()=>window.avhubDesktop.windowAction('maximize'));
      await page.evaluate(()=>window.avhubDesktop.windowAction('maximize'));
      assert.deepEqual((await bounds()).content,fitted.content,'expansion must not accumulate fractional-DPI drift');
    }
    await page.evaluate(()=>window.avhubDesktop.setWindowMode({purePlayback:false}));
    assert.deepEqual((await bounds()).outer,original.outer,'restore original library bounds');
  }
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());
  await expect.poll(async()=>(await bounds()).maximized).toBe(true);
  await page.evaluate(()=>window.avhubDesktop.setWindowMode({purePlayback:true,videoAspectRatio:9/16}));
  assert.equal((await bounds()).maximized,false);
  await page.evaluate(()=>window.avhubDesktop.setWindowMode({purePlayback:false}));
  assert.equal((await bounds()).maximized,true);
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize());
  await expect.poll(async()=>(await bounds()).outer).toEqual(original.outer);
  console.log('Real Electron window placement passed: four aspect ratios, repeat expansion, exact library and maximized restoration.');
}finally{writeFileSync(path.join(data,'geometry.json'),JSON.stringify(rows,null,2));if(desktop)await desktop.close();}
