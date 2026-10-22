const {app,BrowserWindow,screen}=require('electron');
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {observePlayback,summarizeFrameTrace}=require('./frame-observation.cjs');
const config=JSON.parse(readFileSync(process.env.AVHUB_FRAME_CONTROL,'utf8'));
assert.equal(app.isPackaged,false);assert.match(path.basename(config.workspace),/^avhub-frame-control-/);
assert.equal(path.dirname(config.profile),config.workspace);assert.equal(process.env.AVHUB_DATA_DIR,config.profile);
assert.ok(!process.execArgv.some(x=>/inspect|debug/i.test(x)));
for(const option of ['inspect','inspect-brk','remote-debugging-port','remote-debugging-pipe','disable-gpu','no-sandbox'])assert.equal(app.commandLine.hasSwitch(option),false);
app.setAppPath(config.root);
const report={build:config.build,completed:false,runs:[],errors:[],instrumentation:{playwright:false,inspector:false,driver:'main-webContents.executeJavaScript'},limitations:[
 'Generated H.264 SDR 640x360 at 12/60 fps; no claim about 4K/HDR or the deferred video.',
 'No inspector, GPU/sandbox override or GC; frame callbacks and bounded sample timer still add measurement work.',
]};
const save=()=>writeFileSync(path.join(config.artifact,'frames.json'),JSON.stringify(report,null,2));save();
const run=(w,fn,arg)=>w.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`);
const wait=async(fn,label,ms=30000)=>{const end=Date.now()+ms;for(;;){if(await fn())return;if(Date.now()>end)throw new Error('Timeout: '+label);await delay(100);}};
require(path.join(config.root,'electron/dist/main.js'));
app.whenReady().then(async()=>{
 let main;
 try{
  await wait(()=>main=BrowserWindow.getAllWindows().find(w=>/^http:\/\/127\.0\.0\.1:/.test(w.webContents.getURL())),'window',60000);
  const startup=main.getBounds(),work=screen.getDisplayMatching(startup).workArea;
  report.startup={bounds:startup,workArea:work,withinWorkArea:startup.x>=work.x&&startup.y>=work.y&&startup.x+startup.width<=work.x+work.width&&startup.y+startup.height<=work.y+work.height};
  assert.equal(report.startup.withinWorkArea,true,'Initial window must fit the display work area');
  if(config.fit){
   const area=screen.getDisplayMatching(main.getBounds()).workArea,width=Math.min(1440,area.width-32),height=Math.min(900,area.height-32);
   main.setBounds({x:area.x+Math.round((area.width-width)/2),y:area.y+Math.round((area.height-height)/2),width,height});
  }else main.setContentSize(1440,900);
  main.show();main.focus();report.windowBounds=main.getBounds();report.fit=config.fit===true;
  report.windowPolicy={backgroundThrottling:main.webContents.getBackgroundThrottling(),sandbox:main.webContents.getLastWebPreferences().sandbox};
  assert.deepEqual(report.windowPolicy,{backgroundThrottling:true,sandbox:true});
  report.graphics={features:app.getGPUFeatureStatus(),displays:screen.getAllDisplays().map(d=>({scale:d.scaleFactor,frequency:d.displayFrequency,size:d.size}))};
  await wait(()=>run(main,()=>Boolean(document.querySelector('section.library'))),'library');
  await run(main,async media=>{
   const api=async(url,method,body)=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();};
   await api('/api/preferences','PATCH',{values:{hoverPreview:false,playerEngine:'chromium',resumeBehavior:'restart',audio:{volume:0,muted:true},autoNext:false}});
   await api('/api/roots','POST',{path:media});await api('/api/scan','POST');
  },config.media);
  await wait(()=>run(main,async()=>{const s=await(await fetch('/api/scan')).json(),t=await(await fetch('/api/thumbnails')).json();return s.state==='completed'&&t.pending===0;}),'scan/covers');
  await main.loadURL(main.webContents.getURL());await wait(()=>run(main,()=>document.querySelectorAll('.card').length===2),'reloaded library');
  await run(main,observePlayback);
  for(const fps of [12,60]){
   await run(main,fps=>{const button=document.querySelector(`button[aria-label="播放 Owned ${fps} fps"]`);if(!button)throw new Error('Playback button missing');button.click();},fps);
   await wait(()=>run(main,()=>{const v=document.querySelector('.player-shell video');return v&&v.readyState>=2&&!v.paused;}),'decoded playback');
   await delay(12000);
   const trace=await run(main,()=>{const t=window.__frameProbe;t.stop();const{stop,...data}=t;return data;});
   const summary=summarizeFrameTrace(trace);report.runs.push({fps,...summary,trace});save();console.log(JSON.stringify({fps,...summary}));
   // Completing a measurement is not a smoothness pass. Callback delivery may
   // itself be late/missed; retain it rather than requiring a minimum callback
   // FPS that would discard precisely the bad presentation being investigated.
   assert.ok(trace.frames.length>0);assert.ok(trace.samples.at(-1).total>fps*8);
   assert.ok(trace.samples.at(-1).time>10);assert.equal(summary.unexpectedReloads,0);
   assert.equal(main.webContents.debugger.isAttached(),false);assert.equal(main.webContents.isDevToolsOpened(),false);
   // Functional overlap injection AFTER frame measurement: the real backend
   // still commits, but hold the response for 200ms to make pause/back overlap.
   // This is not used as a return-latency performance measurement.
   await run(main,()=>{
    const original=window.fetch;window.__returnSave={original,writes:0,ok:[]};
    window.fetch=async function(input,init){
     if(typeof input==='string'&&input.endsWith('/progress')&&init?.method==='PUT'){
      window.__returnSave.writes++;const response=await original.apply(this,arguments);
      window.__returnSave.ok.push(response.ok);await new Promise(resolve=>setTimeout(resolve,200));return response;
     }
     return original.apply(this,arguments);
    };
   });
   await run(main,()=>{const button=[...document.querySelectorAll('.player-top button')].find(b=>b.textContent.includes('返回媒体库'));button.click();});
   await wait(()=>run(main,()=>!document.querySelector('.player-shell')&&document.querySelectorAll('.card').length===2),'saved return');
   const saved=await run(main,()=>{const s=window.__returnSave;window.fetch=s.original;return{writes:s.writes,ok:s.ok};});
   assert.deepEqual(saved,{writes:1,ok:[true]});report.runs.at(-1).overlappingReturnSave=saved;save();
  }
  report.droppedFramesObserved=report.runs.some(r=>r.trace.samples.at(-1).dropped>0);
  report.completed=true;save();app.quit();
 }catch(error){report.errors.push(String(error));save();process.exitCode=1;app.quit();}
});
