// Explicit read-only real-media opt-in. Clone the index and write captures only
// inside build. Compare the SAME paused frame; PNG tuning must be lossless.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,statSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),index=process.argv[2],id=Number(process.argv[3]);
assert.ok(index&&path.isAbsolute(index)&&Number.isSafeInteger(id)&&id>0,'Provide an authorized index and one explicit media ID');
mkdirSync(path.join(root,'build'),{recursive:true});const data=mkdtempSync(path.join(root,'build','native-capture-bench-'));
const clone=spawnSync('python',['-c',`import os,sqlite3
from pathlib import Path
source=sqlite3.connect(Path(os.environ['BENCH_INDEX']).resolve().as_uri()+'?mode=ro',uri=True)
target=sqlite3.connect(str(Path(os.environ['BENCH_DATA'])/'library.db'));source.backup(target);source.close()
target.execute('DELETE FROM media WHERE id<>?',(int(os.environ['BENCH_ID']),))
for table in ('preferences','root_file_permissions'):target.execute('DELETE FROM '+table)
target.execute('UPDATE media SET custom_cover=NULL,progress=0,watched=0');target.commit();target.close()`],{env:{...process.env,BENCH_INDEX:index,BENCH_DATA:data,BENCH_ID:String(id)},encoding:'utf8',windowsHide:true});assert.equal(clone.status,0,clone.stderr);
let desktop;const captures=[];
try{
  desktop=await _electron.launch({args:[root,'--no-sandbox'],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  await page.evaluate(async()=>{await fetch('/api/thumbnails/pause',{method:'POST'});await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{audio:{volume:0,muted:true}}})});});
  await desktop.evaluate((_,root)=>{
    const load=process.getBuiltinModule('module').createRequire(root+'/package.json');
    const {MpvClient}=load(root+'/electron/dist/mpvClient.js'),original=MpvClient.prototype.command;
    globalThis.captureMode={compression:7,filter:5};globalThis.captureEncoding=[];
    MpvClient.prototype.command=async function(command,...args){
      if(command[0]!=='screenshot-to-file')return original.call(this,command,...args);
      for(const [name,value] of Object.entries(globalThis.captureMode))await original.call(this,['set_property','options/screenshot-png-'+name,value]);
      const started=performance.now();try{return await original.call(this,command,...args);}finally{globalThis.captureEncoding.push(performance.now()-started);}
    };
  },root);
  const media=await page.evaluate(async id=>(await(await fetch('/api/media/'+id)).json()),id),before=statSync(media.path);
  const {session}=await page.evaluate(id=>window.avhubDesktop.nativePlayer('open',{mediaId:id,start:0}),id);
  const overlay=desktop.windows().find(w=>w.url().includes('nativePlayer='+session));assert.ok(overlay);
  const state=()=>overlay.evaluate(()=>window.avhubDesktop.nativePlayer('snapshot'));
  const call=(action,value)=>overlay.evaluate(({action,value,session})=>window.avhubDesktop.nativePlayer(action,{session,value}),{action,value,session});
  await expect.poll(async()=>(await state()).phase,{timeout:30000}).toBe('ready');await call('pause',true);await call('seek',Math.min(30,media.duration/2));await expect.poll(async()=>(await state()).pendingSeek,{timeout:30000}).toBe(null);
  for(const mode of [{compression:7,filter:5},{compression:1,filter:1},{compression:3,filter:1}]){
    await desktop.evaluate((_,value)=>{globalThis.captureMode=value;},mode);
    const start=performance.now(),result=await call('screenshot'),totalMs=performance.now()-start;
    const encodeMs=await desktop.evaluate(()=>globalThis.captureEncoding.at(-1));
    captures.push({...mode,totalMs,encodeMs,publishAndTransferMs:totalMs-encodeMs,width:result.width,height:result.height,bytes:result.bytes,path:result.path});
    console.log(JSON.stringify({...mode,totalMs,encodeMs,publishAndTransferMs:totalMs-encodeMs,width:result.width,height:result.height,bytes:result.bytes}));
  }
  const decoded=spawnSync('python',['-c',`import os,json,hashlib
from PIL import Image
result=[]
for path in json.loads(os.environ['BENCH_IMAGES']):
 with Image.open(path) as image:result.append({'size':image.size,'mode':image.mode,'sha256':hashlib.sha256(image.tobytes()).hexdigest()})
print(json.dumps(result))`],{env:{...process.env,BENCH_IMAGES:JSON.stringify(captures.map(c=>c.path))},encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(decoded.status,0,decoded.stderr);
  const pixels=JSON.parse(decoded.stdout);assert.ok(pixels.every(item=>JSON.stringify(item)===JSON.stringify(pixels[0])),'PNG compression/filter changes must preserve every decoded pixel');
  const metadata=file=>{const bytes=readFileSync(file),chunks=[];for(let at=8;at+12<=bytes.length;){const size=bytes.readUInt32BE(at),kind=bytes.toString('ascii',at+4,at+8);if(kind!=='IDAT')chunks.push([kind,bytes.subarray(at+8,at+8+size).toString('hex')]);at+=size+12;}return chunks;};
  assert.ok(captures.every(c=>JSON.stringify(metadata(c.path))===JSON.stringify(metadata(captures[0].path))),'native colour tags and dimensions are unchanged');
  const after=statSync(media.path);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);
  assert.equal((await state()).sourceLoads,1);await page.evaluate(session=>window.avhubDesktop.nativePlayer('close',session),session);
  writeFileSync(path.join(data,'benchmark.json'),JSON.stringify({mediaId:id,captures,pixels,sourceUnchanged:true,cache:'OS cache not cleared; same paused frame; PNG encoding only differs'},null,2));
  console.log('Capture benchmark passed:',data);
}finally{if(desktop)await desktop.close().catch(()=>{});}
