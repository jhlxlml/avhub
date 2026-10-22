// Generated source / normal Electron / no inspector control for the CDP probe.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..'),workspace=ownedTemporaryWorkspace('avhub-frame-control-'),media=path.join(workspace,'media');mkdirSync(media);
const artifact=path.join(root,'build','frame-control-'+path.basename(workspace));mkdirSync(artifact,{recursive:true});
const identities=new Map();
for(const fps of [12,60]){
 const file=path.join(media,`Owned ${fps} fps.mp4`);
 assert.equal(spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i',`testsrc2=s=640x360:r=${fps}`,'-t','18','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',file],{windowsHide:true,timeout:30000}).status,0);
 identities.set(file,createHash('sha256').update(readFileSync(file)).digest('hex'));
}
const config=path.join(workspace,'run.json');writeFileSync(config,JSON.stringify({root,workspace,media,artifact,fit:process.argv.includes('--fit'),profile:path.join(workspace,'profile'),build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8'))}));
const env={...process.env,AVHUB_APP_HOME:workspace,AVHUB_DATA_DIR:path.join(workspace,'profile'),AVHUB_FRAME_CONTROL:config,AVHUB_SMOKE_TEST:'0'};
for(const key of ['AVHUB_HEADLESS_TEST','ELECTRON_RUN_AS_NODE','NODE_OPTIONS'])delete env[key];
const child=spawn(createRequire(import.meta.url)('electron'),[path.join(root,'electron/test/playback-frame-control.cjs')],{cwd:workspace,env,stdio:'inherit',windowsHide:true});
const safety=setTimeout(()=>{console.error('Owned frame control exceeded 150s safety deadline');child.kill();},150000);
let exit;try{exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});}finally{clearTimeout(safety);}
const file=path.join(artifact,'frames.json'),report=JSON.parse(readFileSync(file,'utf8'));report.exit=exit;
report.sourceUnchanged=[...identities].every(([file,hash])=>createHash('sha256').update(readFileSync(file)).digest('hex')===hash);
report.cleanExit=exit.code===0&&report.completed&&report.errors.length===0;writeFileSync(file,JSON.stringify(report,null,2));
assert.equal(report.sourceUnchanged,true);assert.equal(report.cleanExit,true,JSON.stringify(report.errors));console.log('No-inspector frame report:',file);
