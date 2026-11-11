// Real Electron cold-process startups. Owned empty profiles and read-only index
// copies, not machine cold boot or proof that a rare timeout can never recur.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),directory=mkdtempSync(path.join(root,'build/backend-startup-'));
const report={kind:'real-Electron-backend-startup',build:JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')),rows:[],passed:false};
try{
 for(const [iteration,mode] of ['fresh','library-copy','fresh','library-copy','fresh','library-copy','fresh','fresh'].entries()){
  const data=path.join(directory,String(iteration));mkdirSync(data);const row={iteration,mode,passed:false};report.rows.push(row);let desktop;
  if(mode==='library-copy'){
   const clone=spawnSync('python',['-c',"import sqlite3,sys;from pathlib import Path;s=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True);t=sqlite3.connect(sys.argv[2]);s.backup(t);s.close();t.execute('DELETE FROM thumbnail_jobs');t.execute('DELETE FROM root_file_permissions');t.commit();t.close()",path.join(root,'AVHub-data/library.db'),path.join(data,'library.db')],{windowsHide:true,timeout:30000,encoding:'utf8'});assert.equal(clone.status,0,clone.stderr);
  }
  try{
   const began=performance.now();desktop=await _electron.launch({args:[root],cwd:data,env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();row.libraryMs=performance.now()-began;
   const health=await page.evaluate(async()=>{const r=await fetch('/api/health');if(!r.ok)throw new Error('Health rejected');return r.json();});assert.equal(health.ok,true);assert.equal(health.desktop_session,true);assert.equal(health.sqlite_runtime.verified,true);
   const backend=readFileSync(path.join(data,'backend.log'),'utf8');row.stages=backend.split('\n').filter(line=>line.startsWith('backend-startup-stage ')).map(line=>JSON.parse(line.slice('backend-startup-stage '.length)));assert.ok(row.stages.some(s=>s.stage==='schema-ready'));assert.equal(row.stages.filter(s=>s.stage==='health-ready').length,1);assert.ok(!backend.includes('Timeout ('),'A healthy launch must disarm its startup watchdog');row.passed=true;
  }catch(error){row.error=String(error.stack??error);throw error;}
  finally{await desktop?.close();row.desktopLog=readFileSync(path.join(data,'desktop.log'),'utf8');assert.ok(row.desktopLog.includes('shutdown-complete'));writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));}
 }
 report.passed=true;
}finally{writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(path.join(directory,'report.json'));}
