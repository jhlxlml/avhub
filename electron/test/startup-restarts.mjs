// Real Electron, normal GPU/sandbox, isolated profile. No timeout widening/retries.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const build=path.join(root,'build');mkdirSync(build,{recursive:true});
const folder=mkdtempSync(path.join(build,'electron-startup-restarts-')),profile=path.join(folder,'profile'),media=path.join(folder,'media');mkdirSync(media);
const source=path.join(media,'Owned.S01E01.mp4');
assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=5','-t','8','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',source],{windowsHide:true,timeout:30000}).status,0);
const scanFolder=path.join(folder,'scan');mkdirSync(scanFolder);
for(let i=0;i<120;i++)copyFileSync(source,path.join(scanFolder,`Owned ${i}.mp4`));
const report={build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),completed:false,rounds:[],errors:[],limitations:['20 repeated real Electron starts, not cold OS or packaged EXE starts.','Normal GPU/sandbox; hidden test windows disable background throttling. No media performance claims.']};
let desktop,page;
const persist=()=>writeFileSync(path.join(folder,'acceptance.json'),JSON.stringify(report,null,2));
const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v;},{url,method,body});
try{
 for(let round=0;round<20;round++){
  const log=path.join(profile,'desktop.log'),offset=existsSync(log)?readFileSync(log,'utf8').length:0,started=performance.now();
  desktop=await _electron.launch({args:[root],cwd:folder,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_APP_HOME:folder,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  page=await desktop.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
  await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  await expect.poll(()=>readFileSync(log,'utf8').slice(offset).includes('startup-stage stage=library-ready'),{timeout:15000}).toBe(true);
  const stages=readFileSync(log,'utf8').slice(offset).split(/\r?\n/).filter(line=>line.includes('startup-stage'));
  for(const stage of ['renderer-starting','service-verified','preferences-ready','roots-ready','library-ready'])assert.ok(stages.some(line=>line.includes(`stage=${stage} `)),stage);
  const row={round:round+1,readyMs:performance.now()-started,stages};
  if(round===0){await api('/api/roots','POST',{path:media});await api('/api/scan','POST');await expect.poll(async()=>(await api('/api/scan')).state,{timeout:30000}).toBe('completed');}
  if(round===2)await api('/api/roots','POST',{path:scanFolder});
  if(round>=2&&round%4===2){
   copyFileSync(source,path.join(scanFolder,`Discovered ${round}.mp4`));
   await api('/api/scan','POST');row.closedScanState=(await api('/api/scan')).state;
  }
  const closeStarted=performance.now();await desktop.close();desktop=null;row.closeMs=performance.now()-closeStarted;
  report.rounds.push(row);persist();console.log(JSON.stringify({round:row.round,readyMs:Math.round(row.readyMs),closedScanState:row.closedScanState??null}));
 }
 assert.deepEqual(report.errors,[]);report.completed=true;
}catch(error){
 report.failure=String(error);
 if(page&&!page.isClosed()){
  report.failureState=await page.evaluate(()=>({ready:document.readyState,startup:document.querySelector('[data-startup-state]')?.getAttribute('data-startup-state'),body:document.body.innerText,resources:performance.getEntriesByType('resource').map(r=>({name:r.name,duration:r.duration}))})).catch(()=>null);
  await page.screenshot({path:path.join(folder,'failure.png')}).catch(()=>{});
 }
 throw error;
}finally{if(desktop)await desktop.close().catch(error=>report.errors.push(String(error)));persist();console.log('Repeated startup evidence:',path.join(folder,'acceptance.json'));}
