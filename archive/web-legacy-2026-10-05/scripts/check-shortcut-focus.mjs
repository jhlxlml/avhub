// Read-only source validation, with an isolated single-video backend profile.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const command=['-B','tests/benchmark_server.py','--source-index',value('--source-index'),'--source-id',value('--source-id')||'1'];
if(value('--project-root'))command.push('--project-root',path.resolve(value('--project-root')));
let browser,url,exited=false,error='';
const child=spawn('python',command,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stderr.on('data',chunk=>{error+=chunk;});child.on('exit',()=>{exited=true;});
try {
  const ready=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error(error||'startup timeout')),60000);
    child.on('exit',()=>{clearTimeout(timer);reject(new Error(error));});
    child.stdout.on('data',chunk=>{output+=chunk;for(const line of output.split('\n')){
      try{const item=JSON.parse(line);if(item.url){clearTimeout(timer);resolve(item);return;}}catch{}
    }});
  });url=ready.url;
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1440,height:850}});
  await page.goto(url);await page.getByRole('button',{name:'播放 播放基准样本',exact:true}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v?.readyState>=2&&!v.paused;});
  await page.locator('video').evaluate(v=>v.pause());
  const slider=page.getByRole('slider',{name:'视频完整进度'});const box=await slider.boundingBox();
  await slider.click({position:{x:box.width*.4,y:box.height/2}});
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v?.readyState>=2&&!v.seeking&&v.currentTime>100;});
  const results=[];
  for(const key of ['ArrowRight','l','ArrowLeft','j']) {
    const before=await page.locator('video').evaluate(v=>v.currentTime);
    const focused=await slider.evaluate(e=>document.activeElement===e);
    await page.keyboard.press(key);await delay(100);
    await page.waitForFunction(()=>{const v=document.querySelector('video');return v?.readyState>=2&&!v.seeking;});
    const after=await page.locator('video').evaluate(v=>v.currentTime);
    results.push({key,sliderFocused:focused,before,after,actualDelta:Math.round((after-before)*1000)/1000});
  }
  const folder=path.join(root,'build','seek-benchmark');mkdirSync(folder,{recursive:true});
  const report=path.join(folder,`focus-${Date.now()}.json`);
  writeFileSync(report,JSON.stringify({snapshotRoot:value('--project-root')||null,codec:ready.codec,results},null,2));
  console.log(JSON.stringify({report,results},null,2));
} finally {
  await browser?.close();if(url)await fetch(`${url}/benchmark/shutdown`,{method:'POST'}).catch(()=>{});
  for(let i=0;!exited&&i<50;i++)await delay(100);
  if(!exited)child.kill();
}
