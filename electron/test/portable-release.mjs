import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,mkdtempSync,copyFileSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(import.meta.dirname,'../..'),version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
const folderMode=process.argv.includes('--folder');
const artifactOption=process.argv.find(value=>value.startsWith('--artifacts-dir='));
const artifacts=path.resolve(artifactOption?artifactOption.slice('--artifacts-dir='.length):path.join(root,'dist/electron'));
const folder=mkdtempSync(path.join(root,'build',folderMode?'folder-release-test-':'portable-release-test-'));
const home=path.join(folder,'app',...(folderMode?[`AVHub-folder-portable-${version}-x64`]:[])),custom=path.join(folder,'custom');mkdirSync(custom);
let exe;
if(folderMode) {
  const extracted=spawnSync(process.env.AVHUB_PYTHON||'python',['scripts/folder-portable.py','--directory',artifacts,'--extract-to',path.join(folder,'app')],{cwd:root,windowsHide:true,encoding:'utf8',timeout:120000});
  assert.equal(extracted.status,0,`actual folder ZIP must extract safely: ${extracted.stderr}`);
  exe=path.join(home,'AVHub.exe');assert.ok(existsSync(exe));
} else {
  mkdirSync(home);exe=path.join(home,`AVHub-portable-${version}-x64.exe`);copyFileSync(path.join(artifacts,path.basename(exe)),exe);
}
// Only the frozen backend may migrate this owned old-schema fixture. Seeding
// with current bootstrap() would silently skip the actual upgrade path.
const seed=spawnSync(process.env.AVHUB_PYTHON||'python',['scripts/python-runtime.py','electron/test/seed-legacy-library.py',path.join(home,'AVHub-data/library.db'),path.join(folder,'legacy-empty-media')],{cwd:root,windowsHide:true,timeout:30000});
assert.equal(seed.status,0,`isolated legacy database must initialize: ${seed.stderr?.toString()}`);
let child,browser,page,port;
const startupSamples=[];
let firstFrameSample=null;
async function launch(){
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;await new Promise(r=>server.close(r));
  const env={...process.env,AVHUB_HEADLESS_TEST:'1'};delete env.AVHUB_DATA_DIR;delete env.AVHUB_APP_HOME;delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;delete env.PORTABLE_EXECUTABLE_FILE;delete env.PORTABLE_EXECUTABLE_APP_FILENAME;
  const started=performance.now();
  child=spawn(exe,[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:home,env,windowsHide:true,stdio:'ignore'});
  const deadline=Date.now()+120000;let ready=false;
  while(Date.now()<deadline){try{const r=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(600)});if(r.ok){ready=true;break;}}catch{}await delay(250);}
  assert.ok(ready,'portable Chromium must start');browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const chromiumReadyMs=Math.round(performance.now()-started);
  const context=browser.contexts()[0];page=context.pages()[0]||await context.waitForEvent('page',{timeout:60000});
  await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor({timeout:60000});
  const health=await page.evaluate(async()=> (await(await fetch('/api/health')).json()));assert.equal(health.frozen,true);assert.equal(health.ffmpeg,true);assert.equal(health.ffprobe,true);assert.equal(health.version,version);
  assert.equal(health.build_id,JSON.parse(readFileSync(path.join(root,'app/build-info.json'),'utf8')).build_id);
  const sqlitePin=JSON.parse(readFileSync(path.join(root,'app/sqlite-runtime.json'),'utf8'));
  assert.equal(health.sqlite_runtime.version,sqlitePin.version);assert.equal(health.sqlite_runtime.verified,true);
  assert.equal(health.sqlite_runtime.policy,'pinned-private-runtime');
  const legacy=await page.evaluate(async()=>{
    const item=await(await fetch('/api/media/1001')).json(),playlist=await(await fetch('/api/playlists/91')).json();
    return{item,playlist};
  });
  assert.equal(legacy.item.title,'Legacy preserved title');assert.equal(legacy.item.progress,42);assert.equal(Boolean(legacy.item.favorite),true);
  assert.deepEqual(legacy.item.tags,['legacy']);assert.equal(legacy.item.rating,4);
  assert.equal(legacy.playlist.name,'Legacy preserved playlist');assert.equal(legacy.playlist.revision,0);
  assert.deepEqual(legacy.playlist.items.map(item=>item.id),[1001]);
  const launchLog=()=>{const text=readFileSync(path.join(health.data_dir,'desktop.log'),'utf8');return text.slice(text.lastIndexOf('startup-begin'));};
  await expect.poll(()=>launchLog().includes('stage=library-ready')).toBe(true);
  const stages=Array.from(launchLog().matchAll(/startup-stage stage=([\w-]+) elapsed_ms=(\d+)/g),match=>({stage:match[1],elapsedMs:Number(match[2])}));
  startupSamples.push({kind:folderMode?'folder':'single',run:startupSamples.length+1,chromiumReadyMs,libraryReadyMs:Math.round(performance.now()-started),migration:startupSamples.length===1,stages});
  return health;
}
async function close(){
  if(!page)return;await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  const deadline=Date.now()+30000;while(Date.now()<deadline){try{await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)});}catch{break;}await delay(200);}
  await browser.close().catch(()=>{});browser=null;page=null;
}
try {
  await launch();assert.ok(existsSync(path.join(home,'AVHub-data/library.db')));
  let checks=0;page.on('request',r=>{if(r.url().endsWith('/api/updates/check'))checks++;});
  // Hosted runners may share an exhausted anonymous GitHub rate limit.
  // CI checks deterministic UI behavior; unit tests cover the actual API parser.
  if(process.env.CI==='true')await page.route('**/api/updates/check',route=>route.fulfill({json:{status:'unpublished'}}));
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'帮助',exact:true}).click();await page.getByRole('tab',{name:'关于',exact:true}).click();assert.equal(checks,0);
  await expect(page.getByRole('region',{name:'关于 AVHub'})).toContainText(version);
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.getByRole('button',{name:'检查更新',exact:true})).toBeEnabled({timeout:15000});assert.equal(checks,1);
  await expect(page.locator('.manual-update-result [role="alert"]')).toHaveCount(0);
  await expect(page.locator('.manual-update-result [role="status"]')).toBeVisible();
  await page.screenshot({path:path.join(folder,'portable-about.png')});
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  // Generated acceptance media only. Record a real decoded frame, not a hidden
  // loading indicator. This measures a short H.264 sample, not MKV/HDR seeking.
  const mediaFolder=path.join(folder,'generated-media');mkdirSync(mediaFolder);
  const sample=path.join(mediaFolder,'owned-first-frame.mp4');
  const generated=spawnSync(path.join(root,'bin/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=25','-t','10','-c:v','libx264','-pix_fmt','yuv420p',sample],{windowsHide:true,timeout:30000});
  assert.equal(generated.status,0,'generate isolated first-frame sample');
  const sourceDigest=()=>createHash('sha256').update(readFileSync(sample)).digest('hex'),originalDigest=sourceDigest();
  await page.evaluate(async directory=>{const registered=await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});if(!registered.ok)throw new Error('sample registration failed');await fetch('/api/scan',{method:'POST'});},mediaFolder);
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/scan')).json()).state),{timeout:30000}).toBe('completed');
  const mediaId=await page.evaluate(async name=>{
    // Supplying page is part of the paginated API contract. Without it the
    // compatibility endpoint intentionally returns an array, not {items}.
    const response=await fetch('/api/media?page=1&q='+encodeURIComponent(name));
    if(!response.ok)throw new Error(`Generated sample lookup failed: HTTP ${response.status}`);
    const result=await response.json();
    if(!Array.isArray(result.items))throw new Error('Generated sample lookup requires a paginated media response');
    const matches=result.items.filter(item=>item.name===name);
    if(matches.length!==1)throw new Error(`Expected exactly one generated sample, received ${matches.length}`);
    return matches[0].id;
  },'owned-first-frame.mp4');assert.ok(mediaId);
  const frameStarted=performance.now();await page.goto(new URL('/?video='+mediaId,page.url()).href);
  await page.locator('video').waitFor({timeout:30000});
  const frame=await page.locator('video').evaluate(video=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('real decoded frame timeout')),30000);video.requestVideoFrameCallback((_,meta)=>{clearTimeout(timer);resolve({mediaTime:meta.mediaTime,width:meta.width,height:meta.height,presentedFrames:meta.presentedFrames,decodedFrames:video.getVideoPlaybackQuality().totalVideoFrames});});}));
  assert.equal(frame.width,640);assert.equal(frame.height,360);assert.ok(frame.decodedFrames>0);assert.equal(sourceDigest(),originalDigest);
  firstFrameSample={navigationToDecodedFrameMs:Math.round(performance.now()-frameStarted),...frame,limitations:['Generated 10-second H.264 MP4; includes automation/navigation overhead; not real-media codec or random-seek acceptance.']};
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  // Verify the newly shipped privacy preference through the actual packaged UI,
  // then check that the same SQLite value survives relocation and restart.
  await page.getByRole('button',{name:'开启隐私模式',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-privacy','on');
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/preferences')).json()).values.privacyMode)).toBe(true);
  await expect(page.locator('.card [data-private-media]').first()).toHaveCSS('filter','blur(22px)');
  await page.evaluate(async()=>{await fetch('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{librarySort:'modified_asc',resumeBehavior:'resume'}})});});
  // Prepare an explicit next-launch migration using the same validated config
  // format; actual native selection is covered by the desktop IPC test.
  await close();
  const {migrationConfig,writeDataLocation,configName}=await import('../dist/dataLocation.js');
  writeDataLocation(path.join(home,configName),migrationConfig(path.join(home,'AVHub-data'),custom));
  await launch();const info=await page.evaluate(async()=> (await(await fetch('/api/app-info')).json()));assert.equal(info.data_directory,custom);
  const prefs=await page.evaluate(async()=> (await(await fetch('/api/preferences')).json()).values);assert.equal(prefs.librarySort,'modified_asc');assert.equal(prefs.resumeBehavior,'resume');
  assert.equal(prefs.privacyMode,true);await expect(page.getByRole('button',{name:'关闭隐私模式',exact:true})).toBeVisible();
  assert.ok(existsSync(path.join(home,'AVHub-data/library.db')));assert.ok(existsSync(path.join(custom,'library.db')));
  await close();
  await launch();await close(); // Repeat launch without another migration.
  assert.ok(!readdirSync(path.join(artifacts,'win-unpacked/resources')).includes('archive'));
  writeFileSync(path.join(folder,'startup-timings.json'),JSON.stringify({startupSamples,firstFrameSample,limitations:['Initial startup upgrades a synthetic old-schema library containing one missing media record and one playlist; later runs add one generated sample; no OS cache flush; polling has up to 250 ms granularity; run 2 relocates the data directory.']},null,2));
  console.log(JSON.stringify({passed:true,report:folder,startupSamples,limitations:['Synthetic legacy fixture, not a real user backup; first run is not OS-cache-controlled cold boot. Second run includes explicit data relocation.'],checks:[folderMode?'actual extracted folder ZIP':'actual portable EXE','frozen backend/FFmpeg','0 background checks',process.env.CI==='true'?'manual update UI (mock GitHub response)':'manual real GitHub check','default sibling data','old-schema upgrade preserves metadata/progress/playlist','packaged migration command','preferences retained','old data retained']}));
}finally{if(page)await close();if(browser)await browser.close().catch(()=>{});if(child&&child.exitCode===null)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
