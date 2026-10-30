// Real installed desktop EXE; mutate only a validated, owned build resource,
// restoring it after Electron has exited. No user media/data is accessed.
import assert from 'node:assert/strict';
import {_electron} from '@playwright/test';
import {readFileSync,writeFileSync,mkdtempSync,existsSync,realpathSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),exe=path.resolve(process.env.AVHUB_TEST_PACKAGED_EXE??'');
assert.match(path.relative(root,exe),/^build[\\/]m5-(?:desktop-(?:native|dual-mpv(?:-fixed)?)|final-desktop)-\d{8}[\\/]win-unpacked[\\/]AVHub\.exe$/);
assert.equal(realpathSync(exe).toLowerCase(),exe.toLowerCase());
const resources=path.join(path.dirname(exe),'resources'),dll=path.join(resources,'native-render/libmpv-2.dll'),independent=path.join(resources,'mpv/mpv.exe');
const members=[dll,...(existsSync(independent)?[independent]:[])];
for(const member of members){assert.equal(realpathSync(member).toLowerCase(),member.toLowerCase());assert.equal(existsSync(member+'.desktop-test-held'),false);}
assert.equal(existsSync(path.join(path.dirname(exe),'Start-render-acceptance.cmd')),false);
const folder=mkdtempSync(path.join(root,'build/render-desktop-package-'));
const digest=()=>members.map(member=>createHash('sha256').update(readFileSync(member)).digest('hex')),before=digest();
const report={kind:'actual-packaged-desktop-no-acceptance-launcher',passed:false,cases:[]};
try{
 for(const missing of [null,...members]){
  let desktop;
  try{
   if(missing)renameSync(missing,missing+'.desktop-test-held');
   const data=mkdtempSync(path.join(folder,'data-'));
   desktop=await _electron.launch({executablePath:exe,args:[],cwd:data,
    env:{...process.env,AVHUB_RENDER_LOCAL_ACCEPTANCE:'',AVHUB_RENDER_RUNTIME_CANDIDATE:'',AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
   const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
   const status=await page.evaluate(()=>window.avhubDesktop.renderPlayer('status'));
   assert.equal(status.packaged,true);assert.equal(status.available,missing!==dll);assert.match(status.scope,/桌面原生嵌入/);
   const windowStatus=await page.evaluate(()=>window.avhubDesktop.nativePlayer('status'));
   assert.equal(windowStatus.available,members.includes(independent)&&missing!==independent);
   report.cases.push({missing:missing?path.relative(resources,missing):null,status,windowStatus});
  }finally{if(desktop)await desktop.close();if(missing&&existsSync(missing+'.desktop-test-held'))renameSync(missing+'.desktop-test-held',missing);}
 }
 assert.deepEqual(digest(),before);report.passed=true;
}finally{writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(folder,'report.json')}));}
