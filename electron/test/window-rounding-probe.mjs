// Owned desktop geometry evidence; no media or user-library access.
import {_electron} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-window-rounding-');
const artifact=path.join(root,'build',path.basename(workspace));mkdirSync(artifact,{recursive:true});let desktop;const rows=[];
try{
 desktop=await _electron.launch({args:[root],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:workspace,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'}});
 const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
 const original=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
 await page.evaluate(()=>window.avhubDesktop.setWindowMode({purePlayback:true,videoAspectRatio:16/9}));
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(true));await page.waitForTimeout(150);
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(false));await page.waitForTimeout(150);
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:640,height:360}));await page.waitForTimeout(150);
 await page.evaluate(()=>{void window.avhubDesktop.setWindowMode({purePlayback:false});});
 for(const wait of [0,10,30,80,200]){
  if(wait)await page.waitForTimeout(wait);
  rows.push({action:'pure-exit-'+wait,original,after:await desktop.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return{outer:w.getBounds(),content:w.getContentBounds()};})});
 }
 for(const action of ['initial','center','position20','position32']){
  rows.push(await desktop.evaluate(async({BrowserWindow},action)=>{
   const w=BrowserWindow.getAllWindows()[0],snapshot=()=>({outer:w.getBounds(),content:w.getContentBounds(),normal:w.getNormalBounds()});
   if(action==='center')w.center();else if(action.startsWith('position')){const n=Number(action.slice(8));w.setPosition(n,n);}
   await new Promise(r=>setTimeout(r,150));const before=snapshot();w.maximize();await new Promise(r=>setTimeout(r,200));
   const maximized=snapshot();w.unmaximize();await new Promise(r=>setTimeout(r,200));return{action,before,maximized,after:snapshot()};
  },action));
 }
 console.log(JSON.stringify(rows,null,2));
}finally{writeFileSync(path.join(artifact,'geometry.json'),JSON.stringify(rows,null,2));if(desktop)await desktop.close();}
