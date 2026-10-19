// Launch the actual AVHub library with an isolated read-only source index.
// This harness observes only; playback actions are performed through desktop UI.
import {_electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),index=process.argv[2],id=Number(process.argv[3]),presentation=process.argv[4]||'embedded';assert.ok(path.isAbsolute(index)&&id>0&&['embedded','independent'].includes(presentation));
mkdirSync(path.join(root,'build'),{recursive:true});const data=mkdtempSync(path.join(root,'build','native-app-interactive-'));
const copy=spawnSync('python',['-c',`import os,sqlite3,json,time
from pathlib import Path
s=sqlite3.connect(Path(os.environ['UI_INDEX']).resolve().as_uri()+'?mode=ro',uri=True)
t=sqlite3.connect(str(Path(os.environ['UI_DATA'])/'library.db'));s.backup(t);s.close()
t.execute('DELETE FROM media WHERE id<>?',(int(os.environ['UI_ID']),))
for table in ('preferences','root_file_permissions'):t.execute('DELETE FROM '+table)
t.execute('UPDATE media SET custom_cover=NULL,progress=0,watched=0')
for key,value in {'playerEngine':'mpv','mpvWindowMode':os.environ['UI_PRESENTATION'],'resumeBehavior':'restart','audio':{'volume':0,'muted':True},'autoNext':False}.items():t.execute('INSERT INTO preferences(key,value,updated_at) VALUES(?,?,?)',(key,json.dumps(value),time.time()*1000))
t.commit();t.close()`],{env:{...process.env,UI_INDEX:index,UI_DATA:data,UI_ID:String(id),UI_PRESENTATION:presentation},encoding:'utf8',windowsHide:true});assert.equal(copy.status,0,copy.stderr);
console.log('Actual application UI fixture:',data);
const desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0'},timeout:60000});
const first=await desktop.firstWindow();await first.waitForLoadState();
const installed=new WeakSet();let running=true,last='';
desktop.on('close',()=>{running=false;});
const timer=setTimeout(()=>{running=false;},20*60*1000);
try{
 while(running&&!existsSync(path.join(data,'stop-observer'))){
  const overlay=desktop.windows().find(w=>w.url().includes('nativePlayer='))||(presentation==='independent'?first:undefined);
  if(overlay){
   try{
    if(!installed.has(overlay)){
     await overlay.evaluate(()=>{window.__appInputTrace=[];for(const type of ['pointerdown','pointerup','lostpointercapture','pointercancel','input','keydown','keyup'])document.addEventListener(type,e=>{const t=e.target;window.__appInputTrace.push({at:performance.now(),type,target:t?.getAttribute?.('aria-label')||t?.tagName,value:t?.value,key:e.code,pointer:e.pointerId});if(window.__appInputTrace.length>80)window.__appInputTrace.shift();},true);});installed.add(overlay);
    }
    const value=await overlay.evaluate(async()=>{const state=await window.avhubDesktop.nativePlayer('snapshot');return {at:Date.now(),state,slider:document.querySelector('input[aria-label="播放进度"]')?.value,time:document.querySelector('.native-timeline time')?.textContent,inputs:window.__appInputTrace};});
    writeFileSync(path.join(data,'latest.json'),JSON.stringify(value,null,2));
    const marker=JSON.stringify([Math.floor(value.state.properties['time-pos']||0),value.state.pendingSeek,value.state.error,value.slider]);
    if(marker!==last){last=marker;appendFileSync(path.join(data,'timeline.jsonl'),JSON.stringify(value)+'\n');}
   }catch{}
  }
  await new Promise(resolve=>setTimeout(resolve,250));
 }
}finally{clearTimeout(timer);if(running)await desktop.close();}
